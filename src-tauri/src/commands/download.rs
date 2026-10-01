use super::captcha::captcha_window_label;
use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use std::path::PathBuf;
use tauri::{AppHandle, Manager as _, State};

/// `platform_group` is the F95 section label (e.g. "Win/Linux") — used to
/// auto-pick the PC build when a GoFile folder has several files.
#[tauri::command]
pub async fn download_start(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    source_url: String,
    thread_id: String,
    library_path: Option<String>,
    platform_group: Option<String>,
) -> Result<(), AppError> {
    let client = ensure_sidecar(&state).await?;
    let dest_root = library_path
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let platform_group = platform_group
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    state
        .downloader
        .start(
            app,
            client,
            id,
            source_url,
            thread_id,
            dest_root,
            platform_group,
        )
        .await
}

#[tauri::command]
pub async fn download_continue_choice(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    choice_id: String,
    thread_id: String,
    library_path: Option<String>,
) -> Result<(), AppError> {
    let dest_root = library_path
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    state
        .downloader
        .continue_with_file_choice(app, id, choice_id, thread_id, dest_root)
        .await
}

#[tauri::command]
pub async fn download_cancel(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), AppError> {
    state.downloader.cancel(id).await;
    // The verification window stays on top (also over Big Picture) and a
    // check passed later would start the download again.
    if let Some(win) = app.get_webview_window(&captcha_window_label(id)) {
        let _ = win.close();
    }
    Ok(())
}

/// Downloads the backend is still working on. The UI marks any other
/// in-progress row as interrupted (the app was closed mid-download).
#[tauri::command]
pub async fn download_active_ids(state: State<'_, AppState>) -> Result<Vec<i64>, AppError> {
    Ok(state.downloader.active_ids().await)
}
