//! Cloudflare checks that need a person, shown inside the app.
//!
//! The sidecar passes F95's Cloudflare check headless on its own. When
//! Cloudflare wants a person (a click), its call fails with the
//! `interactive` variant and `bridge::Sidecar` runs the check `init`
//! registered: it
//! opens in WebView2 inside the login window, or in a small window of its
//! own once the main window is up. When the F95 page behind it loads, its
//! Cloudflare cookies and this WebView2's User-Agent (the clearance only
//! holds for it) go to the sidecar's `importClearance`, and the call runs
//! again.

use crate::bridge::RpcErrorPayload;
use crate::error::AppError;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::webview::{Cookie, Webview};
use tauri::window::Window;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl,
};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

static APP: OnceLock<AppHandle> = OnceLock::new();
/// One check at a time; calls that hit Cloudflare together share it.
static RUNNING: AsyncMutex<()> = AsyncMutex::const_new(());
/// When the last check passed, so calls that waited for it skip theirs.
static LAST_PASSED: Mutex<Option<Instant>> = Mutex::new(None);
/// Ends the check in progress: Cancel in the login window, or its own window closed.
static CANCEL: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

const WEBVIEW_LABEL: &str = "cloudflare-check";
const WINDOW_LABEL: &str = "cloudflare-check-window";
const F95_URL: &str = "https://f95zone.to/";
/// The page script navigates here once the F95 page behind the check loads.
const CLEARED_HOST: &str = "cleared.f95app.invalid";
const WAIT: Duration = Duration::from_secs(300);
/// Where the check sits in the login window, in logical px. LoginWindow
/// lays out its text around the rect it gets in the event.
const EMBED_RECT: (f64, f64, f64, f64) = (12.0, 104.0, 396.0, 392.0);
/// Broadcast; LoginWindow is the one listening.
const EVENT: &str = "cloudflare:check";

/// Cloudflare's check page defines `_cf_chl_opt`; the F95 page behind it
/// doesn't.
const DETECT_SCRIPT: &str = r#"
(() => {
  if (!/(^|\.)f95zone\.to$/.test(location.hostname)) return;
  const check = () => {
    if (!('_cf_chl_opt' in window)) location.replace('https://cleared.f95app.invalid/');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true });
  else check();
})();
"#;

/// Called at startup. `bridge` gets the check as a hook rather than calling
/// it, which keeps WebView2 out of the unit test binaries (they lack the
/// app manifest its dialogs need, and wouldn't start).
pub fn init(app: AppHandle) {
    let _ = APP.set(app);
    crate::bridge::set_person_check(|err| Box::pin(verify(err)));
}

/// The sidecar's answer when Cloudflare wants a person.
pub fn needs_person(err: &RpcErrorPayload) -> bool {
    err.code == -32010
        && err
            .data
            .as_ref()
            .and_then(|d| d.get("variant"))
            .and_then(Value::as_str)
            == Some("interactive")
}

/// Cancel in the login window.
#[tauri::command]
pub fn cloudflare_cancel_check() {
    cancel();
}

fn cancel() {
    if let Some(tx) = CANCEL.lock().unwrap().take() {
        let _ = tx.send(());
    }
}

/// Shows the check and waits for the person. Returns the params of the
/// sidecar's `importClearance`, or None when another call's check passed
/// while this one waited.
async fn verify(err: RpcErrorPayload) -> Result<Option<Value>, AppError> {
    let asked_at = Instant::now();
    let Some(app) = APP.get().cloned() else {
        return Err(AppError::Cloudflare(err.message.clone()));
    };
    let _running = RUNNING.lock().await;
    if LAST_PASSED.lock().unwrap().is_some_and(|at| at > asked_at) {
        return Ok(None);
    }

    let url = err
        .data
        .as_ref()
        .and_then(|d| d.get("url"))
        .and_then(Value::as_str)
        .and_then(|u| Url::parse(u).ok())
        .filter(|u| {
            u.host_str()
                .is_some_and(|h| h == "f95zone.to" || h.ends_with(".f95zone.to"))
        })
        .unwrap_or_else(|| Url::parse(F95_URL).expect("valid url"));
    let user_agent = webview_user_agent();
    let (cancel_tx, cancel_rx) = oneshot::channel();
    *CANCEL.lock().unwrap() = Some(cancel_tx);
    let (passed_tx, passed_rx) = oneshot::channel();
    let passed_tx = Mutex::new(Some(passed_tx));

    let builder = WebviewBuilder::new(WEBVIEW_LABEL, WebviewUrl::External(url))
        .user_agent(&user_agent)
        .initialization_script(DETECT_SCRIPT)
        .on_navigation(move |u| {
            if u.host_str() != Some(CLEARED_HOST) {
                return true;
            }
            if let Some(tx) = passed_tx.lock().unwrap().take() {
                let _ = tx.send(());
            }
            false
        });
    let shown = show(&app, builder).inspect_err(|e| {
        CANCEL.lock().unwrap().take();
        eprintln!("[cloudflare] could not show the check: {e}");
    })?;
    eprintln!(
        "[cloudflare] check shown {}",
        if shown.window.is_some() {
            "in its own window"
        } else {
            "in the login window"
        }
    );

    let passed = tokio::select! {
        r = passed_rx => r.is_ok(),
        _ = cancel_rx => false,
        _ = tokio::time::sleep(WAIT) => false,
    };
    let cookies = if passed {
        clearance_cookies(&shown.webview)
    } else {
        Vec::new()
    };
    shown.close(&app);
    CANCEL.lock().unwrap().take();

    eprintln!(
        "[cloudflare] check {}",
        if passed { "passed" } else { "not completed" }
    );
    if !passed {
        return Err(AppError::Cloudflare(
            "the Cloudflare check was not completed".into(),
        ));
    }
    *LAST_PASSED.lock().unwrap() = Some(Instant::now());
    Ok(Some(json!({ "cookies": cookies, "userAgent": user_agent })))
}

