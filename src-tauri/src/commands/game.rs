use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn game_detail(state: State<'_, AppState>, thread_id: String) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.game_detail(&thread_id).await
}

/// One page of a thread's posts (the OP left out): a page number, or
/// `"last"` for the newest. Raw JSON passthrough, typed in `types/game.ts`.
#[tauri::command]
pub async fn game_posts(
    state: State<'_, AppState>,
    thread_id: String,
    page: Value,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.game_posts(&thread_id, page).await
}

/// One page of a thread's reviews (F95's Reviews tab), newest first.
#[tauri::command]
pub async fn game_reviews(
    state: State<'_, AppState>,
    thread_id: String,
    page: u32,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.game_reviews(&thread_id, page).await
}

#[tauri::command]
pub async fn get_following(state: State<'_, AppState>) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.get_following().await
}
