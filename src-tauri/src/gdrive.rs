//! Google Drive link resolver.
//!
//! Public share links (`/file/d/…`, `/open?id=…`, `/folders/…`) are turned into
//! a direct stream URL via the classic `uc?export=download` endpoint. Large files
//! trigger Google's virus-scan interstitial; we parse the `confirm` token (or
//! `download_warning` cookie) and retry once.

use crate::error::AppError;
use reqwest::header::{CONTENT_DISPOSITION, CONTENT_TYPE, SET_COOKIE};
use reqwest::Client;
use reqwest::StatusCode;

pub struct GdriveDirect {
    pub url: String,
    pub file_name: String,
    pub file_size: Option<u64>,
    pub extra_headers: Vec<(String, String)>,
}

pub enum GdriveOutcome {
    Direct(GdriveDirect),
    NeedsBrowser,
}

/// True when bytes look like an HTML error / interstitial page, not a real file.
pub fn looks_like_html_bytes(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(4096)];
    // Any case, with or without a BOM or leading whitespace.
    let lossy = String::from_utf8_lossy(head);
    let start = lossy
        .trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
        .chars()
        .take(16)
        .collect::<String>()
        .to_ascii_lowercase();
    if ["<!doctype", "<html", "<head", "<body"]
        .iter()
        .any(|p| start.starts_with(p))
    {
        return true;
    }
    // The markers below are only meaningful in text: a binary file may
    // contain those bytes by chance. Text cut mid-character at the end of the
    // chunk still counts as text.
    let text = match std::str::from_utf8(head) {
        Ok(s) => s,
        Err(e) if e.error_len().is_none() => std::str::from_utf8(&head[..e.valid_up_to()])
            .unwrap_or_default(),
        Err(_) => return false,
    };
    text.contains("Error 404")
        || text.contains("af-error-container")
        || text.contains("Google Drive - Virus scan warning")
        || text.contains("Google Drive - Quota exceeded")
}

/// Extract a Drive file/folder id from common share URL shapes.
pub fn extract_gdrive_id(url: &str) -> Option<String> {
    let trimmed = url.trim();
    for prefix in &[
        "/file/d/",
        "/document/d/",
        "/spreadsheets/d/",
        "/presentation/d/",
    ] {
        if let Some(rest) = trimmed.split(prefix).nth(1) {
            let id = rest.split('/').next()?.split('?').next()?.trim();
            if is_plausible_id(id) {
                return Some(id.to_string());
            }
        }
    }
    if let Some(rest) = trimmed.split("/folders/").nth(1) {
        let id = rest.split('/').next()?.split('?').next()?.trim();
        if is_plausible_id(id) {
            return Some(id.to_string());
        }
    }
    if let Some(q) = trimmed.split('?').nth(1) {
        for pair in q.split('&') {
            let mut kv = pair.splitn(2, '=');
            let key = kv.next()?;
            if key == "id" {
                let id = kv.next()?.trim();
                if is_plausible_id(id) {
                    return Some(id.to_string());
                }
            }
        }
    }
    None
}

