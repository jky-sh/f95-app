use super::super::types::ResolveResult;
use crate::error::AppError;
use crate::sidecar::SidecarClient;
use tauri::AppHandle;

fn mixdrop_sidecar_to_direct(res: crate::sidecar::HostResolveResult) -> ResolveResult {
    let extra_headers: Vec<(String, String)> = res
        .extra_headers
        .into_iter()
        .map(|h| (h.name, h.value))
        .collect();
    ResolveResult::Direct {
        url: res.direct_url,
        file_name: res.file_name,
        file_size: res.file_size,
        expected_sha256: None,
        extra_headers,
    }
}

fn mixdrop_err_needs_browser(e: &AppError) -> bool {
    match e {
        // The sidecar's window waited on the user and gave up: the
        // verification window can still finish it.
        AppError::Cloudflare(_) | AppError::SidecarTimeout(_) => true,
        AppError::Other(msg) => {
            msg.contains("reCAPTCHA")
                || msg.contains("captcha")
                || msg.contains("genticket")
                || msg.contains("verificação")
        }
        _ => false,
    }
}

async fn resolve_mixdrop_headless(
    sidecar: &SidecarClient,
    app: &AppHandle,
    url: &str,
    api_email: Option<&str>,
    api_key: Option<&str>,
) -> Result<Option<ResolveResult>, AppError> {
    match sidecar.resolve_mixdrop(url, api_email, api_key).await {
        Ok(res) => {
            crate::dev_debug::log(
                Some(app),
                "mixdrop",
                format!("headless ok → {} ({})", res.file_name, res.direct_url),
            );
            Ok(Some(mixdrop_sidecar_to_direct(res)))
        }
        Err(e) if mixdrop_err_needs_browser(&e) => {
            crate::dev_debug::log(
                Some(app),
                "mixdrop",
                format!("headless captcha: {e} (url={url})"),
            );
            Ok(None)
        }
        Err(e) => {
            crate::dev_debug::log_error(
                Some(app),
                "mixdrop",
                format!("headless err: {e} (url={url})"),
            );
            Err(e)
        }
    }
}

/// MixDrop — headless Playwright, then headed auto-verify if captcha is required.
pub(crate) async fn resolve_mixdrop(
    sidecar: &SidecarClient,
    app: &AppHandle,
    url: &str,
    label: &str,
    api_email: Option<&str>,
    api_key: Option<&str>,
) -> Result<ResolveResult, AppError> {
    crate::dev_debug::log(Some(app), "mixdrop", format!("resolve {url} (sidecar)"));
    if let Some(direct) = resolve_mixdrop_headless(sidecar, app, url, api_email, api_key).await? {
        return Ok(direct);
    }
    Ok(ResolveResult::NeedsBrowser {
        url: url.to_string(),
        host: label.into(),
    })
}

/// MixDrop after the user solved reCAPTCHA in the in-app captcha window.
pub(crate) async fn resolve_mixdrop_with_cookies(
    sidecar: &SidecarClient,
    app: &AppHandle,
    url: &str,
    label: &str,
    cookie_header: &str,
    api_email: Option<&str>,
    api_key: Option<&str>,
) -> Result<ResolveResult, AppError> {
    crate::dev_debug::log(
        Some(app),
        "mixdrop",
        format!("resolve with session cookies {url}"),
    );
    match sidecar
        .resolve_mixdrop_with_cookies(url, cookie_header, api_email, api_key)
        .await
    {
        Ok(res) => {
            let extra_headers: Vec<(String, String)> = res
                .extra_headers
                .into_iter()
                .map(|h| (h.name, h.value))
                .collect();
            crate::dev_debug::log(
                Some(app),
                "mixdrop",
                format!(
                    "session ok → {} ({}) headers={}",
                    res.file_name,
                    res.direct_url,
                    extra_headers.len()
                ),
            );
            Ok(ResolveResult::Direct {
                url: res.direct_url,
                file_name: res.file_name,
                file_size: res.file_size,
                expected_sha256: None,
                extra_headers,
            })
        }
        Err(e @ (AppError::Cloudflare(_) | AppError::SidecarTimeout(_))) => {
            crate::dev_debug::log(
                Some(app),
                "mixdrop",
                format!("session captcha still pending: {e} (url={url})"),
            );
            Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label.into(),
            })
        }
        Err(AppError::Other(ref msg))
            if msg.contains("reCAPTCHA")
                || msg.contains("captcha")
                || msg.contains("genticket") =>
        {
            Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label.into(),
            })
        }
        Err(e) => {
            crate::dev_debug::log_error(
                Some(app),
                "mixdrop",
                format!("session err: {e} (url={url})"),
            );
            Err(e)
        }
    }
}

fn host_resolve_to_direct(res: crate::sidecar::HostResolveResult) -> ResolveResult {
    let extra_headers: Vec<(String, String)> = res
        .extra_headers
        .into_iter()
        .map(|h| (h.name, h.value))
        .collect();
    ResolveResult::Direct {
        url: res.direct_url,
        file_name: res.file_name,
        file_size: res.file_size,
        expected_sha256: None,
        extra_headers,
    }
}

/// MixDrop — headed Playwright window; blocks ad popups, waits for real reCAPTCHA.
pub(crate) async fn resolve_mixdrop_interactive(
    sidecar: &SidecarClient,
    app: &AppHandle,
    url: &str,
    label: &str,
    api_email: Option<&str>,
    api_key: Option<&str>,
) -> Result<ResolveResult, AppError> {
    crate::dev_debug::log(Some(app), "mixdrop", format!("interactive verify {url}"));
    match sidecar
        .resolve_mixdrop_interactive(url, api_email, api_key)
        .await
    {
        Ok(res) => {
            crate::dev_debug::log(
                Some(app),
                "mixdrop",
                format!("interactive ok → {} ({})", res.file_name, res.direct_url),
            );
            Ok(host_resolve_to_direct(res))
        }
        Err(AppError::Cloudflare(msg)) => {
            crate::dev_debug::log(
                Some(app),
                "mixdrop",
                format!("interactive captcha pending: {msg} (url={url})"),
            );
            Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label.into(),
            })
        }
        Err(AppError::Other(ref msg))
            if msg.contains("reCAPTCHA")
                || msg.contains("captcha")
                || msg.contains("genticket") =>
        {
            Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label.into(),
            })
        }
        Err(e) => {
            crate::dev_debug::log_error(
                Some(app),
                "mixdrop",
                format!("interactive err: {e} (url={url})"),
            );
            Err(e)
        }
    }
}
