//! AkiraBox (akirabox.com / akirabox.to). The file page carries exact name
//! and size in its Next.js data, no check needed. The download link comes
//! from `POST /api/files/<id>/download` with a Cloudflare Turnstile token,
//! so the user passes that in the app's verification window
//! (`commands::captcha`). The `/download/...` link it yields 302s to a
//! storage host that wants an AkiraBox Referer and supports Range.

use super::super::types::ResolveResult;
use super::super::util::{between, file_name_from_url, html_unescape, is_cloudflare_block};
use crate::error::AppError;
use reqwest::header::ACCEPT;
use reqwest::Url;
use serde_json::{json, Value};

const SITE: &str = "https://akirabox.to";

fn is_akirabox_host(host: &str) -> bool {
    matches!(
        host.trim_start_matches("www."),
        "akirabox.com" | "akirabox.to"
    )
}

#[derive(Debug, PartialEq)]
pub(crate) enum AkiraLink {
    File { id: String },
    Folder { id: String },
    /// An already issued `/download/...` link.
    Download { url: String },
}

pub(crate) fn parse_akirabox_url(raw: &str) -> Option<AkiraLink> {
    let u = Url::parse(raw.trim()).ok()?;
    if !is_akirabox_host(u.host_str()?) {
        return None;
    }
    let segs: Vec<&str> = u.path_segments()?.filter(|s| !s.is_empty()).collect();
    let valid_id = |id: &str| {
        (6..=32).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric())
    };
    match segs.as_slice() {
        ["download", _, ..] => Some(AkiraLink::Download { url: u.to_string() }),
        [id, "file", ..] if valid_id(id) => Some(AkiraLink::File { id: id.to_string() }),
        [id, "folder", ..] if valid_id(id) => Some(AkiraLink::Folder { id: id.to_string() }),
        _ => None,
    }
}

pub(crate) fn file_page_url(id: &str) -> String {
    format!("{SITE}/{id}/file")
}

/// The page the verification window opens for an AkiraBox link.
pub(crate) fn verify_page_url(raw: &str) -> Option<String> {
    match parse_akirabox_url(raw)? {
        AkiraLink::File { id } => Some(file_page_url(&id)),
        AkiraLink::Folder { id } => Some(format!("{SITE}/{id}/folder")),
        AkiraLink::Download { .. } => None,
    }
}

/// The `/download/` link the page is issued: the only thing the window
/// takes from a navigation (any page script can navigate).
pub(crate) fn is_download_link(u: &Url) -> bool {
    match u.host_str() {
        Some(host) => is_akirabox_host(host) && u.path().starts_with("/download/"),
        None => false,
    }
}

/// Also AkiraBox's own storage servers behind that link: where a download
/// the user started from the page itself ends up.
pub(crate) fn is_storage_link(u: &Url) -> bool {
    let Some(host) = u.host_str() else {
        return false;
    };
    let storage_host = host.ends_with(".akirabox.com") || host.ends_with(".akirabox.xyz");
    is_download_link(u) || (storage_host && u.path().contains("/uploads/users/"))
}

/// The same `/download/` link on akirabox.com, which is not behind the
/// Cloudflare check akirabox.to sometimes puts in front of it.
pub(crate) fn alternate_link(link: &str) -> Option<String> {
    let mut u = Url::parse(link).ok()?;
    if u.host_str()?.trim_start_matches("www.") != "akirabox.to" || !u.path().starts_with("/download/") {
        return None;
    }
    u.set_host(Some("akirabox.com")).ok()?;
    Some(u.to_string())
}

