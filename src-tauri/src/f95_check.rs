//! F95's "confirm you're not a bot" check before a download, passed inside
//! the app.
//!
//! When F95 asks an account for it, its `/dl/` download page shows an
//! hCaptcha the sidecar can't pass (`unmaskUrl` answers with `check`). The
//! downloader then shows that page in a window of the app, signed in as the
//! same member with the sidecar's `xf_*` cookies. The person passes the
//! check, the page goes on to the host (its `f95dl-go` element), and that
//! host URL comes back to the downloader, which carries on in the app. The
//! F95 cookies leave the webview again when the window closes.
//!
//! `download` reaches the window through a hook `init` registers, like
//! `cloudflare` does for `bridge`: called directly, WebView2 would end up in
//! the unit test binaries, which then fail to start.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::webview::{Cookie, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

use crate::download::host::host_label;
use crate::error::AppError;
use crate::sidecar::{SessionCookie, SidecarClient};

type CheckFn = fn(
    AppHandle,
    Arc<SidecarClient>,
    i64,
    String,
) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send>>;

static CHECK: OnceLock<CheckFn> = OnceLock::new();
/// One window at a time: downloads that need the check wait their turn.
static RUNNING: AsyncMutex<()> = AsyncMutex::const_new(());

const F95_URL: &str = "https://f95zone.to/";
/// Long enough to read the page and pass the check; the download fails after.
const WAIT: Duration = Duration::from_secs(600);
/// The page script reports the host URL by navigating here (`?u=`).
const MARK_HOST: &str = "f95dl-go.f95app.invalid";

/// On F95 pages: once the page that goes on to the host is up, report its
/// URL before F95's own script leaves for the host.
const GO_SCRIPT: &str = r#"
(() => {
  if (!/(^|\.)f95zone\.to$/.test(location.hostname)) return;
  let sent = false;
  const scan = () => {
    if (sent) return;
    const go = document.querySelector('[data-xf-init~="f95dl-go"][data-url]');
    const link = document.querySelector('.f95dl-going-link a[href]');
    const url = (go && go.getAttribute('data-url')) || (link && link.href);
    if (!url || !/^https?:\/\//i.test(url)) return;
    sent = true;
    location.replace('https://f95dl-go.f95app.invalid/?u=' + encodeURIComponent(url));
  };
  document.addEventListener('DOMContentLoaded', scan, { once: true });
  setInterval(scan, 250);
})();
"#;

/// Called at startup, next to `cloudflare::init`.
pub fn init() {
    let _ = CHECK.set(|app, sidecar, id, page| Box::pin(show(app, sidecar, id, page)));
}

/// The host URL behind `page_url`, once a person passed F95's check in the
/// app's window.
pub async fn pass(
    app: &AppHandle,
    sidecar: &Arc<SidecarClient>,
    download_id: i64,
    page_url: &str,
) -> Result<String, AppError> {
    let Some(check) = CHECK.get() else {
        return Err(not_passed("the check window is not available"));
    };
    check(app.clone(), sidecar.clone(), download_id, page_url.to_string()).await
}

async fn show(
    app: AppHandle,
    sidecar: Arc<SidecarClient>,
    download_id: i64,
    page_url: String,
) -> Result<String, AppError> {
    let page = Url::parse(&page_url)
        .ok()
        .filter(is_f95)
        .ok_or_else(|| AppError::Other(format!("not an F95 page: {page_url}")))?;
    let _running = RUNNING.lock().await;

    let cookies = sidecar.f95_session_cookies().await?;
    if !cookies.iter().any(|c| c.name == "xf_user" || c.name == "xf_session") {
        return Err(AppError::download(
            "session_expired",
            "no F95 session to show the download check with",
        ));
    }

    let (found_tx, found_rx) = oneshot::channel::<String>();
    let found_tx = Mutex::new(Some(found_tx));
    let (closed_tx, closed_rx) = oneshot::channel::<()>();
    let closed_tx = Mutex::new(Some(closed_tx));

    let label = format!("f95-check-{download_id}");
    if let Some(stale) = app.get_webview_window(&label) {
        let _ = stale.destroy();
    }
    let window = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(Url::parse("about:blank").expect("valid url")),
    )
    .title("F95Zone")
    .inner_size(560.0, 760.0)
    .min_inner_size(420.0, 520.0)
    .center()
    .resizable(true)
    // Also over full-screen Big Picture.
    .always_on_top(true)
    .user_agent(&crate::cloudflare::webview_user_agent())
    .initialization_script(GO_SCRIPT)
    // The developer's links, ads: nothing here needs a second window.
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_navigation(move |u| {
        if u.host_str() == Some(MARK_HOST) {
            if let Some(link) = u.query_pairs().find(|(k, _)| k == "u").map(|(_, v)| v.into_owned()) {
                deliver(&found_tx, &link);
            }
            return false;
        }
        if allowed(u) {
            return true;
        }
        // F95's own script leaving for the host before ours reported it.
        if u.host_str().is_some_and(is_download_host) {
            deliver(&found_tx, u.as_str());
        }
        false
    })
    .build()
    .map_err(|e| AppError::Other(format!("F95 check window: {e}")))?;
    // Closes the window however this ends, a cancelled download included.
    let window = CheckWindow(window);
    window.0.on_window_event(move |event| {
        let closing = match event {
            // CheckWindow closes it, once the F95 cookies are out of it.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                true
            }
            tauri::WindowEvent::Destroyed => true,
            _ => false,
        };
        if closing {
            if let Some(tx) = closed_tx.lock().unwrap().take() {
                let _ = tx.send(());
            }
        }
    });

    for cookie in &cookies {
        if let Err(e) = window.0.set_cookie(web_cookie(cookie)) {
            eprintln!("[f95-check] cookie {}: {e}", cookie.name);
        }
    }
    window
        .0
        .navigate(page)
        .map_err(|e| AppError::Other(format!("F95 check window: {e}")))?;
    let _ = window.0.set_focus();
    crate::dev_debug::log(Some(&app), "unmask", format!("F95 check shown for download {download_id}"));

    let found = tokio::select! {
        link = found_rx => link.ok(),
        _ = closed_rx => None,
        _ = tokio::time::sleep(WAIT) => None,
    };
    drop(window);

    match found {
        Some(link) => {
            crate::dev_debug::log(Some(&app), "unmask", format!("F95 check passed → {link}"));
            Ok(link)
        }
        None => Err(not_passed("the window was closed or timed out")),
    }
}