struct Shown {
    webview: Webview,
    /// The window of its own, when the login window isn't up.
    window: Option<Window>,
}

impl Shown {
    fn close(&self, app: &AppHandle) {
        let _ = self.webview.close();
        match &self.window {
            Some(window) => {
                let _ = window.destroy();
            }
            None => {
                let _ = app.emit(EVENT, json!({ "active": false }));
            }
        }
    }
}

fn show(app: &AppHandle, builder: WebviewBuilder<tauri::Wry>) -> Result<Shown, AppError> {
    let fail = |e: tauri::Error| AppError::Other(format!("Cloudflare check window: {e}"));
    if let Some(login) = app
        .get_window("login")
        .filter(|w| w.is_visible().unwrap_or(false))
    {
        let (x, y, width, height) = EMBED_RECT;
        let webview = login
            .add_child(
                builder,
                LogicalPosition::new(x, y),
                LogicalSize::new(width, height),
            )
            .map_err(fail)?;
        let _ = app.emit(
            EVENT,
            json!({ "active": true, "rect": { "x": x, "y": y, "width": width, "height": height } }),
        );
        return Ok(Shown {
            webview,
            window: None,
        });
    }

    let window = Window::builder(app, WINDOW_LABEL)
        .title("F95Zone — Cloudflare")
        .inner_size(460.0, 620.0)
        .center()
        .always_on_top(true)
        .build()
        .map_err(fail)?;
    // Closing it is a cancel.
    window.on_window_event(|event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            cancel();
        }
    });
    let webview = window
        .add_child(
            builder.auto_resize(),
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(460.0, 620.0),
        )
        .map_err(fail)?;
    let _ = window.set_focus();
    Ok(Shown {
        webview,
        window: Some(window),
    })
}

/// Cloudflare's own cookies (cf_clearance, __cf_bm). The F95 ones stay out:
/// this browser isn't signed in, and its xf_ cookies would sign the
/// sidecar's session out.
fn clearance_cookies(webview: &Webview) -> Vec<Value> {
    let url = Url::parse(F95_URL).expect("valid url");
    webview
        .cookies_for_url(url)
        .unwrap_or_default()
        .iter()
        .filter(|c| c.name().starts_with("cf_") || c.name().starts_with("__cf"))
        .map(cookie_json)
        .collect()
}

fn cookie_json(c: &Cookie<'static>) -> Value {
    json!({
        "name": c.name(),
        "value": c.value(),
        "domain": c.domain().unwrap_or("f95zone.to"),
        "path": c.path().unwrap_or("/"),
        "expires": c.expires_datetime().map(|t| t.unix_timestamp()),
        "secure": c.secure().unwrap_or(true),
        "httpOnly": c.http_only().unwrap_or(false),
    })
}

/// WebView2's own User-Agent format with its real version, so it agrees
/// with the client hints Cloudflare also reads.
fn webview_user_agent() -> String {
    let major = tauri::webview_version()
        .ok()
        .and_then(|v| v.split('.').next().map(str::to_owned))
        .unwrap_or_else(|| "155".into());
    format!(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
         (KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36 Edg/{major}.0.0.0"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(code: i32, data: Option<Value>) -> RpcErrorPayload {
        RpcErrorPayload {
            code,
            message: "check".into(),
            data,
        }
    }

    #[test]
    fn only_the_interactive_variant_needs_a_person() {
        assert!(needs_person(&payload(
            -32010,
            Some(json!({ "variant": "interactive" }))
        )));
        assert!(!needs_person(&payload(
            -32010,
            Some(json!({ "variant": "managed" }))
        )));
        assert!(!needs_person(&payload(-32010, None)));
        assert!(!needs_person(&payload(
            -32603,
            Some(json!({ "variant": "interactive" }))
        )));
    }
}
