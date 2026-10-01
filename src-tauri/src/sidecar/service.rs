use crate::bridge::Sidecar;
use crate::error::AppError;
use crate::sidecar::rpc::SidecarClient;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Set while an app update replaces the sidecar's files: no new sidecar
/// may start until the install fails (on success the process exits).
static STARTS_BLOCKED: AtomicBool = AtomicBool::new(false);

pub fn block_starts(blocked: bool) {
    STARTS_BLOCKED.store(blocked, Ordering::SeqCst);
}

pub async fn ensure(
    slot: &Mutex<Option<Arc<SidecarClient>>>,
    session_dir: &Path,
    sidecar_path: PathBuf,
) -> Result<Arc<SidecarClient>, AppError> {
    let mut guard = slot.lock().await;
    if let Some(existing) = guard.as_ref() {
        return Ok(existing.clone());
    }
    // Checked under the lock: a start can't slip in after `kill` emptied it.
    if STARTS_BLOCKED.load(Ordering::SeqCst) {
        return Err(AppError::Other("an app update is being installed".into()));
    }
    let raw = Sidecar::spawn(sidecar_path).await?;
    let session_dir_str = session_dir
        .to_str()
        .ok_or_else(|| AppError::Other("session dir not utf-8".into()))?
        .to_string();
    let client = Arc::new(SidecarClient::new(Arc::new(raw)));
    client.init(&session_dir_str, "default").await?;
    *guard = Some(client.clone());
    Ok(client)
}

pub async fn kill(slot: &Mutex<Option<Arc<SidecarClient>>>) {
    let mut guard = slot.lock().await;
    if let Some(client) = guard.take() {
        client.kill_now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn blocked_starts_fail_without_spawning() {
        let slot = Mutex::new(None);
        block_starts(true);
        // The path does not exist: reaching the spawn would fail differently.
        let result = ensure(&slot, Path::new("."), PathBuf::from("no-such-sidecar")).await;
        block_starts(false);
        match result {
            Err(AppError::Other(msg)) => assert!(msg.contains("app update"), "{msg}"),
            Err(other) => panic!("expected the update block, got {other}"),
            Ok(_) => panic!("expected the update block, got a sidecar"),
        }
        assert!(slot.lock().await.is_none());
    }
}
