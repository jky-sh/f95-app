use super::super::types::ResolveResult;
use crate::error::AppError;
use crate::sidecar::SidecarClient;
use tauri::AppHandle;

pub(crate) async fn resolve_gdrive(
    sidecar: &SidecarClient,
    http: &reqwest::Client,
    app: &AppHandle,
    url: &str,
    label: &str,
) -> Result<ResolveResult, AppError> {
    crate::dev_debug::log(Some(app), "gdrive", format!("resolve {url} (playwright)"));
    match sidecar.resolve_gdrive(url).await {
        Ok(res) => {
            let direct_url = res.direct_url;
            let file_name = res.file_name;
            let file_size = res.file_size;
            crate::dev_debug::log(
                Some(app),
                "gdrive",
                format!("ok (playwright) → {file_name} ({direct_url})"),
            );
            return Ok(ResolveResult::Direct {
                url: direct_url,
                file_name,
                file_size,
                expected_sha256: None,
                extra_headers: crate::gdrive::gdrive_headers(url),
            });
        }
        Err(e) => {
            crate::dev_debug::log_warn(
                Some(app),
                "gdrive",
                format!("playwright failed: {e} — trying http"),
            );
        }
    }

    match crate::gdrive::resolve(http, url).await? {
        crate::gdrive::GdriveOutcome::Direct(d) => {
            crate::dev_debug::log(
                Some(app),
                "gdrive",
                format!("ok (http) → {} ({})", d.file_name, d.url),
            );
            Ok(ResolveResult::Direct {
                url: d.url,
                file_name: d.file_name,
                file_size: d.file_size,
                expected_sha256: None,
                extra_headers: d.extra_headers,
            })
        }
        crate::gdrive::GdriveOutcome::NeedsBrowser => {
            crate::dev_debug::log(Some(app), "gdrive", format!("needs browser (url={url})"));
            Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label.into(),
            })
        }
    }
}
