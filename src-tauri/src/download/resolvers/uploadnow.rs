//! UploadNow (uploadnow.io). A Next.js front end over a JSON API that wants
//! a Firebase anonymous "guest" token, the same one the site creates for
//! every visitor. No captcha: the API lists the folder (exact names and
//! sizes) and `/downloads/links` mints a signed bucket URL with Range
//! support. Minting counts as a download and the URL expires, so links are
//! minted only for the file that is actually downloaded.

use super::super::gofile_pick::finish_gofile_files;
use super::super::platform::infer_platform_label;
use super::super::types::{ResolveResult, ResolvedFileOption};
use crate::error::AppError;
use reqwest::{StatusCode, Url};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const API: &str = "https://uploadnow.io/api";
/// The site's public Firebase web key (project `upnow-prod`).
const FIREBASE_KEY: &str = "AIzaSyB1SU4XZ9ryZjgtlYLU2yX2OBrAM6ajSWo";
/// Marks a file whose link is minted when it is picked.
pub(crate) const SENTINEL_PREFIX: &str = "uploadnow-file:";
const PAGE_SIZE: usize = 40;

/// Cached guest login, shared by every UploadNow download.
pub(crate) struct UploadnowGuest {
    id_token: String,
    refresh_token: String,
    expires_at: Instant,
}

#[derive(Debug, PartialEq)]
pub(crate) enum UploadnowLink {
    Folder {
        id: String,
        token: Option<String>,
        /// `&f=<fileId>`: one file inside the folder.
        file: Option<String>,
    },
    File {
        id: String,
        token: Option<String>,
    },
}

fn is_uploadnow_host(host: &str) -> bool {
    matches!(
        host.trim_start_matches("www."),
        "uploadnow.io" | "uploadnow.co" | "uploadnow.app"
    )
}

fn is_folder_id(s: &str) -> bool {
    (5..=12).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric())
}

fn is_file_id(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == 5
        && [8, 4, 4, 4, 12]
            .iter()
            .zip(&parts)
            .all(|(n, p)| p.len() == *n && p.chars().all(|c| c.is_ascii_hexdigit()))
}

pub(crate) fn parse_uploadnow_url(raw: &str) -> Option<UploadnowLink> {
    let u = Url::parse(raw.trim()).ok()?;
    if !is_uploadnow_host(u.host_str()?) {
        return None;
    }
    let query = |key: &str| {
        u.query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
            .filter(|v| !v.is_empty())
    };
    let mut segs: Vec<&str> = u.path_segments()?.filter(|s| !s.is_empty()).collect();
    // Optional locale prefix: /fr/f/<id>, /pt-br/share?...
    if segs.len() > 1 && is_locale(segs[0]) {
        segs.remove(0);
    }
    let token = query("token").or_else(|| query("utm_content"));
    match segs.as_slice() {
        ["f" | "files", id] if is_folder_id(id) => Some(UploadnowLink::Folder {
            id: id.to_string(),
            token,
            file: query("f").filter(|f| is_file_id(f)),
        }),
        ["s", id] if is_file_id(id) => Some(UploadnowLink::File {
            id: id.to_string(),
            token,
        }),
        ["share"] => {
            if let Some(id) = query("utm_medium").filter(|id| is_file_id(id)) {
                return Some(UploadnowLink::File { id, token });
            }
            let id = query("utm_source").filter(|id| is_folder_id(id))?;
            Some(UploadnowLink::Folder {
                id,
                token,
                file: query("f").filter(|f| is_file_id(f)),
            })
        }
        _ => None,
    }
}

fn is_locale(s: &str) -> bool {
    let b = s.as_bytes();
    let alpha2 = |x: &[u8]| x.len() == 2 && x.iter().all(u8::is_ascii_lowercase);
    alpha2(b) || (b.len() == 5 && b[2] == b'-' && alpha2(&b[..2]) && alpha2(&b[3..]))
}

pub(crate) fn sentinel(folder_id: &str, file_id: &str, token: Option<&str>) -> String {
    match token {
        Some(t) => format!("{SENTINEL_PREFIX}{folder_id}/{file_id}?{t}"),
        None => format!("{SENTINEL_PREFIX}{folder_id}/{file_id}"),
    }
}

/// `(folder_id, file_id, share_token)` of a sentinel.
pub(crate) fn parse_sentinel(s: &str) -> Option<(String, String, Option<String>)> {
    let rest = s.strip_prefix(SENTINEL_PREFIX)?;
    let (ids, token) = match rest.split_once('?') {
        Some((ids, t)) => (ids, Some(t.to_string())),
        None => (rest, None),
    };
    let (folder, file) = ids.split_once('/')?;
    Some((folder.to_string(), file.to_string(), token))
}

