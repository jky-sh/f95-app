//! Watcher de achievements estilo Hydra.
//!
//! Polling: a cada tick compara o mtime dos arquivos candidatos (ver
//! `finder`) e, quando algo muda, re-parseia tudo do jogo, funde os unlocks
//! de todas as fontes e emite `achievement:sync` para o frontend — que é quem
//! persiste no SQLite (o Rust não toca no banco, só o plugin SQL) e decide
//! toast/notificação. O primeiro scan de cada jogo é o "baseline": o evento
//! sai com `initial: true` para o frontend sincronizar em silêncio.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as AsyncMutex;

use super::finder::candidate_files;
use super::parser::{parse_achievement_file, UnlockedAchievement};

/// Intervalo com algum jogo observado em execução.
const POLL_RUNNING: Duration = Duration::from_secs(3);
/// Intervalo com tudo parado (pega unlocks de jogos abertos por fora do app).
const POLL_IDLE: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedGameConfig {
    pub thread_id: String,
    pub app_id: String,
    pub exe_path: Option<String>,
    #[serde(default)]
    pub install_path: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    /// Modo experimental: procura os nomes das conquistas nos saves do
    /// próprio jogo (builds DRM-free sem emulador).
    #[serde(default)]
    pub save_scan: bool,
    /// Nomes do schema Steam (api + display), enviados pelo frontend quando
    /// `save_scan` está ativo — o Rust não lê o SQLite.
    #[serde(default)]
    pub achievement_names: Vec<super::savescan::AchievementNamePair>,
}

#[derive(Default)]
struct WatcherInner {
    games: Vec<WatchedGameConfig>,
    /// mtime (ms) por arquivo candidato existente na última passada.
    file_mtimes: HashMap<PathBuf, u64>,
    /// api_names (uppercase) já emitidos por jogo — evita eventos repetidos.
    known: HashMap<String, HashSet<String>>,
    /// Jogos que já passaram pelo scan inicial.
    baselined: HashSet<String>,
}

pub struct Watcher {
    inner: AsyncMutex<WatcherInner>,
    loop_started: AtomicBool,
}

impl Watcher {
    pub fn new() -> Self {
        Self {
            inner: AsyncMutex::new(WatcherInner::default()),
            loop_started: AtomicBool::new(false),
        }
    }

    /// Substitui o conjunto de jogos observados e inicia o loop na primeira
    /// chamada. Jogos re-vinculados (appid trocado) voltam ao estado inicial.
    pub async fn configure(&self, app: &AppHandle, games: Vec<WatchedGameConfig>) {
        {
            let mut inner = self.inner.lock().await;
            let previous: HashMap<String, String> = inner
                .games
                .iter()
                .map(|g| (g.thread_id.clone(), g.app_id.clone()))
                .collect();
            let next_ids: HashSet<&str> = games.iter().map(|g| g.thread_id.as_str()).collect();

            let mut reset: Vec<String> = Vec::new();
            for game in &games {
                if previous
                    .get(&game.thread_id)
                    .map(|appid| appid != &game.app_id)
                    .unwrap_or(false)
                {
                    reset.push(game.thread_id.clone());
                }
            }
            for thread_id in reset {
                inner.known.remove(&thread_id);
                inner.baselined.remove(&thread_id);
            }
            inner.known.retain(|k, _| next_ids.contains(k.as_str()));
            inner.baselined.retain(|k| next_ids.contains(k.as_str()));
            inner.games = games;
        }

        if !self.loop_started.swap(true, Ordering::SeqCst) {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                run_loop(app).await;
            });
        }

        // Passada imediata para estabelecer o baseline sem esperar o tick.
        self.scan(app).await;
    }

    /// Uma passada completa de scan (também exposta como comando).
    pub async fn scan(&self, app: &AppHandle) {
        let mut inner = self.inner.lock().await;
        let games = inner.games.clone();
        for game in games {
            scan_game(app, &mut inner, &game);
        }
    }

    async fn any_watched_game_running(&self, app: &AppHandle) -> bool {
        let Some(state) = app.try_state::<crate::commands::AppState>() else {
            return false;
        };
        let running = state.launcher.running().await;
        if running.is_empty() {
            return false;
        }
        let inner = self.inner.lock().await;
        running
            .iter()
            .any(|r| inner.games.iter().any(|g| g.thread_id == r.thread_id))
    }
}