fn is_plausible_id(id: &str) -> bool {
    id.len() >= 10
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub async fn resolve(http: &Client, url: &str) -> Result<GdriveOutcome, AppError> {
    let Some(id) = extract_gdrive_id(url) else {
        return Ok(GdriveOutcome::NeedsBrowser);
    };

    // Seed cookies from the view page, then try the modern usercontent endpoint.
    let view_url = format!("https://drive.google.com/file/d/{id}/view");
    let view_resp = http.get(&view_url).send().await;
    if let Ok(resp) = view_resp {
        if let Ok(html) = resp.text().await {
            if gdrive_permission_denied(&html) {
                return Ok(GdriveOutcome::NeedsBrowser);
            }
        }
    }

    let user_url =
        format!("https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t");
    if let Some(direct) =
        probe_direct_url(http, url, &user_url, &default_name(&id, false), None).await?
    {
        return Ok(GdriveOutcome::Direct(direct));
    }

    let initial = format!("https://drive.google.com/uc?export=download&id={id}");
    let resp = http
        .get(&initial)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .send()
        .await
        .map_err(|e| AppError::Other(format!("gdrive http: {e}")))?;

    resolve_from_response(http, url, &id, resp).await
}

async fn resolve_from_response(
    http: &Client,
    original_url: &str,
    id: &str,
    resp: reqwest::Response,
) -> Result<GdriveOutcome, AppError> {
    let status = resp.status();
    let final_url = resp.url().to_string();
    let content_type = content_type_lower(resp.headers());
    let confirm_cookie = download_warning_cookie(&resp);

    // Small public file — binary returned directly (no interstitial).
    if status.is_success() && looks_like_binary(&content_type) {
        let headers = resp.headers().clone();
        let peek = resp
            .bytes()
            .await
            .map_err(|e| AppError::Other(format!("gdrive body: {e}")))?;
        if looks_like_html_bytes(&peek) {
            let html = String::from_utf8_lossy(&peek).into_owned();
            return handle_interstitial(http, original_url, id, &html, confirm_cookie).await;
        }
        let mut file_name = filename_from_headers(&headers);
        if file_name.is_none() {
            file_name = fetch_view_title(http, id).await;
        }
        let file_name = file_name.unwrap_or_else(|| default_name(id, false));
        let file_size = Some(peek.len() as u64);
        return Ok(GdriveOutcome::Direct(GdriveDirect {
            url: final_url,
            file_name,
            file_size,
            extra_headers: gdrive_headers(original_url),
        }));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("gdrive body: {e}")))?;

    if status == StatusCode::NOT_FOUND || gdrive_permission_denied(&html) {
        return Ok(GdriveOutcome::NeedsBrowser);
    }

    // Redirect landed on usercontent but body is HTML (404 page, quota, virus scan).
    if is_gdrive_cdn_url(&final_url) && looks_like_html_content(&content_type, &html) {
        if gdrive_error_page(&html) {
            return Ok(GdriveOutcome::NeedsBrowser);
        }
        return handle_interstitial(http, original_url, id, &html, confirm_cookie).await;
    }

    if looks_like_html_content(&content_type, &html) {
        return handle_interstitial(http, original_url, id, &html, confirm_cookie).await;
    }

    Ok(GdriveOutcome::NeedsBrowser)
}

async fn handle_interstitial(
    http: &Client,
    original_url: &str,
    id: &str,
    html: &str,
    confirm_cookie: Option<String>,
) -> Result<GdriveOutcome, AppError> {
    if gdrive_permission_denied(html) {
        return Ok(GdriveOutcome::NeedsBrowser);
    }

    let is_folder = original_url.contains("/folders/") || html.contains("Google Drive Folder");
    let mut file_name = filename_from_html(html);
    if file_name.is_none() {
        file_name = fetch_view_title(http, id).await;
    }
    let file_name = file_name.unwrap_or_else(|| default_name(id, is_folder));
    let file_size = file_size_from_html(html);

    // Newer pages embed the CDN URL directly in the form / links.
    if let Some(cdn) = find_usercontent_url(html) {
        if let Some(direct) =
            probe_direct_url(http, original_url, &cdn, &file_name, file_size).await?
        {
            return Ok(GdriveOutcome::Direct(direct));
        }
    }

    let confirm = confirm_cookie
        .or_else(|| find_confirm_token(html))
        .or_else(|| find_confirm_token_loose(html));

    let Some(token) = confirm else {
        return Ok(GdriveOutcome::NeedsBrowser);
    };

    let confirm_url =
        format!("https://drive.google.com/uc?export=download&confirm={token}&id={id}");

    match probe_direct_url(http, original_url, &confirm_url, &file_name, file_size).await? {
        Some(direct) => Ok(GdriveOutcome::Direct(direct)),
        None => Ok(GdriveOutcome::NeedsBrowser),
    }
}