/// Hands the host URL over once; anything that isn't one is ignored.
fn deliver(tx: &Mutex<Option<oneshot::Sender<String>>>, link: &str) {
    let Ok(url) = Url::parse(link) else {
        return;
    };
    if !matches!(url.scheme(), "http" | "https") || is_f95(&url) {
        return;
    }
    if let Some(tx) = tx.lock().unwrap().take() {
        let _ = tx.send(url.to_string());
    }
}

fn is_f95(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|h| h == "f95zone.to" || h.ends_with(".f95zone.to"))
}

/// Pages the window may show: F95 itself, hCaptcha and Cloudflare's check.
fn allowed(url: &Url) -> bool {
    if url.scheme() == "about" {
        return true;
    }
    is_f95(url)
        || url.host_str().is_some_and(|h| {
            ["hcaptcha.com", "challenges.cloudflare.com"]
                .iter()
                .any(|d| h == *d || h.ends_with(&format!(".{d}")))
        })
}

/// A host the downloader knows (`host_label` names it), unlike the
/// developer's Patreon or an ad landing page.
fn is_download_host(host: &str) -> bool {
    host_label(host) != host
}

fn web_cookie(c: &SessionCookie) -> Cookie<'static> {
    // Session cookies: they only live as long as the window.
    Cookie::build((c.name.clone(), c.value.clone()))
        .domain(c.domain.clone())
        .path(c.path.clone().unwrap_or_else(|| "/".into()))
        .secure(c.secure)
        .http_only(c.http_only)
        .build()
}

struct CheckWindow(WebviewWindow);

impl Drop for CheckWindow {
    fn drop(&mut self) {
        forget_session(&self.0);
        let _ = self.0.destroy();
    }
}

/// Takes F95's sign-in cookies (and any F95 set meanwhile) out of the
/// webview, which every window of the app shares.
fn forget_session(window: &WebviewWindow) {
    let Ok(url) = Url::parse(F95_URL) else {
        return;
    };
    for cookie in window.cookies_for_url(url).unwrap_or_default() {
        if cookie.name().starts_with("xf_") {
            let _ = window.delete_cookie(cookie);
        }
    }
}

fn not_passed(detail: &str) -> AppError {
    AppError::download(
        "f95_check",
        format!("F95's check before the download was not passed: {detail}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_window_stays_on_f95_and_its_checks() {
        assert!(allowed(&url("about:blank")));
        assert!(allowed(&url("https://f95zone.to/dl/5617588/?u=1&k=a&r=1&t=b")));
        assert!(allowed(&url("https://newassets.hcaptcha.com/captcha/v1/x")));
        assert!(allowed(&url("https://challenges.cloudflare.com/cdn-cgi/x")));
        assert!(!allowed(&url("https://www.patreon.com/cw/someone")));
        assert!(!allowed(&url("https://gofile.io/d/AbCd12")));
        assert!(!allowed(&url("https://f95zone.to.example.com/")));
    }

    #[test]
    fn only_download_hosts_count_as_the_way_on() {
        assert!(is_download_host("gofile.io"));
        assert!(is_download_host("www.mediafire.com"));
        assert!(is_download_host("mega.nz"));
        assert!(!is_download_host("www.patreon.com"));
        assert!(!is_download_host("ads.example.net"));
    }

    #[test]
    fn delivers_one_host_url() {
        let (tx, mut rx) = oneshot::channel();
        let tx = Mutex::new(Some(tx));
        deliver(&tx, "https://f95zone.to/posts/1/");
        deliver(&tx, "javascript:alert(1)");
        assert!(rx.try_recv().is_err());
        deliver(&tx, "https://pixeldrain.com/u/AbCd1234");
        deliver(&tx, "https://gofile.io/d/second");
        assert_eq!(rx.try_recv().unwrap(), "https://pixeldrain.com/u/AbCd1234");
    }
}
