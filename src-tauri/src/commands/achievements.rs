//! Comandos Tauri da integração de achievements Steam.

use super::state::AppState;
use crate::achievements::{steam_api, WatchedGameConfig};
use crate::error::AppError;
use tauri::{AppHandle, State};

/// Substitui o conjunto de jogos observados pelo watcher (chamado no boot e
/// sempre que um vínculo de appid muda). Dispara um scan imediato.
#[tauri::command]
pub async fn achievements_configure(
    app: AppHandle,
    state: State<'_, AppState>,
    games: Vec<WatchedGameConfig>,
) -> Result<(), AppError> {
    state.achievements.configure(&app, games).await;
    Ok(())
}

/// Força uma passada de scan fora do tick (ex.: ao abrir a página do jogo).
#[tauri::command]
pub async fn achievements_scan_now(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.achievements.scan(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn steam_fetch_achievement_schema(
    app_id: String,
    language: String,
    api_key: Option<String>,
) -> Result<Vec<steam_api::SteamAchievementSchemaEntry>, AppError> {
    steam_api::fetch_schema(&app_id, &language, api_key.as_deref()).await
}

#[tauri::command]
pub async fn steam_search_games(
    term: String,
) -> Result<Vec<steam_api::SteamSearchResult>, AppError> {
    steam_api::search_games(&term).await
}

/// Vasculha a pasta do jogo por configs de crack que revelem o appid.
#[tauri::command]
pub async fn steam_detect_appid(
    install_path: Option<String>,
    exe_path: Option<String>,
) -> Result<Option<String>, AppError> {
    tokio::task::spawn_blocking(move || {
        steam_api::detect_appid(
            install_path.as_deref().map(std::path::Path::new),
            exe_path.as_deref().map(std::path::Path::new),
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("detect appid: {e}")))
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementToastItem {
    pub title: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
}

/// Mostra o toast "conquista desbloqueada" ancorado na janela do jogo
/// (reusa a janela overlay-hint). Retorna false quando o jogo não está
/// rodando ou a janela não foi encontrada — o chamador cai para a
/// notificação do sininho.
#[tauri::command]
pub async fn achievement_toast(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    items: Vec<AchievementToastItem>,
    unlocked_count: u32,
    total_count: u32,
) -> Result<bool, AppError> {
    if items.is_empty() {
        return Ok(false);
    }
    let Some(pid) = state.launcher.pid_for(&thread_id).await else {
        return Ok(false);
    };
    super::overlay::show_achievement_toasts(
        &app,
        state.inner(),
        pid,
        items,
        unlocked_count,
        total_count,
    )
    .await
}
