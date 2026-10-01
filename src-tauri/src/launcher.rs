//! Game launcher.
//!
//! Spawns a child process for an installed game and tracks its lifetime so the
//! frontend can show "playing now" indicators and accumulate playtime. The
//! durable session row lives in `play_sessions` (owned by the JS layer); this
//! module just runs the OS process and emits `game:started` / `game:exited`
//! events with the duration measured in Rust.
//!
//! Child processes are NOT killed when our app exits — that's intentional, the
//! user can keep playing after closing us. Their session row stays open and is
//! cleaned up by `sessions.closeOrphans()` at the next app start.

use crate::error::AppError;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;

struct RunningGame {
    pid: u32,
    started: Instant,
    kill_tx: Option<oneshot::Sender<()>>,
    _waiter: JoinHandle<()>,
    _pid_refresh: JoinHandle<()>,
}

pub struct LauncherManager {
    inner: Arc<Mutex<HashMap<String, RunningGame>>>,
}

impl LauncherManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawn the game executable and start watching its lifetime. Returns the
    /// child PID immediately; observe `game:exited` for the result. `session_id`
    /// is the row id in `play_sessions` so JS can close the right session row
    /// when we report exit.
    pub async fn launch(
        &self,
        app: AppHandle,
        thread_id: String,
        title: String,
        exe_path: String,
        session_id: i64,
    ) -> Result<u32, AppError> {
        // Guard against double-launch.
        if self.inner.lock().await.contains_key(&thread_id) {
            return Err(AppError::Other(format!(
                "o jogo {thread_id} já está rodando"
            )));
        }

        let exe = PathBuf::from(&exe_path);
        if !exe.exists() {
            return Err(AppError::Other(format!(
                "executável não encontrado: {exe_path}"
            )));
        }
        // Most games look for resources relative to their own folder.
        let cwd = exe
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        let mut cmd = Command::new(&exe);
        cmd.current_dir(&cwd)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            // We intentionally do NOT set kill_on_drop — the user keeps playing
            // even if our app crashes or is closed.
            .kill_on_drop(false);

        let mut child = cmd
            .spawn()
            .map_err(|e| AppError::Other(format!("spawn falhou: {e}")))?;
        let pid = child.id().unwrap_or(0);
        let started = Instant::now();

        let (kill_tx, kill_rx) = oneshot::channel::<()>();
        let inner_clone = self.inner.clone();
        let app_for_task = app.clone();
        let tid_for_task = thread_id.clone();

        let waiter = tokio::spawn(async move {
            let root_pid = pid;
            let exit_status = tokio::select! {
                status = async {
                    let status = child.wait().await;
                    // Ren'Py and similar stubs exit immediately after spawning the real game.
                    #[cfg(windows)]
                    {
                        while crate::game_window::process_tree_has_window_surface(root_pid) {
                            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                        }
                    }
                    status
                } => status,
                _ = kill_rx => {
                    let _ = child.kill().await;
                    child.wait().await
                }
            };
            let duration = started.elapsed().as_secs();
            let exit_code = exit_status
                .as_ref()
                .ok()
                .and_then(|s| s.code())
                .unwrap_or(-1);
            let error = exit_status.as_ref().err().map(|e| e.to_string());

            let _ = app_for_task.emit(
                "game:exited",
                json!({
                    "threadId": tid_for_task,
                    "sessionId": session_id,
                    "durationSeconds": duration,
                    "exitCode": exit_code,
                    "error": error,
                }),
            );

            inner_clone.lock().await.remove(&tid_for_task);
        });

        let pid_refresh = tokio::spawn({
            let inner = self.inner.clone();
            let tid = thread_id.clone();
            async move {
                for _ in 0..48 {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    let current = inner.lock().await.get(&tid).map(|r| r.pid);
                    let Some(current_pid) = current else {
                        return;
                    };
                    #[cfg(windows)]
                    {
                        let resolved = crate::game_window::resolve_visible_game_pid(current_pid);
                        if resolved != current_pid {
                            if let Some(rg) = inner.lock().await.get_mut(&tid) {
                                rg.pid = resolved;
                            }
                        }
                        if crate::game_window::game_has_window_surface(resolved) {
                            break;
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = current_pid;
                        break;
                    }
                }
            }
        });

        self.inner.lock().await.insert(
            thread_id.clone(),
            RunningGame {
                pid,
                started,
                kill_tx: Some(kill_tx),
                _waiter: waiter,
                _pid_refresh: pid_refresh,
            },
        );

        // Register running state before emit so overlay hint / anchor can resolve PID immediately.
        let _ = app.emit(
            "game:started",
            json!({
                "threadId": thread_id,
                "sessionId": session_id,
                "pid": pid,
                "exePath": exe_path,
            }),
        );

        #[cfg(windows)]
        crate::commands::overlay::schedule_launch_hint(
            app.clone(),
            thread_id.clone(),
            title.clone(),
            pid,
        );

        Ok(pid)
    }

    pub async fn stop(&self, thread_id: &str) -> Result<(), AppError> {
        let mut map = self.inner.lock().await;
        let Some(rg) = map.get_mut(thread_id) else {
            return Err(AppError::Other(format!(
                "o jogo {thread_id} não está em execução"
            )));
        };
        // Sender is single-use; on a second Stop click it'll be None and we
        // just no-op (the waiter is already shutting down).
        if let Some(tx) = rg.kill_tx.take() {
            let _ = tx.send(());
        }
        Ok(())
    }

    /// PID atual (já re-resolvido pelo pid_refresh) de um jogo em execução.
    pub async fn pid_for(&self, thread_id: &str) -> Option<u32> {
        self.inner.lock().await.get(thread_id).map(|rg| rg.pid)
    }

    pub async fn running(&self) -> Vec<RunningInfo> {
        let map = self.inner.lock().await;
        map.iter()
            .map(|(tid, rg)| RunningInfo {
                thread_id: tid.clone(),
                pid: rg.pid,
                elapsed_seconds: rg.started.elapsed().as_secs(),
            })
            .collect()
    }
}

#[derive(Debug, serde::Serialize)]
pub struct RunningInfo {
    #[serde(rename = "threadId")]
    pub thread_id: String,
    pub pid: u32,
    #[serde(rename = "elapsedSeconds")]
    pub elapsed_seconds: u64,
}
