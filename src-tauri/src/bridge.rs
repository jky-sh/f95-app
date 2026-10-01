use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;

const RPC_TIMEOUT: Duration = Duration::from_secs(180);
/// For sidecar calls that open a visible browser and wait on the user.
pub(crate) const RPC_TIMEOUT_INTERACTIVE: Duration = Duration::from_secs(360);

#[derive(Debug, Deserialize)]
struct RpcResponse {
    id: u64,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<RpcErrorPayload>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RpcErrorPayload {
    pub code: i32,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

pub struct Sidecar {
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, RpcErrorPayload>>>>>,
    next_id: AtomicU64,
    _child: Mutex<Child>,
}

impl Sidecar {
    pub async fn spawn(sidecar_path: PathBuf) -> Result<Self, AppError> {
        // Dev: spawn `node dist/index.js` — relies on the developer's local
        //      Node install.
        // Prod: spawn `<resources>/sidecar/node.exe bundle.cjs`. We ship the
        //      ORIGINAL Node binary (signed by the Node Foundation) next to
        //      the bundled JS. An earlier version used a Node SEA via
        //      postject, but rewriting node.exe trips Windows Defender's
        //      ML heuristics on end-user machines (`Trojan:Win32/Bearfoos.B!ml`)
        //      because postject corrupts the Authenticode signature. Shipping
        //      both files unmodified avoids that entire class of false
        //      positive — same disk footprint, zero AV friction.
        let mut cmd = if cfg!(debug_assertions) {
            let mut c = Command::new("node");
            c.arg(&sidecar_path);
            configure_sidecar_env(&mut c, &sidecar_path);
            c
        } else {
            // sidecar_path is bundle.cjs; node.exe lives next to it.
            let node_exe = sidecar_path
                .parent()
                .map(|p| {
                    p.join(if cfg!(target_os = "windows") {
                        "node.exe"
                    } else {
                        "node"
                    })
                })
                .ok_or_else(|| AppError::Other("could not resolve bundled node binary".into()))?;
            let mut c = Command::new(node_exe);
            c.arg(&sidecar_path);
            configure_sidecar_env(&mut c, &sidecar_path);
            c
        };
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        // On Windows, child processes inherit a console by default. Without
        // CREATE_NO_WINDOW (0x08000000) the spawned binary pops up a black
        // cmd window every time the app starts — both for `node.exe` (dev)
        // and for the SEA `f95-bridge.exe` (release, since it's a node copy).
        // `tokio::process::Command::creation_flags` forwards to the Win32
        // CreateProcess flag.
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Other("could not capture sidecar stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Other("could not capture sidecar stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Other("could not capture sidecar stderr".into()))?;

        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, RpcErrorPayload>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Reader task: parses JSON lines from sidecar stdout and resolves pending oneshots
        {
            let pending = pending.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let parsed: serde_json::Result<RpcResponse> = serde_json::from_str(&line);
                    match parsed {
                        Ok(resp) => {
                            let mut map = pending.lock().await;
                            if let Some(tx) = map.remove(&resp.id) {
                                let payload = if let Some(err) = resp.error {
                                    Err(err)
                                } else {
                                    Ok(resp.result.unwrap_or(Value::Null))
                                };
                                let _ = tx.send(payload);
                            } else {
                                eprintln!("[sidecar] orphan response id={}", resp.id);
                            }
                        }
                        Err(e) => {
                            eprintln!("[sidecar] bad json line: {} ({})", line, e);
                        }
                    }
                }
                // stdout closed: fail any remaining pending requests
                let mut map = pending.lock().await;
                for (_, tx) in map.drain() {
                    let _ = tx.send(Err(RpcErrorPayload {
                        code: -32099,
                        message: "sidecar stdout closed".into(),
                        data: None,
                    }));
                }
            });
        }