async fn sign_up(http: &reqwest::Client) -> Result<UploadnowGuest, AppError> {
    let v: Value = http
        .post(format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={FIREBASE_KEY}"
        ))
        .json(&json!({ "returnSecureToken": true }))
        .send()
        .await
        .map_err(|e| AppError::Other(format!("uploadnow guest: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Other(format!("uploadnow guest json: {e}")))?;
    guest_from(&v, "idToken", "refreshToken", "expiresIn")
        .ok_or_else(|| AppError::Other(format!("uploadnow guest: {v}")))
}

async fn refresh(http: &reqwest::Client, refresh_token: &str) -> Option<UploadnowGuest> {
    let v: Value = http
        .post(format!(
            "https://securetoken.googleapis.com/v1/token?key={FIREBASE_KEY}"
        ))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    guest_from(&v, "id_token", "refresh_token", "expires_in")
}

fn guest_from(v: &Value, id: &str, rt: &str, exp: &str) -> Option<UploadnowGuest> {
    let secs = v
        .get(exp)
        .and_then(|e| e.as_str().and_then(|s| s.parse().ok()).or_else(|| e.as_u64()))
        .unwrap_or(3600);
    Some(UploadnowGuest {
        id_token: v.get(id)?.as_str()?.to_string(),
        refresh_token: v.get(rt)?.as_str()?.to_string(),
        expires_at: Instant::now() + Duration::from_secs(secs),
    })
}

/// A guest ID token valid for at least another minute. `fresh` forces a
/// refresh after the API refused the cached one.
async fn guest_token(
    http: &reqwest::Client,
    slot: &Mutex<Option<UploadnowGuest>>,
    fresh: bool,
) -> Result<String, AppError> {
    let mut guard = slot.lock().await;
    if let Some(g) = guard.as_ref() {
        if !fresh && g.expires_at > Instant::now() + Duration::from_secs(60) {
            return Ok(g.id_token.clone());
        }
    }
    let renewed = match guard.as_ref() {
        Some(g) => refresh(http, &g.refresh_token).await,
        None => None,
    };
    let guest = match renewed {
        Some(g) => g,
        None => sign_up(http).await?,
    };
    let token = guest.id_token.clone();
    *guard = Some(guest);
    Ok(token)
}

/// POST to the API, refreshing the guest token once if it is refused.
async fn api_post(
    http: &reqwest::Client,
    slot: &Mutex<Option<UploadnowGuest>>,
    path: &str,
    body: &Value,
) -> Result<(StatusCode, Value), AppError> {
    let mut fresh = false;
    loop {
        let token = guest_token(http, slot, fresh).await?;
        let resp = http
            .post(format!("{API}{path}"))
            .bearer_auth(&token)
            .json(body)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("uploadnow {path}: {e}")))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        // An expired guest token gets a bare text/plain "Forbidden".
        if status == StatusCode::FORBIDDEN && text.trim() == "Forbidden" && !fresh {
            fresh = true;
            continue;
        }
        let v = serde_json::from_str(&text).unwrap_or(Value::String(text));
        return Ok((status, v));
    }
}

/// What a non-2xx API answer means.
fn api_failure(status: StatusCode, body: &Value) -> Result<(), ApiFailure> {
    if status.is_success() {
        return Ok(());
    }
    Err(match status.as_u16() {
        404 => ApiFailure::Gone,
        // PASSWORD_REQUIRED, INVALID_PASSWORD or a private share: the site
        // itself has to ask for it.
        403 => ApiFailure::Browser,
        500..=599 => ApiFailure::Offline(status.as_u16()),
        _ => ApiFailure::Other(format!("HTTP {status}: {body}")),
    })
}

#[derive(Debug, PartialEq)]
enum ApiFailure {
    Gone,
    Browser,
    Offline(u16),
    Other(String),
}

fn failure_result(f: ApiFailure, url: &str, label: &str) -> Result<ResolveResult, AppError> {
    match f {
        ApiFailure::Gone => Err(AppError::download(
            "file_gone",
            "UploadNow: link removed or expired (anonymous files go after 7 days without downloads)",
        )),
        ApiFailure::Browser => Ok(ResolveResult::NeedsBrowser {
            url: url.to_string(),
            host: label.into(),
        }),
        ApiFailure::Offline(code) => Err(AppError::download(
            "host_offline",
            format!("UploadNow: server error (HTTP {code})"),
        )),
        ApiFailure::Other(msg) => Err(AppError::Other(format!("uploadnow: {msg}"))),
    }
}

fn file_option(f: &Value, folder_id: &str, token: Option<&str>) -> Option<ResolvedFileOption> {
    let id = f.get("id")?.as_str()?.to_string();
    let file_name = f
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("uploadnow-download.bin")
        .to_string();
    let folder = f
        .get("folderId")
        .and_then(Value::as_str)
        .unwrap_or(folder_id);
    Some(ResolvedFileOption {
        direct_url: sentinel(folder, &id, token),
        platform_label: infer_platform_label(&file_name).map(str::to_string),
        file_size: f.get("size").and_then(Value::as_u64),
        file_name,
        id,
    })
}