async fn run_loop(app: AppHandle) {
    loop {
        let watcher = {
            let Some(state) = app.try_state::<crate::commands::AppState>() else {
                tokio::time::sleep(POLL_IDLE).await;
                continue;
            };
            state.achievements.clone()
        };
        let interval = if watcher.any_watched_game_running(&app).await {
            POLL_RUNNING
        } else {
            POLL_IDLE
        };
        tokio::time::sleep(interval).await;
        watcher.scan(&app).await;
    }
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn scan_game(app: &AppHandle, inner: &mut WatcherInner, game: &WatchedGameConfig) {
    let exe_path = game.exe_path.as_ref().map(PathBuf::from);
    let install_path = game.install_path.as_ref().map(PathBuf::from);
    let candidates = candidate_files(&game.app_id, exe_path.as_deref());

    // Levanta o que existe no disco e se algo mudou desde a última passada.
    let mut changed = false;
    let mut existing = Vec::new();
    for candidate in candidates {
        let Ok(meta) = std::fs::metadata(&candidate.path) else {
            continue;
        };
        if candidate.is_dir != meta.is_dir() {
            continue;
        }
        let mtime = mtime_ms(&meta);
        if inner.file_mtimes.get(&candidate.path) != Some(&mtime) {
            changed = true;
            inner.file_mtimes.insert(candidate.path.clone(), mtime);
        }
        existing.push(candidate);
    }

    // Modo save-scan (opt-in): os saves do próprio jogo também entram no
    // conjunto observado; qualquer mudança de mtime dispara re-varredura.
    let mut save_files: Vec<PathBuf> = Vec::new();
    if game.save_scan && !game.achievement_names.is_empty() {
        let title = game.title.as_deref().unwrap_or("");
        save_files = super::savescan::discover_save_files(
            title,
            install_path.as_deref(),
            exe_path.as_deref(),
        );
        for path in &save_files {
            let Ok(meta) = std::fs::metadata(path) else { continue };
            let mtime = mtime_ms(&meta);
            if inner.file_mtimes.get(path) != Some(&mtime) {
                changed = true;
                inner.file_mtimes.insert(path.clone(), mtime);
            }
        }
    }

    let initial = !inner.baselined.contains(&game.thread_id);
    if !changed && !initial {
        return;
    }

    // Funde os unlocks de todas as fontes, dedup por api_name (case-insens);
    // entradas com timestamp ganham das sem.
    let mut merged: HashMap<String, UnlockedAchievement> = HashMap::new();
    for candidate in &existing {
        for unlock in parse_achievement_file(&candidate.path, candidate.cracker) {
            let key = unlock.api_name.to_uppercase();
            match merged.get(&key) {
                Some(current) if current.unlock_time.is_some() || unlock.unlock_time.is_none() => {}
                _ => {
                    merged.insert(key, unlock);
                }
            }
        }
    }
    if game.save_scan && !save_files.is_empty() {
        for unlock in super::savescan::scan_unlocked(&save_files, &game.achievement_names) {
            let key = unlock.api_name.to_uppercase();
            // Emulador (formato explícito de unlock) tem precedência sobre a
            // heurística de save.
            merged.entry(key).or_insert(unlock);
        }
    }

    inner.baselined.insert(game.thread_id.clone());

    let names: HashSet<String> = merged.keys().cloned().collect();
    let known = inner.known.entry(game.thread_id.clone()).or_default();
    let has_new = names.iter().any(|n| !known.contains(n));
    known.extend(names);

    if merged.is_empty() || (!initial && !has_new) {
        return;
    }

    let mut achievements: Vec<UnlockedAchievement> = merged.into_values().collect();
    achievements.sort_by_key(|a| a.unlock_time.unwrap_or(0));

    let _ = app.emit(
        "achievement:sync",
        json!({
            "threadId": game.thread_id,
            "appId": game.app_id,
            "initial": initial,
            "achievements": achievements,
        }),
    );
}
