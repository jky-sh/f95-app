use super::state::AppState;
use crate::error::AppError;
use crate::sidecar;
use std::time::Duration;
use tauri::State;

/// Called between downloading an app update and installing it. The
/// installer replaces files the sidecar keeps open (its node.exe and
/// Playwright's browser), and on Windows the updater exits the process
/// without a `RunEvent::Exit`, so the usual shutdown kill never runs.
/// Until `abort_app_update`, any call that needs the sidecar fails instead
/// of starting a new one.
#[tauri::command]
pub async fn prepare_app_update(state: State<'_, AppState>) -> Result<(), AppError> {
    sidecar::block_starts(true);
    sidecar::kill(&state.sidecar).await;
    // TerminateProcess returns before Windows releases the process's files
    // (and before the browser notices its pipe closed and quits).
    tokio::time::sleep(Duration::from_millis(600)).await;
    Ok(())
}

/// The install failed and the app keeps running: the next sidecar call
/// starts a new one.
#[tauri::command]
pub fn abort_app_update() {
    sidecar::block_starts(false);
}