/// Files of one `folder-content` page plus the cursor for the next one.
pub(crate) fn parse_folder_page(
    body: &Value,
    folder_id: &str,
    token: Option<&str>,
) -> (Vec<ResolvedFileOption>, Vec<String>, Option<(&'static str, Value)>) {
    let files = body.get("files").and_then(Value::as_array).cloned().unwrap_or_default();
    let folders = body.get("folders").and_then(Value::as_array).cloned().unwrap_or_default();
    let options = files
        .iter()
        .filter_map(|f| file_option(f, folder_id, token))
        .collect();
    let sub = folders
        .iter()
        .filter_map(|f| f.get("id").and_then(Value::as_str).map(str::to_string))
        .collect();
    let cursor = if files.len() + folders.len() < PAGE_SIZE {
        None
    } else if let Some(last) = files.last() {
        last.get("updateDate").cloned().map(|v| ("startAfterFile", v))
    } else {
        folders
            .last()
            .and_then(|f| f.get("updateDate").cloned())
            .map(|v| ("startAfterFolder", v))
    };
    (options, sub, cursor)
}

async fn list_folder(
    http: &reqwest::Client,
    slot: &Mutex<Option<UploadnowGuest>>,
    root: &str,
    token: Option<&str>,
) -> Result<Result<Vec<ResolvedFileOption>, ApiFailure>, AppError> {
    let mut out = Vec::new();
    // (folder id, depth): subfolders two levels down at most.
    let mut queue = vec![(root.to_string(), 0u8)];
    while let Some((folder, depth)) = queue.pop() {
        let mut cursor: Option<(&'static str, Value)> = None;
        for _ in 0..50 {
            let mut body = json!({
                "folderId": folder,
                "limit": PAGE_SIZE,
                "sortField": "updateDate",
                "sortDirection": "desc",
            });
            if let Some(t) = token {
                body["token"] = json!(t);
            }
            if let Some((key, value)) = cursor.take() {
                body[key] = value;
            }
            let (status, v) = api_post(http, slot, "/file/search/folder-content", &body).await?;
            if let Err(f) = api_failure(status, &v) {
                // A broken subfolder should not sink the whole listing.
                if folder == root {
                    return Ok(Err(f));
                }
                break;
            }
            let (files, subfolders, next) = parse_folder_page(&v, &folder, token);
            out.extend(files);
            if depth < 2 {
                queue.extend(subfolders.into_iter().map(|id| (id, depth + 1)));
            }
            match next {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
    }
    out.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    Ok(Ok(out))
}

/// Signed download URL for one file. Each call counts as a download.
pub(crate) async fn mint_link(
    http: &reqwest::Client,
    slot: &Mutex<Option<UploadnowGuest>>,
    sentinel_url: &str,
) -> Result<String, AppError> {
    let (folder, file, token) = parse_sentinel(sentinel_url)
        .ok_or_else(|| AppError::Other("uploadnow: bad file reference".into()))?;
    let mut body = json!({
        "folderGroups": [{ "selectedFiles": [file], "selectedFolders": [], "folderId": folder }],
        "stream": false,
    });
    if let Some(t) = token {
        body["token"] = json!(t);
    }
    let (status, v) = api_post(http, slot, "/file/downloads/links", &body).await?;
    if let Err(f) = api_failure(status, &v) {
        return match failure_result(f, sentinel_url, "uploadnow") {
            Err(e) => Err(e),
            Ok(_) => Err(AppError::Other(format!("uploadnow: link refused ({status})"))),
        };
    }
    v.get("url")
        .and_then(Value::as_str)
        .filter(|u| {
            Url::parse(u).is_ok_and(|p| p.host_str().is_some_and(|h| h.ends_with(".uploadnow.io")))
        })
        .map(str::to_string)
        .ok_or_else(|| AppError::Other(format!("uploadnow: no link in {v}")))
}

pub(crate) async fn resolve_uploadnow(
    http: &reqwest::Client,
    slot: &Mutex<Option<UploadnowGuest>>,
    url: &str,
    label: &str,
    platform_group: Option<String>,
) -> Result<ResolveResult, AppError> {
    let files = match parse_uploadnow_url(url) {
        None => {
            return Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label.into(),
            })
        }
        Some(UploadnowLink::File { id, token }) => {
            let mut body = json!({ "fileId": id });
            if let Some(t) = &token {
                body["token"] = json!(t);
            }
            let (status, v) = api_post(http, slot, "/file/search/file", &body).await?;
            if let Err(f) = api_failure(status, &v) {
                return failure_result(f, url, label);
            }
            file_option(&v, "", token.as_deref()).into_iter().collect()
        }
        Some(UploadnowLink::Folder { id, token, file }) => {
            let mut files = match list_folder(http, slot, &id, token.as_deref()).await? {
                Ok(files) => files,
                Err(f) => return failure_result(f, url, label),
            };
            if let Some(wanted) = file {
                if files.iter().any(|f| f.id == wanted) {
                    files.retain(|f| f.id == wanted);
                }
            }
            files
        }
    };
    if files.is_empty() {
        return failure_result(ApiFailure::Gone, url, label);
    }
    match finish_gofile_files(files, Vec::new(), platform_group, url, label) {
        ResolveResult::Direct {
            url: picked,
            file_name,
            file_size,
            ..
        } => Ok(ResolveResult::Direct {
            url: mint_link(http, slot, &picked).await?,
            file_name,
            file_size,
            expected_sha256: None,
            extra_headers: Vec::new(),
        }),
        other => Ok(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE_ID: &str = "fc728c4a-0b9f-4d72-86f8-3d49c572db38";

    #[test]
    fn parses_share_links() {
        assert_eq!(
            parse_uploadnow_url("https://uploadnow.io/f/1jbTQ1Y"),
            Some(UploadnowLink::Folder {
                id: "1jbTQ1Y".into(),
                token: None,
                file: None
            })
        );
        assert_eq!(
            parse_uploadnow_url("https://www.uploadnow.co/fr/f/1jbTQ1Y"),
            Some(UploadnowLink::Folder {
                id: "1jbTQ1Y".into(),
                token: None,
                file: None
            })
        );
        assert_eq!(
            parse_uploadnow_url(&format!("https://uploadnow.io/s/{FILE_ID}?token=T1&o=t")),
            Some(UploadnowLink::File {
                id: FILE_ID.into(),
                token: Some("T1".into())
            })
        );
        assert_eq!(
            parse_uploadnow_url(&format!(
                "https://uploadnow.io/en/share?utm_source=1jbTQ1Y&f={FILE_ID}"
            )),
            Some(UploadnowLink::Folder {
                id: "1jbTQ1Y".into(),
                token: None,
                file: Some(FILE_ID.into())
            })
        );
        assert_eq!(
            parse_uploadnow_url(&format!(
                "https://uploadnow.io/pt-br/share?utm_medium={FILE_ID}&utm_content=TK&utm_term=t"
            )),
            Some(UploadnowLink::File {
                id: FILE_ID.into(),
                token: Some("TK".into())
            })
        );
        assert_eq!(parse_uploadnow_url("https://uploadnow.io/en/faq"), None);
        assert_eq!(parse_uploadnow_url("https://uploadnow.to/f/1jbTQ1Y"), None);
    }

    #[test]
    fn sentinels_round_trip() {
        let s = sentinel("1jbTQ1Y", FILE_ID, Some("TK"));
        assert_eq!(
            parse_sentinel(&s),
            Some(("1jbTQ1Y".into(), FILE_ID.into(), Some("TK".into())))
        );
        assert_eq!(
            parse_sentinel(&sentinel("a", "b", None)),
            Some(("a".into(), "b".into(), None))
        );
        assert_eq!(parse_sentinel("https://uploadnow.io/x"), None);
    }

    #[test]
    fn parses_folder_pages() {
        let body: Value = serde_json::from_str(&format!(
            r#"{{"parentFolder":{{"id":"1jbTQ1Y"}},"folders":[{{"id":"sub1","updateDate":"2026"}}],"files":[{{"id":"{FILE_ID}","name":"Carnal_Instinct_v0.7.9.zip","size":7067563077,"folderId":"1jbTQ1Y","updateDate":"2026-09-22T01:28:58.451Z"}}]}}"#
        ))
        .unwrap();
        let (files, subs, cursor) = parse_folder_page(&body, "1jbTQ1Y", None);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_size, Some(7067563077));
        assert_eq!(files[0].direct_url, format!("uploadnow-file:1jbTQ1Y/{FILE_ID}"));
        assert_eq!(subs, vec!["sub1".to_string()]);
        // Fewer entries than a page: no next page.
        assert_eq!(cursor, None);
    }

    #[test]
    fn maps_api_failures() {
        assert_eq!(api_failure(StatusCode::CREATED, &json!({})), Ok(()));
        assert_eq!(
            api_failure(StatusCode::NOT_FOUND, &json!({"error":"File not found"})),
            Err(ApiFailure::Gone)
        );
        assert_eq!(
            api_failure(StatusCode::FORBIDDEN, &json!({"error":"x","codes":["PASSWORD_REQUIRED"]})),
            Err(ApiFailure::Browser)
        );
        assert_eq!(
            api_failure(StatusCode::BAD_GATEWAY, &json!({})),
            Err(ApiFailure::Offline(502))
        );
    }
}
