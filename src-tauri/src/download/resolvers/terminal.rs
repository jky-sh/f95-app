//! Terminal (terminal.lc), an invite-only uploader F95 links unmasked as
//! `https://terminal.lc/<16-char id>`. The page script does two POSTs to
//! `/data/`: `type=file` returns a session, `type=download` with that
//! session returns `{url}`. The session is tied to the client's IP, so both
//! POSTs go through the same client that downloads the file.
//!
//! The site was down (Cloudflare 523) while this was written, so the flow
//! follows its published script and archived replies, not a live run.

use super::super::types::ResolveResult;
use super::super::util::{is_cloudflare_block, str_head};
use crate::error::AppError;
use reqwest::header::{ACCEPT, ORIGIN, REFERER};
use reqwest::Url;
use serde_json::Value;

const SITE: &str = "https://terminal.lc";
const DATA_URL: &str = "https://terminal.lc/data/";

/// The id is 16 characters of `[A-Za-z0-9_-]`; the site lowercases it.
pub(crate) fn parse_terminal_id(raw: &str) -> Option<String> {
    let u = Url::parse(raw.trim()).ok()?;
    if u.host_str()?.trim_start_matches("www.") != "terminal.lc" {
        return None;
    }
    let segs: Vec<&str> = u.path_segments()?.filter(|s| !s.is_empty()).collect();
    match segs.as_slice() {
        [id]
            if id.len() == 16
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') =>
        {
            Some(id.to_ascii_lowercase())
        }
        _ => None,
    }
}

/// What one `/data/` reply means.
#[derive(Debug, PartialEq)]
pub(crate) enum TerminalReply {
    Json(Value),
    Gone,
    /// Cloudflare wall: only a browser gets through.
    Blocked,
    /// 403 from the site itself: "Session checksum failed, did your IP change?"
    SessionRefused,
    RateLimited,
    Offline(u16),
    Unexpected(String),
}

pub(crate) fn classify_reply(status: u16, cf_mitigated: bool, body: &str) -> TerminalReply {
    if is_cloudflare_block(status, cf_mitigated, body) {
        return TerminalReply::Blocked;
    }
    let json: Option<Value> = serde_json::from_str(body).ok();
    match status {
        200..=299 => match json {
            Some(v) if v.get("error").is_none() => TerminalReply::Json(v),
            Some(v) => {
                let msg = v.get("error").and_then(Value::as_str).unwrap_or("error");
                if msg.to_ascii_lowercase().contains("not found") {
                    TerminalReply::Gone
                } else {
                    TerminalReply::Unexpected(msg.to_string())
                }
            }
            None => TerminalReply::Unexpected(format!(
                "HTTP {status}: {}",
                str_head(body, 160).trim()
            )),
        },
        404 => TerminalReply::Gone,
        403 => TerminalReply::SessionRefused,
        429 => TerminalReply::RateLimited,
        500..=599 => TerminalReply::Offline(status),
        _ => TerminalReply::Unexpected(format!("HTTP {status}")),
    }
}

async fn post_data(
    http: &reqwest::Client,
    id: &str,
    form: &[(&str, &str)],
) -> Result<TerminalReply, AppError> {
    let resp = http
        .post(DATA_URL)
        .header(ACCEPT, "application/json, text/javascript, */*; q=0.01")
        .header("X-Requested-With", "XMLHttpRequest")
        .header(ORIGIN, SITE)
        .header(REFERER, format!("{SITE}/{id}"))
        .form(form)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("terminal /data/: {e}")))?;
    let status = resp.status().as_u16();
    let cf = resp.headers().contains_key("cf-mitigated");
    let body = resp.text().await.unwrap_or_default();
    Ok(classify_reply(status, cf, &body))
}

/// Map a failed reply to the download outcome.
fn reply_error(reply: TerminalReply, page: &str, label: &str) -> Result<ResolveResult, AppError> {
    match reply {
        TerminalReply::Blocked => Ok(ResolveResult::NeedsBrowser {
            url: page.to_string(),
            host: label.into(),
        }),
        TerminalReply::Gone => Err(AppError::download("file_gone", "Terminal: file not found")),
        TerminalReply::SessionRefused => Err(AppError::download(
            "link_expired",
            "Terminal: session checksum failed (did your IP change?)",
        )),
        TerminalReply::RateLimited => {
            Err(AppError::download("rate_limited", "Terminal: rate limited (HTTP 429)"))
        }
        TerminalReply::Offline(code) => Err(AppError::download(
            "host_offline",
            format!("Terminal: server unavailable (HTTP {code})"),
        )),
        TerminalReply::Unexpected(msg) => Err(AppError::Other(format!("terminal: {msg}"))),
        TerminalReply::Json(_) => Err(AppError::Other("terminal: unexpected reply".into())),
    }
}

