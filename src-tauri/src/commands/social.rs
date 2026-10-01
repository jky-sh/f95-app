use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use serde_json::Value;
use tauri::State;

// Member tabs, member cards and follow toggles for the friends and profile
// pages. Raw JSON passthrough, typed on the frontend (`types/social.ts`).

/// A member's "Latest activity" (`kind = "latest"`) or "Postings"
/// (`kind = "postings"`) tab.
#[tauri::command]
pub async fn get_member_activity(
    state: State<'_, AppState>,
    user_id: String,
    kind: String,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.get_member_activity(&user_id, &kind).await
}

/// A member's About tab: bio, custom fields, signature and follow lists.
#[tauri::command]
pub async fn get_member_about(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.get_member_about(&user_id).await
}

/// Tooltip cards (last seen, banners, stats) for a batch of members.
#[tauri::command]
pub async fn get_member_cards(
    state: State<'_, AppState>,
    user_ids: Vec<String>,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.get_member_cards(&user_ids).await
}

/// Follow or unfollow a member; resolves to `{ following }`.
#[tauri::command]
pub async fn set_member_follow(
    state: State<'_, AppState>,
    user_id: String,
    follow: bool,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.set_member_follow(&user_id, follow).await
}
