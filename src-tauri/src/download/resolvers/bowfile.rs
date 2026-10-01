//! BowFile (bowfile.com, a YetiShare site). No captcha: load the file page
//! (it sets the `filehosting` session cookie), wait out its countdown, then
//! follow the session-bound `?pt=` link once to get a
//! `fsN.bowfile.com/token/download/...?download_token=` URL that supports
//! Range. Free users get one connection per IP (a second one answers HTTP
//! 460), so the manager runs BowFile downloads one at a time.

use super::super::platform::infer_platform_label;
use super::super::types::{ResolveResult, ResolvedFileOption};
use super::super::util::{between, html_unescape, is_cloudflare_block, parse_human_size};
use crate::error::AppError;
use reqwest::header::LOCATION;
use reqwest::{redirect, Url};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

const SITE: &str = "https://bowfile.com";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// First path segments that are site pages, not file ids.
const RESERVED: &[&str] = &[
    "folder", "shared", "account", "upgrade", "faq", "register", "register_non_user", "api",
    "terms", "privacy", "dmca", "contact", "link_checker", "report_file", "error", "p", "themes",
    "plugins", "assets", "js",
];

#[derive(Debug, PartialEq)]
pub(crate) enum BowLink {
    File { id: String },
    Folder { url: String },
}

pub(crate) fn parse_bowfile_url(raw: &str) -> Option<BowLink> {
    let u = Url::parse(raw.trim()).ok()?;
    if u.host_str()?.trim_start_matches("www.") != "bowfile.com" {
        return None;
    }
    let segs: Vec<&str> = u.path_segments()?.filter(|s| !s.is_empty()).collect();
    match segs.as_slice() {
        ["folder", key, rest @ ..] if !key.is_empty() => {
            let mut url = format!("{SITE}/folder/{key}");
            if let Some(name) = rest.first() {
                url.push('/');
                url.push_str(name);
            }
            Some(BowLink::Folder { url })
        }
        [first, ..] => {
            // `<id>~i` (info) and `<id>~s` (stats) are the same file.
            let id = first.split('~').next().unwrap_or(first);
            let ok = !id.is_empty()
                && id.chars().all(|c| c.is_ascii_alphanumeric())
                && !RESERVED.contains(&id.to_ascii_lowercase().as_str());
            ok.then(|| BowLink::File { id: id.to_string() })
        }
        _ => None,
    }
}

/// What a BowFile error redirect (`/error?e=<text>`) means for the download.
pub(crate) fn error_from_text(text: &str) -> AppError {
    let lower = text.to_ascii_lowercase();
    let msg = format!("BowFile: {text}");
    if lower.contains("removed") || lower.contains("not found") || lower.contains("not publicly") {
        AppError::download("file_gone", msg)
    } else if lower.contains("can not be located") || lower.contains("cannot be located") {
        AppError::download("link_expired", msg)
    } else if lower.contains("concurrent") {
        AppError::download("host_busy", msg)
    } else if lower.contains("must wait") || lower.contains("maximum permitted") || lower.contains("daily") {
        AppError::download("rate_limited", msg)
    } else {
        AppError::Other(msg)
    }
}

/// The error text of a `bowfile.com/error?e=...` URL, if that is what it is.
pub(crate) fn error_page_text(url: &Url) -> Option<String> {
    let host = url.host_str()?;
    if !host.ends_with("bowfile.com") || url.path() != "/error" {
        return None;
    }
    url.query_pairs()
        .find(|(k, _)| k == "e")
        .map(|(_, v)| v.into_owned())
}