pub(crate) async fn resolve_terminal(
    http: &reqwest::Client,
    url: &str,
    label: &str,
) -> Result<ResolveResult, AppError> {
    let Some(id) = parse_terminal_id(url) else {
        return Ok(ResolveResult::NeedsBrowser {
            url: url.to_string(),
            host: label.into(),
        });
    };
    let page = format!("{SITE}/{id}");

    let info = match post_data(http, &id, &[("type", "file"), ("file", &id)]).await? {
        TerminalReply::Json(v) => v,
        other => return reply_error(other, &page, label),
    };
    let session = info
        .get("session")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Other("terminal: no session in file info".into()))?
        .to_string();
    let file_name = info
        .get("file")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("terminal-download.bin")
        .to_string();

    let link = match post_data(
        http,
        &id,
        &[("type", "download"), ("file", &id), ("session", &session)],
    )
    .await?
    {
        TerminalReply::Json(v) => v
            .get("url")
            .and_then(Value::as_str)
            .filter(|s| s.starts_with("http"))
            .map(str::to_string)
            .ok_or_else(|| AppError::Other("terminal: no url in download reply".into()))?,
        other => return reply_error(other, &page, label),
    };

    // The site only gives a SHA-1 and a rounded size; the download's own
    // Content-Length is the size we trust.
    Ok(ResolveResult::Direct {
        url: link,
        file_name,
        file_size: None,
        expected_sha256: None,
        extra_headers: vec![("Referer".into(), page)],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ids() {
        assert_eq!(
            parse_terminal_id("https://terminal.lc/r5y9d_6op-z_k7gw").as_deref(),
            Some("r5y9d_6op-z_k7gw")
        );
        assert_eq!(
            parse_terminal_id("https://www.terminal.lc/R5Y9D_6OP-Z_K7GW/").as_deref(),
            Some("r5y9d_6op-z_k7gw")
        );
        assert_eq!(parse_terminal_id("https://terminal.lc/short"), None);
        assert_eq!(parse_terminal_id("https://terminal.lc/"), None);
        assert_eq!(parse_terminal_id("https://example.lc/r5y9d_6op-z_k7gw"), None);
    }

    #[test]
    fn classifies_replies() {
        let info = r#"{"session":"feb844a6","file":"Game-Beta-44.7z","size":"4.02GB","date":"2025-03-24","sha":"de2e"}"#;
        match classify_reply(200, false, info) {
            TerminalReply::Json(v) => assert_eq!(v["file"], "Game-Beta-44.7z"),
            other => panic!("{other:?}"),
        }
        assert_eq!(
            classify_reply(404, false, r#"{"error":"file not found"}"#),
            TerminalReply::Gone
        );
        assert_eq!(
            classify_reply(200, false, r#"{"error":"file not found"}"#),
            TerminalReply::Gone
        );
        assert_eq!(classify_reply(403, false, "{}"), TerminalReply::SessionRefused);
        assert_eq!(
            classify_reply(
                403,
                false,
                "<title>Attention Required! | Cloudflare</title>"
            ),
            TerminalReply::Blocked
        );
        assert_eq!(classify_reply(403, true, ""), TerminalReply::Blocked);
        assert_eq!(classify_reply(429, false, ""), TerminalReply::RateLimited);
        assert_eq!(classify_reply(523, false, "error code: 523"), TerminalReply::Offline(523));
        assert!(matches!(
            classify_reply(200, false, "<html>"),
            TerminalReply::Unexpected(_)
        ));
    }

    #[test]
    fn maps_errors_to_codes() {
        let code = |r| reply_error(r, "p", "terminal").err().map(|e| e.code());
        assert_eq!(code(TerminalReply::Gone), Some("file_gone"));
        assert_eq!(code(TerminalReply::Offline(522)), Some("host_offline"));
        assert_eq!(code(TerminalReply::RateLimited), Some("rate_limited"));
        assert_eq!(code(TerminalReply::SessionRefused), Some("link_expired"));
        assert!(matches!(
            reply_error(TerminalReply::Blocked, "p", "terminal"),
            Ok(ResolveResult::NeedsBrowser { .. })
        ));
    }
}