async fn probe_direct_url(
    http: &Client,
    original_url: &str,
    url: &str,
    fallback_name: &str,
    fallback_size: Option<u64>,
) -> Result<Option<GdriveDirect>, AppError> {
    let resp = http
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Referer", original_url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("gdrive probe http: {e}")))?;

    let status = resp.status();
    let final_url = resp.url().to_string();
    let ct = content_type_lower(resp.headers());

    if status.is_success() && looks_like_binary(&ct) {
        let headers = resp.headers().clone();
        let peek = resp
            .bytes()
            .await
            .map_err(|e| AppError::Other(format!("gdrive probe body: {e}")))?;
        if looks_like_html_bytes(&peek) {
            return Ok(None);
        }
        let file_name = filename_from_headers(&headers)
            .map(|n| sanitize_file_name(n, fallback_name))
            .unwrap_or_else(|| fallback_name.to_string());
        let file_size = Some(peek.len() as u64).or(fallback_size);
        return Ok(Some(GdriveDirect {
            url: final_url,
            file_name,
            file_size,
            extra_headers: gdrive_headers(original_url),
        }));
    }

    if status.is_success() || is_gdrive_cdn_url(&final_url) {
        let html = resp
            .text()
            .await
            .map_err(|e| AppError::Other(format!("gdrive probe body: {e}")))?;
        if gdrive_error_page(&html) || gdrive_permission_denied(&html) {
            return Ok(None);
        }
    }

    Ok(None)
}

async fn fetch_view_title(http: &Client, id: &str) -> Option<String> {
    let view_url = format!("https://drive.google.com/file/d/{id}/view");
    let html = http.get(&view_url).send().await.ok()?.text().await.ok()?;

    if gdrive_permission_denied(&html) {
        return None;
    }

    // og:title
    if let Some(title) = meta_content(&html, "og:title") {
        let cleaned = sanitize_title(&title);
        if cleaned.contains('.') {
            return Some(cleaned);
        }
    }

    // Embedded JSON: "title":"My Game.zip"
    if let Some(idx) = html.find("\"title\":\"") {
        let rest = &html[idx + 9..];
        if let Some(end) = rest.find('"') {
            let title = sanitize_title(&rest[..end]);
            if title.contains('.') {
                return Some(title);
            }
        }
    }

    None
}

fn meta_content(html: &str, property: &str) -> Option<String> {
    for needle in [
        format!("property=\"{property}\" content=\""),
        format!("name=\"{property}\" content=\""),
    ] {
        if let Some(idx) = html.find(&needle) {
            let rest = &html[idx + needle.len()..];
            if let Some(end) = rest.find('"') {
                return Some(rest[..end].to_string());
            }
        }
    }
    None
}

fn sanitize_title(title: &str) -> String {
    title
        .trim()
        .trim_end_matches(" - Google Drive")
        .trim_end_matches(" - Google Docs")
        .trim()
        .to_string()
}

pub fn gdrive_headers(original_url: &str) -> Vec<(String, String)> {
    vec![
        ("Referer".into(), original_url.to_string()),
        ("Origin".into(), "https://drive.google.com".into()),
    ]
}

fn is_gdrive_cdn_url(url: &str) -> bool {
    url.contains("drive.usercontent.google.com")
        || url.contains("googleusercontent.com")
        || url.contains("docs.google.com/uc")
}

fn looks_like_binary(content_type: &str) -> bool {
    !content_type.is_empty()
        && !content_type.contains("text/html")
        && !content_type.contains("text/plain")
}

fn looks_like_html_content(content_type: &str, html: &str) -> bool {
    content_type.contains("text/html")
        || content_type.contains("text/plain")
        || html.trim_start().starts_with("<!")
        || html.trim_start().starts_with("<html")
}

fn gdrive_error_page(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    lower.contains("error 404")
        || lower.contains("af-error-container")
        || lower.contains("that's an error")
        || lower.contains("nao foi possivel abrir")
        || lower.contains("não foi possível abrir")
        || lower.contains("couldn't preview file")
}

fn gdrive_permission_denied(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    lower.contains("sorry, you can't view or download this file")
        || lower.contains("you need permission")
        || lower.contains("sign in to your google account")
        || lower.contains("quota exceeded for this file")
        || lower.contains("too many users have viewed or downloaded this file")
        || lower.contains("the file you have requested does not exist")
        || lower.contains("nao foi possivel abrir o arquivo")
        || lower.contains("não foi possível abrir o arquivo")
}

