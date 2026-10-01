use super::state::{ensure_sidecar, AppState};
use crate::download::host::needs_verify_window;
use crate::download::verify;
use crate::error::AppError;
use reqwest::Url;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub(crate) fn captcha_window_label(download_id: i64) -> String {
    format!("captcha-{download_id}")
}

pub(crate) fn supports_in_app_captcha(host: &str) -> bool {
    needs_verify_window(host)
}

/// Hand a captured link to the UI (which re-queues the row and calls
/// `download_continue_verified`), then close the window. Runs once.
fn deliver_link(app: &AppHandle, done: &AtomicBool, id: i64, host: &str, page: &str, link: String) {
    if done.swap(true, Ordering::SeqCst) {
        return;
    }
    crate::dev_debug::log(Some(app), host, format!("verification window captured {link}"));
    let _ = app.emit(
        "download:verified",
        json!({ "id": id, "host": host, "pageUrl": page, "url": link }),
    );
    // Closing from inside a navigation callback is not safe on every
    // platform; do it right after.
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        if let Some(win) = app.get_webview_window(&captcha_window_label(id)) {
            let _ = win.close();
        }
    });
}

/// Blocks fake ad captchas (miixdrop.net) and trims page chrome inside the webview.
const CAPTCHA_INIT_SCRIPT: &str = r#"
(() => {
  const fakeId = Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const fpStub = {
    load: () => Promise.resolve({
      get: () => Promise.resolve({ visitorId: fakeId, confidence: { score: 0.99 } }),
    }),
  };
  Object.defineProperty(window, 'FingerprintJS', { configurable: true, get: () => fpStub, set: () => {} });
  const FAKE = /miixdrop|mii[x]+drop|confirme que você|confirm that you are not a robot|não é um robô/i;
  const REAL = /google\.com\/recaptcha|gstatic\.com\/recaptcha|recaptcha/i;
  const BAD_HOST = /miixdrop|mii[x]+drop/i;
  function blocked(url) { return BAD_HOST.test(url || ''); }
  function fixUrl(url) {
    try {
      const u = new URL(String(url), location.href);
      if (!BAD_HOST.test(u.hostname)) return null;
      const path = u.pathname || location.pathname;
      return 'https://mixdrop.ag' + (path.startsWith('/') ? path : '/' + path) + u.search;
    } catch { return null; }
  }
  if (BAD_HOST.test(location.hostname)) {
    const fixed = fixUrl(location.href);
    if (fixed) location.replace(fixed);
  }
  const loc = window.location;
  for (const fn of ['assign', 'replace']) {
    const orig = loc[fn].bind(loc);
    loc[fn] = (url) => { const f = fixUrl(url); return orig(f || url); };
  }
  const origOpen = window.open;
  window.open = (...args) => {
    const target = String(args[0] ?? '');
    const f = fixUrl(target);
    if (blocked(target) && !f) return null;
    if (f) args[0] = f;
    return origOpen.apply(window, args);
  };
  function clickFakeOk() {
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      if (!(el instanceof HTMLElement)) continue;
      const label = (el.textContent || '').trim();
      if (!/^OK$/i.test(label)) continue;
      let p = el.parentElement;
      for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
        const text = (p.innerText || p.textContent || '').slice(0, 600);
        if (FAKE.test(text)) { el.click(); return; }
      }
    }
  }
  function scrub() {
    clickFakeOk();
    for (const el of document.querySelectorAll('div, section, aside, iframe, dialog')) {
      if (!(el instanceof HTMLElement)) continue;
      const text = (el.innerText || el.textContent || '').slice(0, 600);
      const src = el.getAttribute('src') || '';
      if (REAL.test(text) || REAL.test(src)) continue;
      if (FAKE.test(text) || blocked(src)) el.remove();
    }
  }
  function tryDownloadClick() {
    for (const sel of ['a.download-btn', 'a[href*="?download"]']) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLElement) { el.click(); return; }
    }
    for (const el of document.querySelectorAll('a, button')) {
      if (!(el instanceof HTMLElement)) continue;
      if (/^DOWNLOAD$/i.test((el.textContent || '').trim())) { el.click(); return; }
    }
  }
  function injectCss() {
    if (document.getElementById('f95-captcha-css')) return;
    const s = document.createElement('style');
    s.id = 'f95-captcha-css';
    s.textContent = `
      header, nav, footer, .menu, .navbar, .share, .social, .footer,
      [class*="banner"], [class*="advert"], [id*="advert"], [class*="ads"],
      iframe:not([src*="recaptcha"]) {
        display: none !important; visibility: hidden !important; pointer-events: none !important;
      }
      body { background: #141414 !important; margin: 0 !important; }
      .download-btn, a.download-btn, a[href*="download"], [class*="download"], h1, h2 {
        visibility: visible !important; display: revert !important;
      }
    `;
    document.documentElement.appendChild(s);
  }
  scrub(); injectCss(); tryDownloadClick();
  setInterval(() => { scrub(); injectCss(); tryDownloadClick(); }, 500);
  new MutationObserver(() => { scrub(); injectCss(); tryDownloadClick(); }).observe(document.documentElement, { childList: true, subtree: true });
})();
"#;