        // Stderr forwarder: surface sidecar logs to host console
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("{}", line);
            }
        });

        Ok(Sidecar {
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
            _child: Mutex::new(child),
        })
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, AppError> {
        self.call_with_timeout(method, params, RPC_TIMEOUT).await
    }

    pub async fn call_with_timeout(
        &self,
        method: &str,
        params: Value,
        rpc_timeout: Duration,
    ) -> Result<Value, AppError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let line = serde_json::to_string(&req)? + "\n";

        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await?;
        }

        match timeout(rpc_timeout, rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(err))) => Err(map_rpc_error(err)),
            Ok(Err(_)) => Err(AppError::SidecarCrash),
            Err(_) => {
                // Clean up pending entry on timeout
                let mut map = self.pending.lock().await;
                map.remove(&id);
                Err(AppError::SidecarTimeout(rpc_timeout.as_secs()))
            }
        }
    }

    /// Synchronously terminate the child process. Safe to call from a Tauri
    /// shutdown handler — uses tokio's `start_kill` which forwards to
    /// `TerminateProcess` (Windows) / `SIGKILL` (Unix) without touching the
    /// async runtime.
    ///
    /// `Command::kill_on_drop(true)` was already set during spawn, but that
    /// path is unreliable in practice: when Tauri's main thread returns, the
    /// tokio runtime tears down before our `AppState` drops, so the
    /// destructor-driven kill never fires. Hooking `RunEvent::Exit` and
    /// calling this method explicitly is the bulletproof fix.
    pub fn kill_now(&self) {
        if let Ok(mut child) = self._child.try_lock() {
            let _ = child.start_kill();
        }
    }
}

/// Point Playwright at bundled Chromium and set cwd so `require('playwright')`
/// resolves from `dist/node_modules` (dev + prod ship the same layout).
fn configure_sidecar_env(cmd: &mut Command, sidecar_path: &std::path::Path) {
    if let Some(sidecar_dir) = sidecar_path.parent() {
        cmd.current_dir(sidecar_dir);
        let browsers = playwright_browsers_path(sidecar_dir);
        if browsers.exists() {
            cmd.env("PLAYWRIGHT_BROWSERS_PATH", browsers);
        }
    }
}

/// In dev, keep Chromium cache outside `src-tauri` so runtime logs don't
/// trigger `tauri dev` rebuilds. Release uses bundled `sidecar/ms-playwright`.
fn playwright_browsers_path(sidecar_dir: &std::path::Path) -> std::path::PathBuf {
    #[cfg(debug_assertions)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from) {
            let dev_cache = local.join("f95-app").join("ms-playwright");
            let bundled = sidecar_dir.join("ms-playwright");
            // Prefer dev cache when populated; fall back to bundled install from postinstall.
            if dev_cache.exists() {
                return dev_cache;
            }
            if bundled.exists() {
                return bundled;
            }
            return dev_cache;
        }
    }
    sidecar_dir.join("ms-playwright")
}

fn map_rpc_error(err: RpcErrorPayload) -> AppError {
    match err.code {
        -32001 => AppError::InvalidCredentials(err.message),
        -32002 => AppError::TwoFactorRequired,
        -32010 => AppError::Cloudflare(err.message),
        // Unmask hitting F95's login page also uses -32003; keep its message
        // so the download says "log in again" instead of "still starting".
        -32003 if err.message.contains("session expired") => {
            AppError::download("session_expired", err.message)
        }
        -32003 => AppError::NotInitialized,
        -32700 | -32600 | -32601 | -32602 => AppError::Protocol(err.message),
        _ => AppError::Other(err.message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(code: i32, message: &str) -> RpcErrorPayload {
        RpcErrorPayload {
            code,
            message: message.into(),
            data: None,
        }
    }

    #[test]
    fn session_expired_keeps_its_message() {
        let e = map_rpc_error(payload(
            -32003,
            "masked URL hit the login page; session expired — please re-login",
        ));
        assert_eq!(e.code(), "session_expired");
        assert!(e.to_string().contains("session expired"));
    }

    #[test]
    fn other_not_initialized_stays_generic() {
        let e = map_rpc_error(payload(-32003, "not logged in"));
        assert!(matches!(e, AppError::NotInitialized));
    }
}
