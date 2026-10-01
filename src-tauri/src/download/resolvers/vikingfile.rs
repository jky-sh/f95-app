//! VikingFile. Name, size and liveness come from the public `check-file`
//! API with no browser. The download link (`vikingfile.com/d/<id>/<name>`)
//! only exists after Cloudflare Turnstile on the file page, which the user
//! passes in the app's verification window (`commands::captcha`). That link
//! then downloads and resumes like any direct URL.

use super::super::types::ResolveResult;
use super::super::util::file_name_from_url;
use crate::error::AppError;
use reqwest::Url;
use serde_json::Value;

const CHECK_FILE_API: &str = "https://vikingfile.com/api/check-file";
/// File pages live here; `vikingfile.com/f/<hash>` only 302s to it.
const PAGE_BASE: &str = "https://vik1ngfile.site/f/";

fn is_vikingfile_host(host: &str) -> bool {
    let host = host.trim_start_matches("www.");
    matches!(host, "vikingfile.com" | "vik1ngfile.site" | "vikingf1le.us.to")
}

#[derive(Debug, PartialEq)]
pub(crate) enum VikingLink {
    /// `/f/<hash>`: the landing page with the check.
    Page { hash: String },
    /// `/d/<id>/<name>`: an already issued download link.
    Download { url: String },
}

pub(crate) fn parse_vikingfile_url(raw: &str) -> Option<VikingLink> {
    let mut u = Url::parse(raw.trim()).ok()?;
    if !is_vikingfile_host(u.host_str()?) {
        return None;
    }
    u.set_fragment(None);
    let segs: Vec<&str> = u.path_segments()?.filter(|s| !s.is_empty()).collect();
    match segs.as_slice() {
        ["f", hash, ..]
            if (6..=16).contains(&hash.len()) && hash.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            Some(VikingLink::Page {
                hash: hash.to_string(),
            })
        }
        ["d", _, _, ..] => {
            // Plain http answers 404 here, so always ask over https.
            let _ = u.set_scheme("https");
            Some(VikingLink::Download { url: u.to_string() })
        }
        _ => None,
    }
}

pub(crate) fn page_url(hash: &str) -> String {
    format!("{PAGE_BASE}{hash}")
}

/// The page the verification window opens for a VikingFile link.
pub(crate) fn verify_page_url(raw: &str) -> Option<String> {
    match parse_vikingfile_url(raw)? {
        VikingLink::Page { hash } => Some(page_url(&hash)),
        VikingLink::Download { .. } => None,
    }
}

/// VikingFile's own Cloudflare R2 account, where `/d/` links redirect.
const R2_ACCOUNT_SUFFIX: &str = ".04b3d96d52475741e6b10f97f0a84a16.r2.cloudflarestorage.com";

/// The `/d/` link the page produces once its check passes: the only thing
/// the window takes from a navigation (any page script can navigate).
pub(crate) fn is_download_link(u: &Url) -> bool {
    match u.host_str() {
        Some(host) => is_vikingfile_host(host) && u.path().starts_with("/d/"),
        None => false,
    }
}

/// Also VikingFile's storage behind that link (its regional servers, its R2
/// account): where a download the user started from the page itself ends up.
pub(crate) fn is_storage_link(u: &Url) -> bool {
    let Some(host) = u.host_str() else {
        return false;
    };
    is_download_link(u)
        || host.ends_with(R2_ACCOUNT_SUFFIX)
        || (host.ends_with(".vikingfile.com") && host != "upload.vikingfile.com")
}

/// Navigation the verification window allows besides the captured link.
pub(crate) fn is_allowed_page(u: &Url) -> bool {
    match u.host_str() {
        Some(h) => is_vikingfile_host(h) || h == "challenges.cloudflare.com",
        None => u.scheme() == "about" || u.scheme() == "data",
    }
}

#[derive(Debug, PartialEq)]
pub(crate) struct VikingInfo {
    pub name: String,
    pub size: Option<u64>,
}

/// `check-file` answers with an array (one entry per hash, in order); old
/// docs show a bare object. `Ok(None)` means the file is gone.
pub(crate) fn parse_check_file(body: &str) -> Result<Option<VikingInfo>, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("check-file json: {e}"))?;
    let entry = match &v {
        Value::Array(items) => items.first().cloned().unwrap_or(Value::Null),
        other => other.clone(),
    };
    if !entry.is_object() {
        return Err("check-file: empty answer".into());
    }
    if !entry.get("exist").and_then(Value::as_bool).unwrap_or(false) {
        return Ok(None);
    }
    let name = entry
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("vikingfile-download.bin")
        .to_string();
    let size = entry.get("size").and_then(Value::as_u64);
    Ok(Some(VikingInfo { name, size }))
}

async fn check_file(http: &reqwest::Client, hash: &str) -> Result<Option<VikingInfo>, AppError> {
    let body = http
        .post(CHECK_FILE_API)
        .form(&[("hash", hash)])
        .send()
        .await
        .map_err(|e| AppError::Other(format!("vikingfile check-file: {e}")))?
        .text()
        .await
        .map_err(|e| AppError::Other(format!("vikingfile check-file body: {e}")))?;
    parse_check_file(&body).map_err(AppError::Other)
}

fn gone() -> AppError {
    AppError::download(
        "file_gone",
        "VikingFile: file removed or expired (free files are deleted 15 days after the last download)",
    )
}

