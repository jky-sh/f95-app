use super::state::{ensure_sidecar, AppState, ProfileDto};
use crate::error::AppError;
use crate::sidecar;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<(), AppError> {
    let client = ensure_sidecar(&state).await?;
    client.login(&username, &password).await
}

#[tauri::command]
pub async fn get_profile(state: State<'_, AppState>) -> Result<ProfileDto, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.get_profile().await
}

/// Public profile of an arbitrary member (friend profile pages).
#[tauri::command]
pub async fn get_member_profile(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.get_member_profile(&user_id).await
}

/// No-op RPC used by the frontend to pre-spawn + init the sidecar without
/// firing any network call. Combined with the sidecar's strictly-serial
/// queue, this is the only way to "warm up" the process without letting a
/// slow real RPC (which would call out to F95Zone) sit in front of the
/// user's next action.
#[tauri::command]
pub async fn ping_sidecar(state: State<'_, AppState>) -> Result<(), AppError> {
    let client = ensure_sidecar(&state).await?;
    client.ping().await
}

#[tauri::command]
pub async fn is_logged_in(state: State<'_, AppState>) -> Result<bool, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.is_logged_in().await
}

/// True when persisted F95 session cookies exist on disk (no network call).
#[tauri::command]
pub fn has_local_session(state: State<'_, AppState>) -> bool {
    state.session_dir.join("default.json").is_file()
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), AppError> {
    // Fast path: the user wants the app to react NOW, not wait for a
    // round-trip to F95Zone. We do the local teardown synchronously
    // (kill sidecar + delete session file) and fire the F95 POST in the
    // background. If the network call fails, the local state is already
    // clean - F95 will eventually time out the session server-side too.
    //
    // Returns in ~50ms instead of waiting up to 5s for the POST.
    // Kill the sidecar - local teardown is enough for UX. The F95Zone
    // server-side session will time out on its own; we don't block on
    // POST /logout/. If the user really needs a server-side logout
    // (shared computer, etc.) they can do it via the browser.
    sidecar::kill(&state.sidecar).await;

    // Wipe the local session file directly - don't trust the sidecar's
    // cleanup, since we just killed it mid-flight. Best-effort: ENOENT
    // is fine, the user just hadn't logged in.
    let session_file = state.session_dir.join("default.json");
    let _ = std::fs::remove_file(&session_file);

    Ok(())
}