pub(crate) fn is_allowed_page(u: &Url) -> bool {
    match u.host_str() {
        Some(h) => is_akirabox_host(h) || h == "challenges.cloudflare.com",
        None => u.scheme() == "about" || u.scheme() == "data",
    }
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct AkiraPage {
    pub name: Option<String>,
    pub size: Option<u64>,
    pub folder: bool,
    pub password: bool,
    pub gone: bool,
    /// `limits.captcha`; true for every anonymous visitor seen so far.
    pub captcha: bool,
    pub sha256: Option<String>,
}

/// Concatenated `self.__next_f.push([1,"..."])` strings of a Next.js page.
fn next_flight_data(html: &str) -> String {
    const START: &str = "self.__next_f.push([1,\"";
    let mut out = String::new();
    let mut rest = html;
    while let Some(i) = rest.find(START) {
        let body = &rest[i + START.len()..];
        // Find the closing quote, skipping escaped characters.
        let bytes = body.as_bytes();
        let mut j = 0;
        while j < bytes.len() && bytes[j] != b'"' {
            j += if bytes[j] == b'\\' { 2 } else { 1 };
        }
        let raw = &body[..j.min(body.len())];
        if let Ok(s) = serde_json::from_str::<String>(&format!("\"{raw}\"")) {
            out.push_str(&s);
        }
        rest = &body[j.min(body.len())..];
    }
    out
}

/// First JSON object that follows `"key":` in `data`.
fn json_after(data: &str, key: &str) -> Option<Value> {
    let needle = format!("\"{key}\":");
    let mut from = 0;
    while let Some(i) = data[from..].find(&needle) {
        let start = from + i + needle.len();
        let value = serde_json::Deserializer::from_str(&data[start..])
            .into_iter::<Value>()
            .next()
            .and_then(Result::ok);
        if let Some(v) = value.filter(Value::is_object) {
            return Some(v);
        }
        from = start;
    }
    None
}

pub(crate) fn parse_akirabox_page(html: &str) -> Option<AkiraPage> {
    let data = next_flight_data(html);
    let mut page = AkiraPage {
        captcha: true,
        ..Default::default()
    };
    if let Some(file) = json_after(&data, "file") {
        let name = file.get("name").and_then(Value::as_str).unwrap_or("").trim();
        let ext = file.get("extension").and_then(Value::as_str).unwrap_or("").trim();
        if !name.is_empty() {
            let full = if ext.is_empty() || name.to_lowercase().ends_with(&format!(".{}", ext.to_lowercase())) {
                name.to_string()
            } else {
                format!("{name}.{ext}")
            };
            page.name = Some(full);
        }
        page.size = file.get("size").and_then(Value::as_u64);
        page.folder = file.get("kind").and_then(Value::as_str) == Some("folder");
        page.password = file.get("password").and_then(Value::as_bool).unwrap_or(false);
        page.gone = ["trashedAt", "purgeAt"]
            .iter()
            .any(|k| file.get(*k).is_some_and(|v| !v.is_null()));
    } else {
        // Layout changed: fall back to the title, "<name.ext> · AkiraBox".
        let title = between(html, "<title>", "</title>")?;
        let name = html_unescape(title.trim_end_matches(" · AkiraBox").trim());
        if name.is_empty() || name == "AkiraBox" {
            return None;
        }
        page.name = Some(name);
    }
    if let Some(limits) = json_after(&data, "limits") {
        page.captcha = limits.get("captcha").and_then(Value::as_bool).unwrap_or(true);
    }
    page.sha256 = json_after(&data, "sha256")
        .and_then(|v| v.get("value").and_then(Value::as_str).map(str::to_lowercase))
        .filter(|s| s.len() == 64);
    Some(page)
}

fn gone() -> AppError {
    AppError::download("file_gone", "AkiraBox: file removed or not available")
}

async fn fetch_page(http: &reqwest::Client, id: &str) -> Result<Result<AkiraPage, ()>, AppError> {
    let resp = http
        .get(file_page_url(id))
        .header(ACCEPT, "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("akirabox page: {e}")))?;
    let status = resp.status().as_u16();
    let cf = resp.headers().contains_key("cf-mitigated");
    let html = resp.text().await.unwrap_or_default();
    if status == 404 {
        return Err(gone());
    }
    if is_cloudflare_block(status, cf, &html) || !(200..300).contains(&status) {
        return Ok(Err(()));
    }
    Ok(parse_akirabox_page(&html).ok_or(()))
}

/// Download link without the check, for when the site ever turns it off.
async fn link_without_check(http: &reqwest::Client, id: &str) -> Option<String> {
    let resp = http
        .post(format!("{SITE}/api/files/{id}/download"))
        .header("Referer", file_page_url(id))
        .json(&json!({}))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: Value = resp.json().await.ok()?;
    v.get("url")?
        .as_str()
        .filter(|s| s.starts_with("http"))
        .map(str::to_string)
}

fn direct(link: String, page: &str, info: Option<AkiraPage>) -> ResolveResult {
    let (name, size, sha) = match info {
        Some(p) => (p.name, p.size, p.sha256),
        None => (None, None, None),
    };
    ResolveResult::Direct {
        file_name: name
            .or_else(|| file_name_from_url(&link))
            .unwrap_or_else(|| "akirabox-download.bin".into()),
        url: link,
        file_size: size,
        expected_sha256: sha,
        // Storage answers 403 "Access denied." without an AkiraBox Referer.
        extra_headers: vec![("Referer".into(), page.to_string())],
    }
}

pub(crate) async fn resolve_akirabox(
    http: &reqwest::Client,
    url: &str,
    label: &str,
) -> Result<ResolveResult, AppError> {
    let needs_browser = |page: String| ResolveResult::NeedsBrowser {
        url: page,
        host: label.into(),
    };
    let id = match parse_akirabox_url(url) {
        None => return Ok(needs_browser(url.to_string())),
        Some(AkiraLink::Download { url: link }) => {
            return Ok(direct(link, &format!("{SITE}/"), None));
        }
        // Each file in a folder needs its own check: the window shows the
        // folder and takes whichever file the user picks there.
        Some(AkiraLink::Folder { id }) => return Ok(needs_browser(format!("{SITE}/{id}/folder"))),
        Some(AkiraLink::File { id }) => id,
    };
    let page_url = file_page_url(&id);
    let page = match fetch_page(http, &id).await? {
        Ok(p) => p,
        Err(()) => return Ok(needs_browser(page_url)),
    };
    if page.gone {
        return Err(gone());
    }
    if page.password || page.folder {
        return Ok(needs_browser(page_url));
    }
    if !page.captcha {
        if let Some(link) = link_without_check(http, &id).await {
            return Ok(direct(link, &page_url, Some(page)));
        }
    }
    Ok(needs_browser(page_url))
}

/// Download for a link the verification window captured. The page is read
/// again for the exact name and size, so a resumed `.part` keeps its name.
pub(crate) async fn direct_from_verified(
    http: &reqwest::Client,
    page: &str,
    link: &str,
) -> Result<ResolveResult, AppError> {
    let info = match parse_akirabox_url(page) {
        Some(AkiraLink::File { id }) => fetch_page(http, &id).await.ok().and_then(Result::ok),
        _ => None,
    };
    let referer = match parse_akirabox_url(page) {
        Some(AkiraLink::File { id }) => file_page_url(&id),
        _ => format!("{SITE}/"),
    };
    Ok(direct(link.to_string(), &referer, info.filter(|p| !p.folder)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_links() {
        assert_eq!(
            parse_akirabox_url("https://akirabox.com/LJlGnVb8AG15/file"),
            Some(AkiraLink::File {
                id: "LJlGnVb8AG15".into()
            })
        );
        assert_eq!(
            parse_akirabox_url("https://www.akirabox.to/Z9dzBXkqmk1b/folder?page=2"),
            Some(AkiraLink::Folder {
                id: "Z9dzBXkqmk1b".into()
            })
        );
        assert!(matches!(
            parse_akirabox_url("https://akirabox.to/download/eyJpdiI6/game.zip?expiration=1&t=2&s=3"),
            Some(AkiraLink::Download { .. })
        ));
        assert_eq!(parse_akirabox_url("https://akirabox.to/LJlGnVb8AG15"), None);
        assert_eq!(parse_akirabox_url("https://example.com/LJlGnVb8AG15/file"), None);
        assert_eq!(
            verify_page_url("https://akirabox.com/LJlGnVb8AG15/file").as_deref(),
            Some("https://akirabox.to/LJlGnVb8AG15/file")
        );
    }

    #[test]
    fn recognizes_captured_links() {
        let url = |raw: &str| Url::parse(raw).unwrap();
        assert!(is_download_link(&url("https://akirabox.to/download/eyJpdiI6/game.zip?expiration=1&t=2&s=3")));
        // Storage only counts for a download the page itself started.
        for raw in [
            "https://us1.akirabox.com/uploads/users/1/abc-game.zip?access=1.sig",
            "https://eufb.akirabox.xyz/uploads/users/1/abc-game.zip?access=1",
        ] {
            assert!(!is_download_link(&url(raw)), "{raw}");
            assert!(is_storage_link(&url(raw)), "{raw}");
        }
        for raw in [
            "https://akirabox.to/Z9dzBXkqmk1b/file",
            "https://akirabox.to/api/files/Z9dzBXkqmk1b/download",
            "https://ads.example.com/uploads/users/1/x.zip",
            "https://x.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/uploads/users/1/x.zip",
        ] {
            assert!(!is_download_link(&url(raw)), "{raw}");
            assert!(!is_storage_link(&url(raw)), "{raw}");
        }
        assert_eq!(
            alternate_link("https://akirabox.to/download/abc/game.zip?s=1").as_deref(),
            Some("https://akirabox.com/download/abc/game.zip?s=1")
        );
        assert_eq!(alternate_link("https://akirabox.com/download/abc/game.zip"), None);
        assert_eq!(alternate_link("https://vikingfile.com/d/abc/game.zip"), None);
    }

    /// Trimmed from a live page: the data sits in escaped JS strings.
    const PAGE: &str = r#"<html><head><title>horny.craft-0.24.1.apk · AkiraBox</title></head><body>
<script>self.__next_f.push([1,"1:I[39756,[\"x\"]]\n"])</script>
<script>self.__next_f.push([1,"7:[\"$\",\"$L1b\",null,{\"file\":{\"id\":\"Z9dzBXkqmk1b\",\"numericId\":21397,\"name\":\"horny.craft-0.24.1\",\"extension\":\"apk\",\"size\":1900631465,\"kind\":\"file\",\"password\":false,\"parentId\":null,\"trashedAt\":null,\"purgeAt\":null},\"sha256\":{\"value\":null,\"pending\":false},\"limits\":{\"waitSeconds\":0,\"captcha\":true},\"linkMoved\":false}]\n"])</script>
</body></html>"#;

    #[test]
    fn parses_page_data() {
        let page = parse_akirabox_page(PAGE).unwrap();
        assert_eq!(page.name.as_deref(), Some("horny.craft-0.24.1.apk"));
        assert_eq!(page.size, Some(1900631465));
        assert!(page.captcha);
        assert!(!page.gone && !page.password && !page.folder);
        assert_eq!(page.sha256, None);
    }

    #[test]
    fn page_flags() {
        let trashed = PAGE
            .replace(r#"\"trashedAt\":null"#, r#"\"trashedAt\":\"2026-09-01T00:00:00Z\""#)
            .replace(r#"\"password\":false"#, r#"\"password\":true"#)
            .replace(r#"\"captcha\":true"#, r#"\"captcha\":false"#);
        let page = parse_akirabox_page(&trashed).unwrap();
        assert!(page.gone && page.password && !page.captcha);
        // Name already carrying its extension is not doubled.
        let named = PAGE.replace(r#"\"name\":\"horny.craft-0.24.1\""#, r#"\"name\":\"game.APK\""#);
        assert_eq!(parse_akirabox_page(&named).unwrap().name.as_deref(), Some("game.APK"));
    }

    #[test]
    fn title_fallback() {
        let html = "<title>Game &amp; Co.zip · AkiraBox</title>";
        assert_eq!(
            parse_akirabox_page(html).unwrap().name.as_deref(),
            Some("Game & Co.zip")
        );
        assert_eq!(parse_akirabox_page("<p>nothing</p>"), None);
    }
}