pub(crate) async fn resolve_vikingfile(
    http: &reqwest::Client,
    url: &str,
    label: &str,
) -> Result<ResolveResult, AppError> {
    let needs_browser = |page: String| ResolveResult::NeedsBrowser {
        url: page,
        host: label.into(),
    };
    match parse_vikingfile_url(url) {
        None => Ok(needs_browser(url.to_string())),
        Some(VikingLink::Download { url: link }) => Ok(ResolveResult::Direct {
            file_name: file_name_from_url(&link).unwrap_or_else(|| "vikingfile-download.bin".into()),
            url: link,
            file_size: None,
            expected_sha256: None,
            extra_headers: Vec::new(),
        }),
        Some(VikingLink::Page { hash }) => match check_file(http, &hash).await {
            Ok(None) => Err(gone()),
            // Alive (or the API hiccuped): the link itself needs the check.
            Ok(Some(_)) | Err(_) => Ok(needs_browser(page_url(&hash))),
        },
    }
}

/// Download for a link the verification window captured. Name and size come
/// from `check-file` again so a resumed `.part` keeps the same file name.
pub(crate) async fn direct_from_verified(
    http: &reqwest::Client,
    page: &str,
    link: &str,
) -> Result<ResolveResult, AppError> {
    let info = match parse_vikingfile_url(page) {
        Some(VikingLink::Page { hash }) => check_file(http, &hash).await.ok().flatten(),
        _ => None,
    };
    let (file_name, file_size) = match info {
        Some(i) => (i.name, i.size),
        None => (
            file_name_from_url(link).unwrap_or_else(|| "vikingfile-download.bin".into()),
            None,
        ),
    };
    Ok(ResolveResult::Direct {
        url: link.to_string(),
        file_name,
        file_size,
        expected_sha256: None,
        extra_headers: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_page_links_on_every_domain() {
        for raw in [
            "https://vikingfile.com/f/TPRSfLvcIu",
            "https://vik1ngfile.site/f/TPRSfLvcIu",
            "https://vikingf1le.us.to/f/TPRSfLvcIu/",
            "https://vikingfile.com/f/TPRSfLvcIu#Game.zip - 1.2 GB",
        ] {
            assert_eq!(
                parse_vikingfile_url(raw),
                Some(VikingLink::Page {
                    hash: "TPRSfLvcIu".into()
                }),
                "{raw}"
            );
        }
        assert_eq!(
            verify_page_url("https://vikingfile.com/f/TPRSfLvcIu").as_deref(),
            Some("https://vik1ngfile.site/f/TPRSfLvcIu")
        );
    }

    #[test]
    fn parses_download_links_and_rejects_others() {
        assert_eq!(
            parse_vikingfile_url("http://vikingfile.com/d/30zNxeO6vB/Some%20Game.zip"),
            Some(VikingLink::Download {
                url: "https://vikingfile.com/d/30zNxeO6vB/Some%20Game.zip".into()
            })
        );
        assert_eq!(parse_vikingfile_url("https://vikingfile.com/premium"), None);
        assert_eq!(parse_vikingfile_url("https://example.com/f/TPRSfLvcIu"), None);
        assert_eq!(parse_vikingfile_url("https://vikingfile.com/f/a!b"), None);
    }

    #[test]
    fn recognizes_captured_links() {
        let url = |raw: &str| Url::parse(raw).unwrap();
        assert!(is_download_link(&url("https://vikingfile.com/d/30zNxeO6vB/Game.zip")));
        // Storage only counts for a download the page itself started.
        for raw in [
            "https://bucket.04b3d96d52475741e6b10f97f0a84a16.r2.cloudflarestorage.com/x?X-Amz-Signature=1",
            "https://ko.vikingfile.com/file?md5=1&expires=2",
        ] {
            assert!(!is_download_link(&url(raw)), "{raw}");
            assert!(is_storage_link(&url(raw)), "{raw}");
        }
        for raw in [
            "https://vik1ngfile.site/f/TPRSfLvcIu",
            "https://upload.vikingfile.com/upload",
            "https://ads.example.com/d/x/y",
            // Anyone can presign a URL on their own R2 account.
            "https://evil.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/a.zip",
        ] {
            assert!(!is_download_link(&url(raw)), "{raw}");
            assert!(!is_storage_link(&url(raw)), "{raw}");
        }
        assert!(is_allowed_page(&Url::parse("https://challenges.cloudflare.com/x").unwrap()));
        assert!(!is_allowed_page(&Url::parse("https://popunder.example/").unwrap()));
    }

    #[test]
    fn parses_check_file_answers() {
        let alive = r#"[{"exist":true,"hash":"A0N4oHXRDy","name":"Game v1.0.zip","size":355648762}]"#;
        assert_eq!(
            parse_check_file(alive).unwrap(),
            Some(VikingInfo {
                name: "Game v1.0.zip".into(),
                size: Some(355648762)
            })
        );
        let gone = r#"[{"exist":false,"hash":"ZZZZZZZZZZ"}]"#;
        assert_eq!(parse_check_file(gone).unwrap(), None);
        let legacy = r#"{"exist":true,"name":"a.7z","size":10}"#;
        assert_eq!(parse_check_file(legacy).unwrap().unwrap().size, Some(10));
        assert!(parse_check_file("[]").is_err());
        assert!(parse_check_file("<html>").is_err());
    }
}