/// A download that landed on BowFile's error page instead of the file.
pub(crate) fn error_from_final_url(url: &Url) -> Option<AppError> {
    error_page_text(url).map(|t| error_from_text(&t))
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct BowPage {
    pub pt_urls: Vec<String>,
    pub wait_secs: u64,
    pub name: Option<String>,
    pub size_hint: Option<u64>,
    /// A captcha or password form: only a person can go on.
    pub blocked: bool,
}

/// Every `https://bowfile.com/<id>?pt=...` link in the page, in order. The
/// countdown script has one in an escaped `onclick` and one in `let next`.
fn find_pt_urls(html: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let needle = "https://bowfile.com/";
    let mut from = 0;
    while let Some(i) = html[from..].find(needle) {
        let start = from + i;
        let end = html[start..]
            .find(|c: char| c == '"' || c == '\'' || c == '\\' || c == '<' || c.is_whitespace())
            .map(|n| start + n)
            .unwrap_or(html.len());
        let candidate = &html[start..end];
        if candidate.contains("?pt=") && !out.iter().any(|u| u == candidate) {
            out.push(candidate.to_string());
        }
        from = end.max(start + needle.len());
    }
    out
}

pub(crate) fn parse_bowfile_page(html: &str) -> BowPage {
    let wait_secs = between(html, "var seconds = ", ";")
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(3)
        .min(60);
    let name = between(html, "<title>", "</title>")
        .map(|t| html_unescape(t.trim().trim_end_matches(" - BowFile").trim()))
        .filter(|n| !n.is_empty() && n != "BowFile");
    // "<strong>Name.zip (1.22 GB)</strong>" in the download table.
    let size_hint = between(html, "responsiveInfoTable", "</strong>")
        .and_then(|cell| {
            let open = cell.rfind('(')?;
            let close = cell.rfind(')')?;
            (close > open).then(|| &cell[open + 1..close])
        })
        .and_then(parse_human_size);
    let lower = html.to_ascii_lowercase();
    let blocked = lower.contains("class=\"g-recaptcha")
        || lower.contains("cf-turnstile")
        || lower.contains("h-captcha")
        || lower.contains("captchapagetable")
        || lower.contains("name=\"filepassword\"");
    BowPage {
        pt_urls: find_pt_urls(html),
        wait_secs,
        name,
        size_hint,
        blocked,
    }
}

/// The numeric id a folder page passes to its file listing.
pub(crate) fn folder_node_id(html: &str) -> Option<String> {
    let needle = "loadImages('folder', '";
    let mut from = 0;
    while let Some(i) = html[from..].find(needle) {
        let start = from + i + needle.len();
        let id: String = html[start..].chars().take_while(char::is_ascii_digit).collect();
        if !id.is_empty() {
            return Some(id);
        }
        from = start;
    }
    None
}

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    between(tag, &format!(" {name}=\""), "\"")
}

/// Files of a `load_files` listing (`{html: ...}`), with exact sizes.
pub(crate) fn parse_folder_listing(json_body: &str) -> Vec<ResolvedFileOption> {
    let html = serde_json::from_str::<Value>(json_body)
        .ok()
        .and_then(|v| v.get("html").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default();
    let mut out = Vec::new();
    for chunk in html.split("<div ").skip(1) {
        // Leading space so the first attribute matches like the others.
        let tag = format!(" {}", chunk.split('>').next().unwrap_or(""));
        if !tag.contains("fileIconLi") {
            continue;
        }
        let (Some(file_id), Some(name)) = (attr(&tag, "fileId"), attr(&tag, "dtfilename")) else {
            continue;
        };
        let file_name = html_unescape(name);
        out.push(ResolvedFileOption {
            id: file_id.to_string(),
            platform_label: infer_platform_label(&file_name).map(str::to_string),
            // Redirects straight to a fresh token URL, no countdown.
            direct_url: format!("{SITE}/account/direct_download/{file_id}"),
            file_size: attr(&tag, "dtsizeraw").and_then(|s| s.parse().ok()),
            file_name,
        });
    }
    out.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    out
}

fn is_token_url(loc: &str) -> bool {
    Url::parse(loc).is_ok_and(|u| {
        u.host_str()
            .is_some_and(|h| h.starts_with("fs") && h.ends_with(".bowfile.com"))
            && u.query().is_some_and(|q| q.contains("download_token="))
    })
}

fn gone() -> AppError {
    AppError::download("file_gone", "BowFile: file not found")
}

/// Session client: keeps the `filehosting` cookie and stops at redirects so
/// the pt link's Location can be read without starting the file.
fn session_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .cookie_provider(Arc::new(reqwest::cookie::Jar::default()))
        .redirect(redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Other(format!("bowfile client: {e}")))
}

enum Step {
    Page(String),
    Redirect(String),
}

async fn get(client: &reqwest::Client, url: &str) -> Result<Step, AppError> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("bowfile: {e}")))?;
    let status = resp.status();
    let cf = resp.headers().contains_key("cf-mitigated");
    if status.is_redirection() {
        let loc = resp
            .headers()
            .get(LOCATION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let abs = Url::parse(SITE)
            .and_then(|base| base.join(&loc))
            .map(|u| u.to_string())
            .unwrap_or(loc);
        return Ok(Step::Redirect(abs));
    }
    let body = resp.text().await.unwrap_or_default();
    if status.as_u16() == 404 {
        return Err(gone());
    }
    if is_cloudflare_block(status.as_u16(), cf, &body) || !status.is_success() {
        return Err(AppError::Cloudflare(format!("bowfile HTTP {status}")));
    }
    Ok(Step::Page(body))
}