fn normalize_mixdrop_page_url(raw: &str) -> Result<String, AppError> {
    let u = Url::parse(raw.trim()).map_err(|e| AppError::Other(format!("URL inválida: {e}")))?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return Err(AppError::Other("URL inválida".into()));
    }
    let segs: Vec<&str> = u.path().split('/').filter(|s| !s.is_empty()).collect();
    let idx = segs.iter().position(|s| *s == "f" || *s == "e");
    let fileref = idx
        .and_then(|i| segs.get(i + 1))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Other("URL MixDrop inválida".into()))?;
    Ok(format!("https://mixdrop.is/f/{fileref}"))
}

fn merge_cookie_pairs(
    out: &mut HashMap<String, String>,
    cookies: &[tauri::webview::Cookie<'static>],
) {
    for c in cookies {
        out.insert(c.name().to_string(), c.value().to_string());
    }
}

fn collect_mixdrop_cookie_header(
    window: &tauri::WebviewWindow,
    page_url: &str,
) -> Result<String, AppError> {
    let normalized = normalize_mixdrop_page_url(page_url)?;
    let mut pairs: HashMap<String, String> = HashMap::new();

    if let Ok(all) = window.cookies() {
        for c in &all {
            let domain = c.domain().unwrap_or("");
            if domain.contains("mixdrop") {
                merge_cookie_pairs(&mut pairs, std::slice::from_ref(c));
            }
        }
    }

    for url_str in [page_url, normalized.as_str()] {
        if let Ok(url) = Url::parse(url_str) {
            if let Ok(list) = window.cookies_for_url(url) {
                merge_cookie_pairs(&mut pairs, &list);
            }
        }
    }

    if pairs.is_empty() {
        return Err(AppError::Other(
            "Sessão não encontrada. Na janela de verificação, clique em DOWNLOAD, \
             resolva o reCAPTCHA do Google se aparecer, e clique em Continuar download."
                .into(),
        ));
    }

    Ok(pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; "))
}

/// Opens (or focuses) the in-app verification webview for a host that needs
/// a human check (`download::host::VERIFY_WINDOW_HOSTS`). It stays on top so
/// it also shows over full-screen Big Picture. `title` comes translated from
/// the UI.
#[tauri::command]
pub async fn open_captcha_window(
    app: AppHandle,
    download_id: i64,
    url: String,
    host: String,
    title: Option<String>,
) -> Result<(), AppError> {
    let host = host.trim().to_lowercase();
    if !supports_in_app_captcha(&host) {
        return Err(AppError::Other(format!(
            "Verificação embutida não disponível para {host}"
        )));
    }

    let captures = verify::captures_link(&host);
    let page_url = if captures {
        verify::page_url(&host, &url)
            .ok_or_else(|| AppError::Other(format!("{host}: link not supported here: {url}")))?
    } else {
        normalize_mixdrop_page_url(&url)?
    };
    let external = Url::parse(&page_url).map_err(|e| AppError::Other(format!("URL: {e}")))?;
    let label = captcha_window_label(download_id);

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    let title = title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| format!("{host} — verificação"));
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(external))
        .title(title)
        .inner_size(520.0, 680.0)
        .min_inner_size(420.0, 480.0)
        .center()
        .decorations(true)
        .resizable(true)
        .always_on_top(true)
        // Ads open pop-unders; nothing in a check needs a second window.
        .on_new_window(|_, _| NewWindowResponse::Deny);

    if captures {
        let done = Arc::new(AtomicBool::new(false));
        let (nav_app, nav_done, nav_host, nav_page) =
            (app.clone(), done.clone(), host.clone(), page_url.clone());
        let (dl_app, dl_host, dl_page) = (app.clone(), host.clone(), page_url.clone());
        builder = builder
            .initialization_script(verify::CAPTURE_INIT_SCRIPT)
            .on_navigation(move |u| {
                if let Some(link) = verify::captured_link(&nav_host, u) {
                    deliver_link(&nav_app, &nav_done, download_id, &nav_host, &nav_page, link);
                    return false;
                }
                verify::allowed_page(&nav_host, u)
            })
            // Backup for when the user starts the page's own download.
            .on_download(move |_, event| {
                if let DownloadEvent::Requested { url, .. } = event {
                    if verify::is_storage_link(&dl_host, &url) {
                        deliver_link(&dl_app, &done, download_id, &dl_host, &dl_page, url.to_string());
                    }
                    return false;
                }
                true
            });
    } else {
        builder = builder.initialization_script(CAPTCHA_INIT_SCRIPT);
    }

    let window = builder
        .build()
        .map_err(|e| AppError::Other(format!("criar janela de verificação: {e}")))?;

    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// Starts the download of a link the verification window captured (see
/// `download:verified`). The UI passes the row's library so the file lands
/// where the user chose.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn download_continue_verified(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    source_url: String,
    host: String,
    page_url: String,
    link: String,
    thread_id: String,
    library_path: Option<String>,
) -> Result<(), AppError> {
    let host = host.trim().to_lowercase();
    let parsed = Url::parse(&link).map_err(|e| AppError::Other(format!("URL: {e}")))?;
    if !verify::captures_link(&host) || !verify::is_storage_link(&host, &parsed) {
        return Err(AppError::Other(format!("{host}: not a download link: {link}")));
    }
    let dest_root = library_path
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    state
        .downloader
        .start_verified(app, id, source_url, host, page_url, link, thread_id, dest_root)
        .await
}

#[tauri::command]
pub async fn close_captcha_window(app: AppHandle, download_id: i64) -> Result<(), AppError> {
    let label = captcha_window_label(download_id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    Ok(())
}

/// Reads session cookies from the verification webview and resumes the download.
#[tauri::command]
pub async fn download_continue_captcha(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    source_url: String,
    page_url: String,
    thread_id: String,
    library_path: Option<String>,
) -> Result<(), AppError> {
    let label = captcha_window_label(id);
    let window = app.get_webview_window(&label).ok_or_else(|| {
        AppError::Other(
            "Janela de verificação não está aberta — clique em Abrir verificação primeiro.".into(),
        )
    })?;

    let normalized = normalize_mixdrop_page_url(&page_url)?;
    let cookie_header = collect_mixdrop_cookie_header(&window, &normalized)?;

    let client = ensure_sidecar(&state).await?;
    let dest_root = library_path
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);

    state
        .downloader
        .start_with_mixdrop_session(
            app.clone(),
            client,
            id,
            source_url,
            thread_id,
            dest_root,
            normalized,
            cookie_header,
        )
        .await?;

    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    Ok(())
}