fn content_type_lower(headers: &reqwest::header::HeaderMap) -> String {
    headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn filename_from_headers(headers: &reqwest::header::HeaderMap) -> Option<String> {
    let raw = headers.get(CONTENT_DISPOSITION)?.to_str().ok()?;
    parse_content_disposition_filename(raw)
}

fn parse_content_disposition_filename(raw: &str) -> Option<String> {
    if let Some(idx) = raw.find("filename*=") {
        let rest = &raw[idx + "filename*=".len()..];
        let val = rest.split(';').next()?.trim().trim_matches('"');
        let name = val.split("''").nth(1).unwrap_or(val);
        return Some(percent_decode(name));
    }
    if let Some(idx) = raw.find("filename=") {
        let rest = &raw[idx + "filename=".len()..];
        let val = rest.split(';').next()?.trim().trim_matches('"');
        if !val.is_empty() {
            return Some(percent_decode(val));
        }
    }
    None
}

fn filename_from_html(html: &str) -> Option<String> {
    // <span class="uc-name-size"><a href="…">filename.zip</a> (1.2 GB)</span>
    if let Some(idx) = html.find("uc-name-size") {
        let end = (idx + 1200).min(html.len());
        let slice = &html[idx..end];
        if let Some(a_open) = slice.find("<a ") {
            let after = &slice[a_open..];
            if let Some(gt) = after.find('>') {
                let rest = &after[gt + 1..];
                if let Some(lt) = rest.find('<') {
                    let name = rest[..lt].trim();
                    if name.contains('.') && !name.is_empty() {
                        return Some(name.to_string());
                    }
                }
            }
        }
    }
    find_attr_value(html, "download").or_else(|| {
        html.split("<title>")
            .nth(1)
            .and_then(|s| s.split("</title>").next())
            .map(sanitize_title)
            .filter(|t| t.contains('.') && !t.eq_ignore_ascii_case("google drive"))
    })
}

fn file_size_from_html(html: &str) -> Option<u64> {
    if let Some(idx) = html.find("uc-name-size") {
        let end = (idx + 400).min(html.len());
        let slice = &html[idx..end];
        if let Some(open) = slice.find('(') {
            if let Some(close) = slice[open + 1..].find(')') {
                let size_str = slice[open + 1..open + 1 + close].trim();
                return parse_human_size(size_str);
            }
        }
    }
    None
}

fn parse_human_size(s: &str) -> Option<u64> {
    let t = s.trim().to_ascii_uppercase().replace(',', "");
    let split_at = t.find(|c: char| c.is_alphabetic()).unwrap_or(t.len());
    let (num, unit) = t.split_at(split_at);
    let n: f64 = num.trim().parse().ok()?;
    let mult = match unit.trim() {
        "B" | "" => 1.0,
        "KB" | "KIB" | "K" => 1024.0,
        "MB" | "MIB" | "M" => 1024.0 * 1024.0,
        "GB" | "GIB" | "G" => 1024.0 * 1024.0 * 1024.0,
        "TB" | "TIB" | "T" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((n * mult) as u64)
}

fn find_confirm_token(html: &str) -> Option<String> {
    for needle in ["confirm=", "confirm%3D", "confirm%3d"] {
        if let Some(idx) = html.find(needle) {
            let rest = &html[idx + needle.len()..];
            let token: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if !token.is_empty() {
                return Some(token);
            }
        }
    }
    None
}

fn find_confirm_token_loose(html: &str) -> Option<String> {
    find_confirm_token(&html.replace("&amp;", "&"))
}

fn find_usercontent_url(html: &str) -> Option<String> {
    for needle in [
        "https://drive.usercontent.google.com/download",
        "https://drive.usercontent.google.com/",
        "https://docs.google.com/uc",
    ] {
        if let Some(idx) = html.find(needle) {
            let rest = &html[idx..];
            let end = rest
                .find('"')
                .or_else(|| rest.find('\''))
                .or_else(|| rest.find(' '))
                .unwrap_or(rest.len());
            let url = rest[..end].trim();
            if url.starts_with("http") {
                return Some(url.to_string());
            }
        }
    }
    None
}

fn download_warning_cookie(resp: &reqwest::Response) -> Option<String> {
    for val in resp.headers().get_all(SET_COOKIE) {
        if let Ok(s) = val.to_str() {
            if s.starts_with("download_warning") {
                if let Some(eq) = s.find('=') {
                    let rest = &s[eq + 1..];
                    let token = rest.split(';').next()?.trim();
                    if !token.is_empty() {
                        return Some(token.to_string());
                    }
                }
            }
        }
    }
    None
}

fn find_attr_value(html: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=\"");
    let idx = html.find(&needle)?;
    let rest = &html[idx + needle.len()..];
    let end = rest.find('"')?;
    let val = &rest[..end];
    if val.contains('.') {
        Some(val.to_string())
    } else {
        None
    }
}

fn is_plausible_filename(name: &str) -> bool {
    !name.is_empty()
        && !(name.len() >= 32
            && !name.contains('.')
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
}

fn sanitize_file_name(name: String, fallback: &str) -> String {
    if is_plausible_filename(&name) {
        name
    } else {
        fallback.to_string()
    }
}

fn default_name(id: &str, is_folder: bool) -> String {
    if is_folder {
        format!("gdrive-{id}.zip")
    } else {
        format!("gdrive-{id}.bin")
    }
}

fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_file_id() {
        assert_eq!(
            extract_gdrive_id("https://drive.google.com/file/d/1abcDEF-xyz_123/view?usp=sharing"),
            Some("1abcDEF-xyz_123".into())
        );
    }

    #[test]
    fn extracts_open_id() {
        assert_eq!(
            extract_gdrive_id("https://drive.google.com/open?id=AbCdEfGhIjKlMnOpQrSt"),
            Some("AbCdEfGhIjKlMnOpQrSt".into())
        );
    }

    #[test]
    fn extracts_folder_id() {
        assert_eq!(
            extract_gdrive_id("https://drive.google.com/drive/folders/1abcDEF-xyz_123"),
            Some("1abcDEF-xyz_123".into())
        );
    }

    #[test]
    fn parses_content_disposition() {
        assert_eq!(
            parse_content_disposition_filename("attachment; filename=\"game.zip\""),
            Some("game.zip".into())
        );
    }

    #[test]
    fn parses_human_size() {
        assert_eq!(parse_human_size("1.5 GB"), Some(1_610_612_736));
    }

    #[test]
    fn detects_html_bytes() {
        assert!(looks_like_html_bytes(b"<!DOCTYPE html><html>"));
        assert!(looks_like_html_bytes(b"<html><title>Error 404"));
        assert!(!looks_like_html_bytes(b"PK\x03\x04"));
    }

    #[test]
    fn detects_html_bytes_in_any_case() {
        assert!(looks_like_html_bytes(b"<!doctype html><html lang=en>"));
        assert!(looks_like_html_bytes(b"\xEF\xBB\xBF  \r\n<HTML><body>"));
        assert!(looks_like_html_bytes(b"<Html>"));
        // Invalid UTF-8 later in the chunk does not hide the start.
        assert!(looks_like_html_bytes(b"<!DOCTYPE html>\xff\xfe"));
        // A binary file that happens to contain a marker string.
        assert!(!looks_like_html_bytes(b"7z\xBC\xAF\x27\x1C\xff Error 404"));
        // Text cut in the middle of a character is still text.
        assert!(looks_like_html_bytes(b"x af-error-container \xC3"));
    }

    #[test]
    fn confirm_token_can_be_single_char() {
        assert_eq!(
            find_confirm_token("href=\"/uc?export=download&confirm=t&id=abc\""),
            Some("t".into())
        );
    }

    #[test]
    fn filename_from_interstitial_html() {
        let html =
            r#"<span class="uc-name-size"><a href="/open?id=x">Game_v1.0.zip</a> (500 MB)</span>"#;
        assert_eq!(filename_from_html(html), Some("Game_v1.0.zip".into()));
    }
}