/// Error for a redirect that is not the token URL.
fn redirect_error(loc: &str) -> Option<AppError> {
    let u = Url::parse(loc).ok()?;
    if let Some(e) = error_from_final_url(&u) {
        return Some(e);
    }
    // Missing folders and shares bounce to the account page.
    u.path().starts_with("/account").then(gone)
}

async fn resolve_file(client: &reqwest::Client, id: &str, label: &str) -> Result<ResolveResult, AppError> {
    let page_url = format!("{SITE}/{id}");
    let needs_browser = || ResolveResult::NeedsBrowser {
        url: page_url.clone(),
        host: label.into(),
    };
    let mut html = match get(client, &page_url).await {
        Ok(Step::Page(html)) => html,
        Ok(Step::Redirect(loc)) => return redirect_error(&loc).map(Err).unwrap_or_else(|| Ok(needs_browser())),
        Err(AppError::Cloudflare(_)) => return Ok(needs_browser()),
        Err(e) => return Err(e),
    };
    let first = parse_bowfile_page(&html);
    let (name, size_hint) = (first.name.clone(), first.size_hint);

    // The pt link only works after the countdown, once per page load.
    for _ in 0..3 {
        let page = parse_bowfile_page(&html);
        if page.blocked {
            return Ok(needs_browser());
        }
        let Some(pt) = page.pt_urls.first().cloned() else {
            return Ok(needs_browser());
        };
        tokio::time::sleep(Duration::from_secs(page.wait_secs + 1)).await;
        match get(client, &pt).await {
            Ok(Step::Redirect(loc)) if is_token_url(&loc) => {
                return Ok(ResolveResult::Direct {
                    url: loc,
                    file_name: name.unwrap_or_else(|| format!("bowfile-{id}.bin")),
                    // Rounded; the download's Content-Range has the exact size.
                    file_size: size_hint,
                    expected_sha256: None,
                    extra_headers: Vec::new(),
                });
            }
            Ok(Step::Redirect(loc)) => {
                return redirect_error(&loc).map(Err).unwrap_or_else(|| Ok(needs_browser()));
            }
            // Too early or already used: the answer is the page again, with fresh links.
            Ok(Step::Page(next)) => html = next,
            Err(AppError::Cloudflare(_)) => return Ok(needs_browser()),
            Err(e) => return Err(e),
        }
    }
    Ok(needs_browser())
}

async fn resolve_folder(
    client: &reqwest::Client,
    url: &str,
    label: &str,
    platform_group: Option<String>,
) -> Result<ResolveResult, AppError> {
    let needs_browser = || ResolveResult::NeedsBrowser {
        url: url.to_string(),
        host: label.into(),
    };
    let html = match get(client, url).await {
        Ok(Step::Page(html)) => html,
        Ok(Step::Redirect(loc)) => return redirect_error(&loc).map(Err).unwrap_or_else(|| Ok(needs_browser())),
        Err(AppError::Cloudflare(_)) => return Ok(needs_browser()),
        Err(e) => return Err(e),
    };
    let Some(node_id) = folder_node_id(&html) else {
        return Ok(needs_browser());
    };
    let mut files = Vec::new();
    for page in 1..=10 {
        let body = client
            .post(format!("{SITE}/account/ajax/load_files"))
            .header("X-Requested-With", "XMLHttpRequest")
            .form(&[
                ("pageType", "folder"),
                ("nodeId", node_id.as_str()),
                ("pageStart", &page.to_string()),
                ("perPage", "500"),
                ("filterOrderBy", ""),
            ])
            .send()
            .await
            .map_err(|e| AppError::Other(format!("bowfile folder: {e}")))?
            .text()
            .await
            .unwrap_or_default();
        let batch = parse_folder_listing(&body);
        let done = batch.len() < 500;
        files.extend(batch);
        if done {
            break;
        }
    }
    Ok(super::super::gofile_pick::finish_gofile_files(
        files,
        Vec::new(),
        platform_group,
        url,
        label,
    ))
}

