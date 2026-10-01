//! Download + resize remote images (F95 screenshots, library covers, etc.)
//! for UI grids, cached on disk.
//!
//! F95 serves every attachment three ways: the original on
//! `attachments.f95zone.to`, a 400 px version on `preview.f95zone.to` and a
//! 100 px one under `/thumb/`. Grids start from the 400 px preview (sharp at
//! tile size, a few dozen KB); library covers resize the original once.
//! The 100 px thumbnail is never used: scaled up it is unreadable.

use crate::error::AppError;
use image::GenericImageView;
use reqwest::{Client, Url};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const PROBE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const GRID_MAX_EDGE: u32 = 720;
const COVER_MAX_EDGE: u32 = 720;
const GRID_JPEG_QUALITY: u8 = 84;
/// Part of the cache key: bumped when the sources change, so previews that
/// were built from the 100 px thumbnails are not served again.
const CACHE_VERSION: &str = "2";

const F95_ORIGINAL_HOST: &str = "attachments.f95zone.to";
const F95_PREVIEW_HOST: &str = "preview.f95zone.to";

fn max_edge_for_variant(variant: &str) -> Result<u32, AppError> {
    match variant {
        "grid" => Ok(GRID_MAX_EDGE),
        "cover" => Ok(COVER_MAX_EDGE),
        _ => Err(AppError::Other(format!(
            "variant inválido: {variant} (use grid ou cover)"
        ))),
    }
}

/// Path of an F95 attachment (without `/thumb/`), whichever host it came from.
fn f95_attachment_path(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    if host != F95_ORIGINAL_HOST && host != F95_PREVIEW_HOST {
        return None;
    }
    // `2023/08/thumb/name.jpg` → `2023/08/name.jpg`
    let path = parsed.path().trim_start_matches('/').replace("/thumb/", "/");
    (!path.is_empty()).then_some(path)
}

/// URLs to try, best first: grids want the light 400 px preview, covers the
/// original (resized here), each falling back to the other.
fn candidates(url: &str, variant: &str) -> Vec<String> {
    match f95_attachment_path(url) {
        Some(path) => {
            let original = format!("https://{F95_ORIGINAL_HOST}/{path}");
            let preview = format!("https://{F95_PREVIEW_HOST}/{path}");
            if variant == "cover" {
                vec![original, preview]
            } else {
                vec![preview, original]
            }
        }
        None => vec![url.to_string()],
    }
}

fn cache_path_for_url(cache_root: &Path, url: &str, variant: &str, ext: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hasher.update(variant.as_bytes());
    hasher.update(CACHE_VERSION.as_bytes());
    let hash = hex::encode(hasher.finalize());
    cache_root
        .join("remote")
        .join(variant)
        .join(format!("{hash}.{ext}"))
}

fn encode_jpeg(img: image::DynamicImage, max_edge: u32, cache_path: &Path) -> Result<(), AppError> {
    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Other(e.to_string()))?;
    }
    let preview = img.thumbnail(max_edge, max_edge);
    let rgb = preview.to_rgb8();
    let mut out = std::fs::File::create(cache_path).map_err(|e| AppError::Other(e.to_string()))?;
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, GRID_JPEG_QUALITY);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| AppError::Other(format!("jpeg encode: {e}")))?;
    Ok(())
}

async fn download_image_bytes(client: &Client, url: &str) -> Result<Vec<u8>, AppError> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("download: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "download falhou: HTTP {}",
            resp.status()
        )));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| AppError::Other(format!("download body: {e}")))
}

pub async fn resolve(url: &str, variant: &str, cache_root: &Path) -> Result<String, AppError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Other(format!("url inválida: {url}")));
    }

    let max_edge = max_edge_for_variant(variant)?;

    let jpg_cache = cache_path_for_url(cache_root, url, variant, "jpg");
    if jpg_cache.is_file() {
        return Ok(jpg_cache.to_string_lossy().into_owned());
    }
    let gif_cache = cache_path_for_url(cache_root, url, variant, "gif");
    if gif_cache.is_file() {
        return Ok(gif_cache.to_string_lossy().into_owned());
    }

    let client = Client::builder()
        .user_agent(PROBE_USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(8))
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| AppError::Other(format!("http client: {e}")))?;

    let mut bytes: Option<Vec<u8>> = None;
    let mut last_err: Option<AppError> = None;
    for candidate in candidates(url, variant) {
        match download_image_bytes(&client, &candidate).await {
            Ok(b) => {
                bytes = Some(b);
                break;
            }
            Err(e) => last_err = Some(e),
        }
    }
    let bytes = bytes
        .ok_or_else(|| last_err.unwrap_or_else(|| AppError::Other("download falhou".into())))?;

    tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let format =
            image::guess_format(&bytes).map_err(|e| AppError::Other(format!("formato: {e}")))?;

        if format == image::ImageFormat::Gif {
            if let Some(parent) = gif_cache.parent() {
                std::fs::create_dir_all(parent).map_err(|e| AppError::Other(e.to_string()))?;
            }
            std::fs::write(&gif_cache, &bytes).map_err(|e| AppError::Other(e.to_string()))?;
            return Ok(gif_cache.to_string_lossy().into_owned());
        }

        let img =
            image::load_from_memory(&bytes).map_err(|e| AppError::Other(format!("imagem: {e}")))?;
        let (w, h) = img.dimensions();
        if w <= max_edge && h <= max_edge && format == image::ImageFormat::Jpeg {
            if let Some(parent) = jpg_cache.parent() {
                std::fs::create_dir_all(parent).map_err(|e| AppError::Other(e.to_string()))?;
            }
            std::fs::write(&jpg_cache, &bytes).map_err(|e| AppError::Other(e.to_string()))?;
            return Ok(jpg_cache.to_string_lossy().into_owned());
        }

        encode_jpeg(img, max_edge, &jpg_cache)?;
        Ok(jpg_cache.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| AppError::Other(format!("preview task join: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGINAL: &str = "https://attachments.f95zone.to/2023/08/2896389_bwe_31_copy.jpg";
    const PREVIEW: &str = "https://preview.f95zone.to/2023/08/2896389_bwe_31_copy.jpg";

    #[test]
    fn grids_prefer_the_400px_preview_and_never_the_thumbnail() {
        let thumb = "https://attachments.f95zone.to/2023/08/thumb/2896389_bwe_31_copy.jpg";
        assert_eq!(candidates(thumb, "grid"), vec![PREVIEW, ORIGINAL]);
        assert_eq!(candidates(ORIGINAL, "grid"), vec![PREVIEW, ORIGINAL]);
    }

    #[test]
    fn covers_prefer_the_original() {
        assert_eq!(candidates(PREVIEW, "cover"), vec![ORIGINAL, PREVIEW]);
        assert_eq!(candidates(ORIGINAL, "cover"), vec![ORIGINAL, PREVIEW]);
    }

    #[test]
    fn other_hosts_are_used_as_is() {
        let other = "https://i.imgur.com/abc/thumb/x.png";
        assert_eq!(candidates(other, "cover"), vec![other]);
        assert_eq!(candidates("https://f95zone.to/data/avatars/l/1/1.jpg", "grid").len(), 1);
    }

    #[test]
    fn cache_keys_change_with_the_version_and_variant() {
        let root = Path::new("cache");
        let grid = cache_path_for_url(root, ORIGINAL, "grid", "jpg");
        let cover = cache_path_for_url(root, ORIGINAL, "cover", "jpg");
        assert_ne!(grid, cover);
        assert!(max_edge_for_variant("cover").is_ok());
        assert!(max_edge_for_variant("huge").is_err());
    }
}
