//! `f95img`: images on f95zone.to (avatars, profile covers, smilies) for the
//! webviews.
//!
//! Since 2026-10-19 Cloudflare challenges every f95zone.to request without
//! its clearance cookie, so an `<img>` pointing there gets a 403 page. The
//! frontend points those images here instead (`src/lib/f95ImageUrl.ts`),
//! keeping the path and query: `http://f95img.localhost/data/avatars/…` on
//! Windows, `f95img://localhost/data/avatars/…` elsewhere. The sidecar loads
//! them with the cookies and User-Agent it passed the check with.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::commands::{ensure_sidecar, AppState};
use crate::error::AppError;

pub const SCHEME: &str = "f95img";

const F95_ORIGIN: &str = "https://f95zone.to";
/// The same folders the sidecar accepts (`domain/f95/image.ts`).
const IMAGE_PREFIXES: [&str; 3] = ["/data/", "/styles/", "/assets/"];

/// Right after start the cached profile shows before the sidecar has a
/// fresh clearance; the profile call that renews it takes a few seconds.
const ATTEMPTS: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_secs(3);

const CACHE_MAX_ENTRIES: usize = 400;
const CACHE_MAX_BYTES: usize = 32 * 1024 * 1024;

/// The f95zone.to URL a request stands for, or None outside the image folders.
pub(crate) fn source_url(path_and_query: &str) -> Option<String> {
    let path = path_and_query.split('?').next().unwrap_or_default();
    if path.contains("..") || !IMAGE_PREFIXES.iter().any(|p| path.starts_with(p)) {
        return None;
    }
    Some(format!("{F95_ORIGIN}{path_and_query}"))
}

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let path_and_query = request
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_default();
    tauri::async_runtime::spawn(async move {
        responder.respond(respond(&app, &path_and_query).await);
    });
}

async fn respond<R: Runtime>(app: &AppHandle<R>, path_and_query: &str) -> Response<Vec<u8>> {
    let Some(url) = source_url(path_and_query) else {
        return status(StatusCode::NOT_FOUND);
    };
    if let Some(hit) = cache().get(&url) {
        return image(&hit.0, hit.1.as_ref().clone());
    }
    match load(app, &url).await {
        Ok((content_type, bytes)) => {
            let bytes = Arc::new(bytes);
            cache().put(url, content_type.clone(), bytes.clone());
            image(&content_type, bytes.as_ref().clone())
        }
        Err(e) => {
            eprintln!("[f95img] {url}: {e}");
            status(StatusCode::BAD_GATEWAY)
        }
    }
}

async fn load<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<(String, Vec<u8>), AppError> {
    let state = app.state::<AppState>();
    let mut attempt = 1;
    loop {
        let result = async {
            let client = ensure_sidecar(&state).await?;
            client.fetch_f95_image(url).await
        }
        .await;
        match result {
            Ok(img) => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(img.data.as_bytes())
                    .map_err(|e| AppError::Other(format!("image base64: {e}")))?;
                return Ok((img.content_type, bytes));
            }
            Err(e) if attempt < ATTEMPTS && worth_retrying(&e) => {
                eprintln!("[f95img] {url}: {e} (trying again)");
                attempt += 1;
                tokio::time::sleep(RETRY_DELAY).await;
            }
            Err(e) => return Err(e),
        }
    }
}

/// A sidecar still starting, or Cloudflare's check before the clearance is
/// renewed; anything else (a deleted avatar's 404) won't change.
fn worth_retrying(e: &AppError) -> bool {
    matches!(e, AppError::NotInitialized | AppError::SidecarCrash) || e.to_string().contains("HTTP 403")
}

fn image(content_type: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "private, max-age=86400")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    let mut res = Response::new(Vec::new());
    *res.status_mut() = code;
    res
}

/// Recently shown images, so moving between pages doesn't ask the sidecar
/// for the same avatars again. Oldest out first.
#[derive(Default)]
struct Cache {
    entries: HashMap<String, (String, Arc<Vec<u8>>)>,
    order: VecDeque<String>,
    bytes: usize,
}

struct SharedCache(Mutex<Cache>);

fn cache() -> &'static SharedCache {
    static CACHE: OnceLock<SharedCache> = OnceLock::new();
    CACHE.get_or_init(|| SharedCache(Mutex::new(Cache::default())))
}

impl SharedCache {
    fn get(&self, url: &str) -> Option<(String, Arc<Vec<u8>>)> {
        self.0.lock().ok()?.entries.get(url).cloned()
    }

    fn put(&self, url: String, content_type: String, bytes: Arc<Vec<u8>>) {
        let Ok(mut cache) = self.0.lock() else {
            return;
        };
        if bytes.len() > CACHE_MAX_BYTES / 4 || cache.entries.contains_key(&url) {
            return;
        }
        cache.bytes += bytes.len();
        cache.order.push_back(url.clone());
        cache.entries.insert(url, (content_type, bytes));
        while cache.entries.len() > CACHE_MAX_ENTRIES || cache.bytes > CACHE_MAX_BYTES {
            let Some(oldest) = cache.order.pop_front() else {
                break;
            };
            if let Some((_, old)) = cache.entries.remove(&oldest) {
                cache.bytes -= old.len();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_image_folders_map_to_f95zone() {
        assert_eq!(
            source_url("/data/avatars/s/123/123456.jpg?1700000000").as_deref(),
            Some("https://f95zone.to/data/avatars/s/123/123456.jpg?1700000000")
        );
        assert_eq!(
            source_url("/styles/default/xenforo/smilies/smile.png").as_deref(),
            Some("https://f95zone.to/styles/default/xenforo/smilies/smile.png")
        );
        assert_eq!(source_url("/threads/foo.1/"), None);
        assert_eq!(source_url("/login/login"), None);
        assert_eq!(source_url("/data/../account/"), None);
        assert_eq!(source_url(""), None);
    }

    #[test]
    fn cache_drops_the_oldest_past_its_limit() {
        let cache = SharedCache(Mutex::new(Cache::default()));
        for i in 0..CACHE_MAX_ENTRIES + 5 {
            cache.put(format!("u{i}"), "image/png".into(), Arc::new(vec![0u8; 4]));
        }
        assert!(cache.get("u0").is_none());
        assert!(cache.get(&format!("u{}", CACHE_MAX_ENTRIES + 4)).is_some());
        let inner = cache.0.lock().unwrap();
        assert_eq!(inner.entries.len(), CACHE_MAX_ENTRIES);
        assert_eq!(inner.bytes, CACHE_MAX_ENTRIES * 4);
    }
}