pub(crate) async fn resolve_bowfile(
    url: &str,
    label: &str,
    platform_group: Option<String>,
) -> Result<ResolveResult, AppError> {
    let client = session_client()?;
    match parse_bowfile_url(url) {
        Some(BowLink::File { id }) => resolve_file(&client, &id, label).await,
        Some(BowLink::Folder { url: folder }) => {
            resolve_folder(&client, &folder, label, platform_group).await
        }
        None => Ok(ResolveResult::NeedsBrowser {
            url: url.to_string(),
            host: label.into(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_links() {
        let file = |id: &str| Some(BowLink::File { id: id.into() });
        assert_eq!(parse_bowfile_url("https://bowfile.com/4aOer"), file("4aOer"));
        assert_eq!(parse_bowfile_url("https://www.bowfile.com/99iW/Game.zip"), file("99iW"));
        assert_eq!(parse_bowfile_url("https://bowfile.com/99iW~i"), file("99iW"));
        assert_eq!(
            parse_bowfile_url("https://bowfile.com/folder/e2119b4e9be84b9e8b308ef2644dfc63/Torrents"),
            Some(BowLink::Folder {
                url: "https://bowfile.com/folder/e2119b4e9be84b9e8b308ef2644dfc63/Torrents".into()
            })
        );
        assert_eq!(parse_bowfile_url("https://bowfile.com/faq"), None);
        assert_eq!(parse_bowfile_url("https://bowfile.com/"), None);
        assert_eq!(parse_bowfile_url("https://example.com/4aOer"), None);
    }

    /// Trimmed from a live file page.
    const PAGE: &str = r#"<html><head><title>Esoteric.Ebb.v1.2.2-P2P.zip - BowFile</title></head>
<script>function x9(){ let next = "https://bowfile.com/4aOer?pt=aHJYNXJm%3D"; }</script>
<table><tr><th class="col-md-3 responsiveInfoTable">
    <strong>
        Esoteric.Ebb.v1.2.2-P2P.zip (1.22 GB)
    </strong>
</th></tr></table>
<script>
    var seconds = 3;
    $('.download-timer').html("<button class='btn btn--primary' id='dl' onclick='window.location.href = \"https://bowfile.com/4aOer?pt=b1Y1SlIv%3D\";'><span class='btn__text'>DOWNLOAD / VIEW NOW</span></button>");
</script></html>"#;

    #[test]
    fn parses_file_page() {
        let page = parse_bowfile_page(PAGE);
        assert_eq!(page.name.as_deref(), Some("Esoteric.Ebb.v1.2.2-P2P.zip"));
        assert_eq!(page.wait_secs, 3);
        assert_eq!(page.size_hint, Some(1_309_965_025));
        assert!(!page.blocked);
        assert_eq!(
            page.pt_urls,
            vec![
                "https://bowfile.com/4aOer?pt=aHJYNXJm%3D".to_string(),
                "https://bowfile.com/4aOer?pt=b1Y1SlIv%3D".to_string(),
            ]
        );
        let locked = parse_bowfile_page(r#"<form><input type="password" name="filePassword"></form>"#);
        assert!(locked.blocked && locked.pt_urls.is_empty());
    }

    #[test]
    fn maps_error_redirects() {
        let code = |url: &str| error_from_final_url(&Url::parse(url).unwrap()).map(|e| e.code());
        assert_eq!(code("https://bowfile.com/error?e=File+has+been+removed."), Some("file_gone"));
        assert_eq!(
            code("https://bowfile.com/error?e=File+has+been+removed+due+to+inactivity."),
            Some("file_gone")
        );
        assert_eq!(
            code("https://bowfile.com/error?e=File+can+not+be+located%2C+please+try+again+later."),
            Some("link_expired")
        );
        assert_eq!(code("https://bowfile.com/4aOer"), None);
        assert!(is_token_url(
            "https://fs21.bowfile.com/token/download/dl/4aOer/Esoteric.zip?download_token=ec9a8f"
        ));
        assert!(!is_token_url("https://bowfile.com/4aOer?pt=x"));
        assert_eq!(
            redirect_error("https://bowfile.com/account").map(|e| e.code()),
            Some("file_gone")
        );
    }

    #[test]
    fn parses_folder_listing() {
        let html = r#"<div class="fileListing"><div dttitle="Game v1 Win.zip" dtsizeraw="185239" dtfullurl="https://bowfile.com/2X0" dtfilename="Game v1 Win.zip" title="x" fileId="1346" class="col-xs-4 fileItem1346 fileIconLi  not-owned-image"><span>x</span></div><div dtfilename="Game v1 Mac.zip" dtsizeraw="99" fileId="1347" class="fileIconLi"></div><div class="folderIconLi" folderid="9"></div></div>"#;
        let body = serde_json::json!({ "html": html, "page_title": "Torrents" }).to_string();
        let files = parse_folder_listing(&body);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].file_name, "Game v1 Mac.zip");
        assert_eq!(files[1].id, "1346");
        assert_eq!(files[1].file_size, Some(185239));
        assert_eq!(files[1].direct_url, "https://bowfile.com/account/direct_download/1346");
        assert_eq!(
            folder_node_id("x loadImages('folder', folderId); loadImages('folder', '12', 1, 0, '')"),
            Some("12".into())
        );
    }
}
