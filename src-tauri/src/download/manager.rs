//! Background download manager.

use super::host::{
    clean_download_filename, host_label, host_of, is_f95_masked, masked_host,
    needs_verify_window, sanitize_segment,
};
use super::platform::recommended_file_id;
use super::resolvers::uploadnow::{self, UploadnowGuest};
use super::resolvers::{
    akirabox, bowfile, normalize_uploadhaven_url, resolve_akirabox, resolve_bowfile,
    resolve_buzzheavier, resolve_datanodes, resolve_gdrive, resolve_gofile, resolve_mediafire,
    resolve_mixdrop, resolve_mixdrop_interactive, resolve_mixdrop_with_cookies,
    resolve_pixeldrain, resolve_terminal, resolve_uploadhaven, resolve_uploadnow,
    resolve_vikingfile, resolve_workupload, vikingfile,
};
use super::stream::{hash_existing, hash_file, parse_content_range_total, with_part_ext};
use super::types::{ResolveResult, ResolvedFileOption};
use crate::error::AppError;
use crate::sidecar::SidecarClient;
use crate::uploadhaven::UploadHavenSession;
use futures_util::{Stream, StreamExt};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use reqwest::StatusCode;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, RwLock, Semaphore};
use tokio::task::JoinHandle;

/// No bytes for this long means the transfer is stuck. Failing then lets
/// Retry resume from the `.part` file instead of hanging in "downloading".
const STALL_TIMEOUT: Duration = Duration::from_secs(60);

/// `download:error` with the `dl.error.*` code the UI translates, if any.
fn emit_download_error(app: &AppHandle, id: i64, e: &AppError, source_url: Option<&str>) {
    let code = matches!(e, AppError::Download { .. }).then(|| e.code());
    let _ = app.emit(
        "download:error",
        json!({
            "id": id,
            "message": e.to_string(),
            "sourceUrl": source_url,
            "code": code,
        }),
    );
}

fn stalled() -> AppError {
    AppError::download(
        "stalled",
        format!("download stalled: no data for {} s", STALL_TIMEOUT.as_secs()),
    )
}

/// HTTP failures worth explaining to the user.
fn status_error(status: StatusCode) -> AppError {
    let msg = format!("http status: {status}");
    match status.as_u16() {
        403 | 404 | 410 => AppError::download("link_expired", msg),
        429 => AppError::download("rate_limited", msg),
        // BowFile: a free user already has a download running.
        460 => AppError::download("host_busy", msg),
        500..=599 => AppError::download("host_offline", msg),
        _ => AppError::Other(msg),
    }
}

/// Why a link the verification window just captured can't be used, from the
/// probe's reply. `None` when it looks like the file.
fn probe_error(status: StatusCode, html: bool) -> Option<AppError> {
    let msg = format!("http status: {status}");
    match status.as_u16() {
        404 | 410 => Some(AppError::download("file_gone", msg)),
        401 | 403 => Some(AppError::download("link_refused", msg)),
        _ if status.is_success() && html => Some(AppError::download(
            "html_page",
            "download: the host sent a web page instead of the file",
        )),
        _ => None,
    }
}

/// Next body chunk, failing when nothing arrives for `STALL_TIMEOUT`.
async fn next_chunk<S, B>(stream: &mut S) -> Result<Option<B>, AppError>
where
    S: Stream<Item = Result<B, reqwest::Error>> + Unpin,
{
    match tokio::time::timeout(STALL_TIMEOUT, stream.next()).await {
        Err(_) => Err(stalled()),
        Ok(None) => Ok(None),
        Ok(Some(Ok(chunk))) => Ok(Some(chunk)),
        Ok(Some(Err(e))) => Err(AppError::Other(format!("stream chunk: {e}"))),
    }
}

pub struct Manager {
    tasks: Mutex<HashMap<i64, JoinHandle<()>>>,
    base_dir: PathBuf,
    http: reqwest::Client,
    /// User-supplied GoFile credentials. When the token is set, downloads
    /// auth with it instead of minting a guest token. The account id is
    /// optional from the downloader's perspective (the contents endpoint
    /// only needs the bearer token) but lets us hit `/accounts/{id}` for
    /// the "Verificar credenciais" feature in Settings.
    ///
    /// Frontend persists both halves in `app_settings` and pushes them here
    /// at startup + on change.
    gofile_creds: RwLock<Option<GoFileCreds>>,
    /// Optional serialized MEGA session. Public links work without it; a
    /// logged-in session can improve bandwidth limits on the user's account.
    mega_session: RwLock<Option<String>>,
    /// Optional UploadHaven Pro session (Laravel cookies).
    uploadhaven_session: RwLock<Option<UploadHavenSession>>,
    /// Optional BuzzHeavier Account ID (Bearer token for paid / higher limits).
    buzzheavier_account: RwLock<Option<String>>,
    /// Optional DataNodes personal API key. When set, datanodes.to links are
    /// resolved through their JSON API (`/api/file/direct_link`) to a
    /// time-limited CDN URL. Without it we can't resolve headlessly (the public
    /// page is JS + reCAPTCHA), so the download falls back to the browser.
    datanodes_key: RwLock<Option<String>>,
    /// Optional MixDrop API credentials (email + key from mixdrop.ag/api).
    /// Used for fileinfo2 metadata; download still uses Playwright genticket.
    mixdrop_creds: RwLock<Option<MixdropCreds>>,
    /// Multi-file host folders awaiting user selection in the UI.
    pending_file_choices: Mutex<HashMap<i64, PendingFileChoice>>,
    /// BowFile gives a free user one connection per IP (a second one gets
    /// HTTP 460), so its downloads queue on this single permit.
    bowfile_slot: Arc<Semaphore>,
    /// UploadNow guest login (Firebase anonymous), reused across downloads.
    uploadnow_guest: Mutex<Option<UploadnowGuest>>,
}

struct PendingFileChoice {
    host: String,
    thread_id: String,
    dest_root: Option<PathBuf>,
    extra_headers: Vec<(String, String)>,
    files: Vec<ResolvedFileOption>,
}

#[derive(Clone)]
pub struct GoFileCreds {
    pub token: String,
    pub account_id: Option<String>,
}

#[derive(Clone)]
pub struct MixdropCreds {
    pub email: String,
    pub api_key: String,
}

impl Manager {
    pub fn new(base_dir: PathBuf) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .cookie_store(true)
            .connect_timeout(Duration::from_secs(20))
            // No global request timeout: large files legitimately take a long
            // time. Per-chunk progress is enough to know it's alive.
            .build()
            .expect("reqwest client");
        Self {
            tasks: Mutex::new(HashMap::new()),
            base_dir,
            http,
            gofile_creds: RwLock::new(None),
            mega_session: RwLock::new(None),
            uploadhaven_session: RwLock::new(None),
            buzzheavier_account: RwLock::new(None),
            datanodes_key: RwLock::new(None),
            mixdrop_creds: RwLock::new(None),
            pending_file_choices: Mutex::new(HashMap::new()),
            bowfile_slot: Arc::new(Semaphore::new(1)),
            uploadnow_guest: Mutex::new(None),
        }
    }

    /// Ids the manager is still working on (running, or waiting for a file
    /// choice). Rows the UI shows as in progress but missing here were cut
    /// short by an app restart.
    pub async fn active_ids(&self) -> Vec<i64> {
        let mut ids: Vec<i64> = self.tasks.lock().await.keys().copied().collect();
        ids.extend(self.pending_file_choices.lock().await.keys().copied());
        ids.sort_unstable();
        ids.dedup();
        ids
    }

    /// Replace the cached GoFile credentials. Pass `token = None` (or empty)
    /// to forget them - next download falls back to a fresh guest token. The
    /// account id is stored alongside the token but isn't sent with content
    /// requests; it's only used for "Verify credentials".
    pub async fn set_gofile_creds(&self, token: Option<String>, account_id: Option<String>) {
        let token = token
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());
        let account_id = account_id
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());
        *self.gofile_creds.write().await = token.map(|t| GoFileCreds {
            token: t,
            account_id,
        });
    }

    /// HTTP client + creds snapshot for the verify command in `commands.rs`.
    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }
    pub async fn gofile_creds(&self) -> Option<GoFileCreds> {
        self.gofile_creds.read().await.clone()
    }

    /// Replace the cached MEGA session token. Pass `None` or empty to forget it.
    pub async fn set_mega_session(&self, session: Option<String>) {
        let session = session
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        *self.mega_session.write().await = session;
    }

    pub async fn mega_session(&self) -> Option<String> {
        self.mega_session.read().await.clone()
    }

    pub async fn set_uploadhaven_session(&self, session: Option<UploadHavenSession>) {
        *self.uploadhaven_session.write().await = session;
    }

    pub async fn uploadhaven_session(&self) -> Option<UploadHavenSession> {
        self.uploadhaven_session.read().await.clone()
    }

    pub async fn set_buzzheavier_account(&self, account_id: Option<String>) {
        let account_id = account_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        *self.buzzheavier_account.write().await = account_id;
    }

    pub async fn buzzheavier_account(&self) -> Option<String> {
        self.buzzheavier_account.read().await.clone()
    }

    /// Replace the cached DataNodes API key. Pass `None` or empty to forget it
    /// - datanodes links then fall back to opening in the browser.
    pub async fn set_datanodes_key(&self, key: Option<String>) {
        let key = key.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        *self.datanodes_key.write().await = key;
    }

    pub async fn datanodes_key(&self) -> Option<String> {
        self.datanodes_key.read().await.clone()
    }

    pub async fn set_mixdrop_creds(&self, email: Option<String>, api_key: Option<String>) {
        let email = email
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let api_key = api_key
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        *self.mixdrop_creds.write().await = match (email, api_key) {
            (Some(e), Some(k)) => Some(MixdropCreds {
                email: e,
                api_key: k,
            }),
            _ => None,
        };
    }

    pub async fn mixdrop_creds(&self) -> Option<MixdropCreds> {
        self.mixdrop_creds.read().await.clone()
    }

    /// Begin downloading on a background task.
    /// must subscribe to `download:*` events to observe progress.
    ///
    /// `dest_root_override` lets the caller route this download into a
    /// specific install library (e.g. `D:\F95Games`). When `None` the
    /// manager's default root (`<app_local_data>/downloads`) is used - that's
    /// the legacy single-library behavior.
    pub async fn start(
        self: &Arc<Self>,
        app: AppHandle,
        sidecar: Arc<SidecarClient>,
        id: i64,
        source_url: String,
        thread_id: String,
        dest_root_override: Option<PathBuf>,
        platform_group: Option<String>,
    ) -> Result<(), AppError> {
        {
            let g = self.tasks.lock().await;
            if g.contains_key(&id) {
                // Idempotent: already running.
                return Ok(());
            }
        }

        let me = self.clone();
        let app2 = app.clone();
        let source_for_err = source_url.clone();
        let handle = tokio::spawn(async move {
            let result = me
                .run(
                    app2.clone(),
                    sidecar,
                    id,
                    source_url,
                    thread_id,
                    dest_root_override,
                    platform_group,
                )
                .await;
            if let Err(e) = result {
                crate::dev_debug::log_error(
                    Some(&app2),
                    "download",
                    format!("failed id={id} err={e} url={source_for_err}"),
                );
                emit_download_error(&app2, id, &e, Some(&source_for_err));
            }
            me.tasks.lock().await.remove(&id);
        });
        self.tasks.lock().await.insert(id, handle);
        Ok(())
    }

    /// Resume MixDrop via headed Playwright verification (blocks ad popups).
    pub async fn start_with_mixdrop_interactive(
        self: &Arc<Self>,
        app: AppHandle,
        sidecar: Arc<SidecarClient>,
        id: i64,
        source_url: String,
        thread_id: String,
        dest_root_override: Option<PathBuf>,
        page_url: String,
    ) -> Result<(), AppError> {
        {
            let g = self.tasks.lock().await;
            if g.contains_key(&id) {
                return Ok(());
            }
        }

        let me = self.clone();
        let app2 = app.clone();
        let source_for_err = source_url.clone();
        let handle = tokio::spawn(async move {
            let result = me
                .run_with_mixdrop_interactive(
                    app2.clone(),
                    sidecar,
                    id,
                    source_url,
                    thread_id,
                    dest_root_override,
                    page_url,
                )
                .await;
            if let Err(e) = result {
                crate::dev_debug::log_error(
                    Some(&app2),
                    "download",
                    format!("interactive verify failed id={id} err={e} url={source_for_err}"),
                );
                emit_download_error(&app2, id, &e, Some(&source_for_err));
            }
            me.tasks.lock().await.remove(&id);
        });
        self.tasks.lock().await.insert(id, handle);
        Ok(())
    }

    async fn run_with_mixdrop_interactive(
        &self,
        app: AppHandle,
        sidecar: Arc<SidecarClient>,
        id: i64,
        _source_url: String,
        thread_id: String,
        dest_root_override: Option<PathBuf>,
        page_url: String,
    ) -> Result<(), AppError> {
        let _ = app.emit("download:resolving", json!({ "id": id }));

        let creds = self.mixdrop_creds.read().await.clone();
        let resolved = resolve_mixdrop_interactive(
            &sidecar,
            &app,
            &page_url,
            "mixdrop",
            creds.as_ref().map(|c| c.email.as_str()),
            creds.as_ref().map(|c| c.api_key.as_str()),
        )
        .await?;

        match resolved {
            ResolveResult::Direct {
                url: direct_url,
                file_name,
                file_size,
                expected_sha256,
                extra_headers,
            } => {
                let root = dest_root_override.as_deref().unwrap_or(&self.base_dir);
                let dest_dir = root.join(sanitize_segment(&thread_id));
                fs::create_dir_all(&dest_dir).await?;
                let safe_name = sanitize_segment(&clean_download_filename(&file_name));
                let dest_path = dest_dir.join(&safe_name);
                let part_path = with_part_ext(&dest_path);

                let _ = app.emit(
                    "download:resolved",
                    json!({
                        "id": id,
                        "fileName": safe_name,
                        "fileSize": file_size,
                        "directUrl": direct_url,
                        "destPath": dest_path.to_string_lossy(),
                        "expectedSha256": expected_sha256,
                    }),
                );

                if dest_path.exists() && !part_path.exists() {
                    let meta = fs::metadata(&dest_path).await?;
                    let _ = app.emit(
                        "download:done",
                        json!({
                            "id": id,
                            "bytes": meta.len(),
                            "filePath": dest_path.to_string_lossy(),
                        }),
                    );
                    return Ok(());
                }

                self.stream_to_part(
                    &app,
                    id,
                    &direct_url,
                    &part_path,
                    &dest_path,
                    file_size,
                    expected_sha256.as_deref(),
                    &extra_headers,
                )
                .await?;
                Ok(())
            }
            ResolveResult::NeedsBrowser { url, host } => {
                let _ = app.emit(
                    "download:needs-browser",
                    json!({
                        "id": id,
                        "url": url,
                        "host": host,
                        "captcha": true,
                    }),
                );
                Ok(())
            }
            ResolveResult::ChooseFile { .. } => Err(AppError::Other(
                "mixdrop: pasta com vários arquivos não suportada".into(),
            )),
        }
    }

    /// Resume a MixDrop download using cookies from the in-app captcha window.
    pub async fn start_with_mixdrop_session(
        self: &Arc<Self>,
        app: AppHandle,
        sidecar: Arc<SidecarClient>,
        id: i64,
        source_url: String,
        thread_id: String,
        dest_root_override: Option<PathBuf>,
        page_url: String,
        cookie_header: String,
    ) -> Result<(), AppError> {
        {
            let g = self.tasks.lock().await;
            if g.contains_key(&id) {
                return Ok(());
            }
        }

        let me = self.clone();
        let app2 = app.clone();
        let source_for_err = source_url.clone();
        let handle = tokio::spawn(async move {
            let result = me
                .run_with_mixdrop_session(
                    app2.clone(),
                    sidecar,
                    id,
                    source_url,
                    thread_id,
                    dest_root_override,
                    page_url,
                    cookie_header,
                )
                .await;
            if let Err(e) = result {
                crate::dev_debug::log_error(
                    Some(&app2),
                    "download",
                    format!("captcha continue failed id={id} err={e} url={source_for_err}"),
                );
                emit_download_error(&app2, id, &e, Some(&source_for_err));
            }
            me.tasks.lock().await.remove(&id);
        });
        self.tasks.lock().await.insert(id, handle);
        Ok(())
    }

    async fn run_with_mixdrop_session(
        &self,
        app: AppHandle,
        sidecar: Arc<SidecarClient>,
        id: i64,
        _source_url: String,
        thread_id: String,
        dest_root_override: Option<PathBuf>,
        page_url: String,
        cookie_header: String,
    ) -> Result<(), AppError> {
        let _ = app.emit("download:resolving", json!({ "id": id }));

        let creds = self.mixdrop_creds.read().await.clone();
        let resolved = resolve_mixdrop_with_cookies(
            &sidecar,
            &app,
            &page_url,
            "mixdrop",
            &cookie_header,
            creds.as_ref().map(|c| c.email.as_str()),
            creds.as_ref().map(|c| c.api_key.as_str()),
        )
        .await?;

        match resolved {
            ResolveResult::Direct {
                url: direct_url,
                file_name,
                file_size,
                expected_sha256,
                extra_headers,
            } => {
                let root = dest_root_override.as_deref().unwrap_or(&self.base_dir);
                let dest_dir = root.join(sanitize_segment(&thread_id));
                fs::create_dir_all(&dest_dir).await?;
                let safe_name = sanitize_segment(&clean_download_filename(&file_name));
                let dest_path = dest_dir.join(&safe_name);
                let part_path = with_part_ext(&dest_path);

                let _ = app.emit(
                    "download:resolved",
                    json!({
                        "id": id,
                        "fileName": safe_name,
                        "fileSize": file_size,
                        "directUrl": direct_url,
                        "destPath": dest_path.to_string_lossy(),
                        "expectedSha256": expected_sha256,
                    }),
                );

                if dest_path.exists() && !part_path.exists() {
                    let meta = fs::metadata(&dest_path).await?;
                    let _ = app.emit(
                        "download:done",
                        json!({
                            "id": id,
                            "bytes": meta.len(),
                            "filePath": dest_path.to_string_lossy(),
                        }),
                    );
                    return Ok(());
                }

                self.stream_to_part(
                    &app,
                    id,
                    &direct_url,
                    &part_path,
                    &dest_path,
                    file_size,
                    expected_sha256.as_deref(),
                    &extra_headers,
                )
                .await?;
                Ok(())
            }
            ResolveResult::NeedsBrowser { url, host } => {
                let _ = app.emit(
                    "download:needs-browser",
                    json!({
                        "id": id,
                        "url": url,
                        "host": host,
                        "captcha": true,
                    }),
                );
                Ok(())
            }
            ResolveResult::ChooseFile { .. } => Err(AppError::Other(
                "mixdrop: pasta com vários arquivos não suportada".into(),
            )),
        }
    }

    /// Download a link the verification window captured (VikingFile,
    /// AkiraBox). The link is checked first: one the host already refuses
    /// fails with a coded error (Retry runs the check again) instead of
    /// reopening the window in a loop.
    #[allow(clippy::too_many_arguments)]
    pub async fn start_verified(
        self: &Arc<Self>,
        app: AppHandle,
        id: i64,
        source_url: String,
        host: String,
        page_url: String,
        link: String,
        thread_id: String,
        dest_root_override: Option<PathBuf>,
    ) -> Result<(), AppError> {
        {
            let g = self.tasks.lock().await;
            if g.contains_key(&id) {
                return Ok(());
            }
        }
        let me = self.clone();
        let app2 = app.clone();
        let handle = tokio::spawn(async move {
            let result = me
                .run_verified(
                    &app2,
                    id,
                    &host,
                    &page_url,
                    &link,
                    &thread_id,
                    dest_root_override.as_deref(),
                )
                .await;
            if let Err(e) = result {
                crate::dev_debug::log_error(
                    Some(&app2),
                    "download",
                    format!("verified download failed id={id} host={host} err={e}"),
                );
                emit_download_error(&app2, id, &e, Some(&source_url));
            }
            me.tasks.lock().await.remove(&id);
        });
        self.tasks.lock().await.insert(id, handle);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_verified(
        &self,
        app: &AppHandle,
        id: i64,
        host: &str,
        page_url: &str,
        link: &str,
        thread_id: &str,
        dest_root_override: Option<&Path>,
    ) -> Result<(), AppError> {
        let _ = app.emit("download:resolving", json!({ "id": id }));
        let resolved = match host {
            "vikingfile" => vikingfile::direct_from_verified(&self.http, page_url, link).await?,
            "akirabox" => akirabox::direct_from_verified(&self.http, page_url, link).await?,
            other => {
                return Err(AppError::Other(format!(
                    "verification window: unsupported host {other}"
                )))
            }
        };
        let ResolveResult::Direct {
            url,
            file_name,
            file_size,
            expected_sha256,
            extra_headers,
        } = resolved
        else {
            return Err(AppError::Other("verification window: no download link".into()));
        };
        crate::dev_debug::log(
            Some(app),
            host,
            format!("verified link → {file_name} ({url})"),
        );

        let mut url = url;
        if let Some(err) = self.probe_link(&url, &extra_headers).await {
            // akirabox.to may wall the link behind a Cloudflare check; the
            // same path on akirabox.com does not.
            match akirabox::alternate_link(&url) {
                Some(alt) if self.probe_link(&alt, &extra_headers).await.is_none() => url = alt,
                // The link is seconds old, so this is not expiry: the host
                // refuses this client or its storage is failing. Sending the
                // row back to the window would only loop, so fail and let
                // Retry start over.
                _ => return Err(err),
            }
        }

        self.begin_direct_stream(
            app,
            id,
            thread_id,
            dest_root_override,
            &url,
            &file_name,
            file_size,
            expected_sha256.as_deref(),
            &extra_headers,
        )
        .await
    }

    /// One-byte GET (HEAD fails on signed R2 URLs). The error to report when
    /// the link is refused, gone or answers with a web page; `None` when it
    /// looks like the file.
    async fn probe_link(&self, url: &str, extra_headers: &[(String, String)]) -> Option<AppError> {
        let mut req = self.http.get(url).header(RANGE, "bytes=0-0");
        for (k, v) in extra_headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let Ok(Ok(resp)) = tokio::time::timeout(STALL_TIMEOUT, req.send()).await else {
            // Network trouble is not a dead link; let the download report it.
            return None;
        };
        let status = resp.status();
        let html = resp
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|t| t.to_ascii_lowercase().contains("text/html"));
        probe_error(status, html)
    }

    /// Resume after the user picks one file from a multi-build folder.
    pub async fn continue_with_file_choice(
        self: &Arc<Self>,
        app: AppHandle,
        id: i64,
        choice_id: String,
        thread_id: String,
        dest_root_override: Option<PathBuf>,
    ) -> Result<(), AppError> {
        {
            let g = self.tasks.lock().await;
            if g.contains_key(&id) {
                return Ok(());
            }
        }

        let pending = self
            .pending_file_choices
            .lock()
            .await
            .remove(&id)
            .ok_or_else(|| {
                AppError::Other(
                    "escolha de arquivo expirou — clique em Tentar de novo no download".into(),
                )
            })?;

        let picked = pending
            .files
            .iter()
            .find(|f| f.id == choice_id)
            .ok_or_else(|| AppError::Other("arquivo selecionado não encontrado".into()))?;

        let me = self.clone();
        let app2 = app.clone();
        let direct_url = picked.direct_url.clone();
        let file_name = picked.file_name.clone();
        let file_size = picked.file_size;
        let extra_headers = pending.extra_headers;
        let host = pending.host;
        let thread = if thread_id.is_empty() {
            pending.thread_id
        } else {
            thread_id
        };
        let dest_root = dest_root_override.or(pending.dest_root);

        let handle = tokio::spawn(async move {
            let result = async {
                // The file is chosen: leave "Choose file" before a possibly
                // long wait for the host's single download slot.
                let _ = app2.emit("download:resolving", json!({ "id": id }));
                let _slot = me.host_slot(&host).await;
                // UploadNow links are minted only for the file actually taken.
                let direct_url = if direct_url.starts_with(uploadnow::SENTINEL_PREFIX) {
                    uploadnow::mint_link(&me.http, &me.uploadnow_guest, &direct_url).await?
                } else {
                    direct_url
                };
                me.begin_direct_stream(
                    &app2,
                    id,
                    &thread,
                    dest_root.as_deref(),
                    &direct_url,
                    &file_name,
                    file_size,
                    None,
                    &extra_headers,
                )
                .await
            }
            .await;
            if let Err(e) = result {
                crate::dev_debug::log_error(
                    Some(&app2),
                    "download",
                    format!("choice continue failed id={id} err={e}"),
                );
                emit_download_error(&app2, id, &e, None);
            }
            me.tasks.lock().await.remove(&id);
        });
        self.tasks.lock().await.insert(id, handle);
        Ok(())
    }

    /// Hosts that allow one download at a time wait here for their turn.
    async fn host_slot(&self, label: &str) -> Option<tokio::sync::OwnedSemaphorePermit> {
        if label == "bowfile" {
            self.bowfile_slot.clone().acquire_owned().await.ok()
        } else {
            None
        }
    }

    async fn run(
        &self,
        app: AppHandle,
        sidecar: Arc<SidecarClient>,
        id: i64,
        source_url: String,
        thread_id: String,
        dest_root_override: Option<PathBuf>,
        platform_group: Option<String>,
    ) -> Result<(), AppError> {
        let _ = app.emit("download:resolving", json!({ "id": id }));

        // Step 1: unmask F95 → real host URL. If F95 demands a reCAPTCHA we
        // can't solve it headlessly, so we surface as needs-browser with the
        // masked URL itself (the user lands on the F95 interstitial, solves
        // the captcha, and continues to the host).
        let target_url = if is_f95_masked(&source_url) {
            match sidecar.unmask_url(&source_url).await {
                Ok(res) => {
                    let unmasked = res.url;
                    crate::dev_debug::log(Some(&app), "unmask", format!("ok → {unmasked}"));
                    unmasked
                }
                Err(AppError::Cloudflare(_)) => {
                    let host = masked_host(&source_url)
                        .map(|h| host_label(&h))
                        .unwrap_or_else(|| "f95-masked".into());
                    let _ = app.emit(
                        "download:needs-browser",
                        json!({
                            "id": id,
                            "url": source_url,
                            "host": host,
                        }),
                    );
                    return Ok(());
                }
                Err(e) => return Err(e),
            }
        } else {
            source_url.clone()
        };

        // MEGA uses E2E encryption - handled by the mega crate, not HTTP streaming.
        let label = host_label(&host_of(&target_url));
        if label == "mega" {
            return self
                .run_mega(
                    &app,
                    id,
                    &target_url,
                    &thread_id,
                    dest_root_override.as_deref(),
                )
                .await;
        }

        // Held through resolve and stream for one-at-a-time hosts.
        let _slot = self.host_slot(&label).await;

        // Step 2: classify + resolve.
        crate::dev_debug::log(
            Some(&app),
            "download",
            format!("resolve start id={id} url={target_url}"),
        );
        let resolved = self
            .resolve(&app, &sidecar, &target_url, platform_group)
            .await?;
        match resolved {
            ResolveResult::Direct {
                url: direct_url,
                file_name,
                file_size,
                expected_sha256,
                extra_headers,
            } => {
                self.begin_direct_stream(
                    &app,
                    id,
                    &thread_id,
                    dest_root_override.as_deref(),
                    &direct_url,
                    &file_name,
                    file_size,
                    expected_sha256.as_deref(),
                    &extra_headers,
                )
                .await
            }
            ResolveResult::ChooseFile {
                host,
                source_url: folder_url,
                platform_group: group_label,
                files,
                extra_headers,
            } => {
                self.pending_file_choices.lock().await.insert(
                    id,
                    PendingFileChoice {
                        host: host.clone(),
                        thread_id: thread_id.clone(),
                        dest_root: dest_root_override.clone(),
                        extra_headers,
                        files: files.clone(),
                    },
                );
                let choices: Vec<_> = files
                    .iter()
                    .map(|f| {
                        json!({
                            "id": f.id,
                            "fileName": f.file_name,
                            "fileSize": f.file_size,
                            "platformLabel": f.platform_label,
                        })
                    })
                    .collect();
                let library_path = dest_root_override
                    .as_ref()
                    .map(|p| p.to_string_lossy().into_owned());
                let recommended_file_id = recommended_file_id(&files, group_label.as_deref());
                let _ = app.emit(
                    "download:needs-choice",
                    json!({
                        "id": id,
                        "threadId": thread_id,
                        "libraryPath": library_path,
                        "host": host,
                        "sourceUrl": folder_url,
                        "platformGroup": group_label,
                        "recommendedFileId": recommended_file_id,
                        "files": choices,
                    }),
                );
                Ok(())
            }
            ResolveResult::NeedsBrowser { url, host } => {
                // Only a link the window can open (a folder or an odd URL
                // shape goes to the browser instead).
                let captcha = needs_verify_window(&host)
                    && (host == "mixdrop" || super::verify::page_url(&host, &url).is_some());
                let _ = app.emit(
                    "download:needs-browser",
                    json!({
                        "id": id,
                        "url": url,
                        "host": host,
                        "captcha": captcha,
                    }),
                );
                Ok(())
            }
        }
    }

    async fn begin_direct_stream(
        &self,
        app: &AppHandle,
        id: i64,
        thread_id: &str,
        dest_root_override: Option<&Path>,
        direct_url: &str,
        file_name: &str,
        file_size: Option<u64>,
        expected_sha256: Option<&str>,
        extra_headers: &[(String, String)],
    ) -> Result<(), AppError> {
        let root = dest_root_override.unwrap_or(&self.base_dir);
        let dest_dir = root.join(sanitize_segment(thread_id));
        fs::create_dir_all(&dest_dir).await?;
        let safe_name = sanitize_segment(&clean_download_filename(file_name));
        let dest_path = dest_dir.join(&safe_name);
        let part_path = with_part_ext(&dest_path);

        let _ = app.emit(
            "download:resolved",
            json!({
                "id": id,
                "fileName": safe_name,
                "fileSize": file_size,
                "directUrl": direct_url,
                "destPath": dest_path.to_string_lossy(),
                "expectedSha256": expected_sha256,
            }),
        );

        if dest_path.exists() && !part_path.exists() {
            let meta = fs::metadata(&dest_path).await?;
            let _ = app.emit(
                "download:done",
                json!({
                    "id": id,
                    "bytes": meta.len(),
                    "filePath": dest_path.to_string_lossy(),
                }),
            );
            return Ok(());
        }

        self.stream_to_part(
            app,
            id,
            direct_url,
            &part_path,
            &dest_path,
            file_size,
            expected_sha256,
            extra_headers,
        )
        .await
    }

    /// Drive a single GET, streaming to `<dest>.part`, supporting resume and
    /// optional SHA-256 verification. Renames `.part` → `dest` on success.
    #[allow(clippy::too_many_arguments)]
    async fn stream_to_part(
        &self,
        app: &AppHandle,
        id: i64,
        direct_url: &str,
        part_path: &Path,
        dest_path: &Path,
        hint_total: Option<u64>,
        expected_sha256: Option<&str>,
        extra_headers: &[(String, String)],
    ) -> Result<(), AppError> {
        // How many bytes do we already have on disk?
        let existing: u64 = match fs::metadata(part_path).await {
            Ok(m) => m.len(),
            Err(_) => 0,
        };

        // Build the GET. If we have a partial file, ask for the remainder.
        let mut req = self.http.get(direct_url);
        let mut header_map = HeaderMap::new();
        for (k, v) in extra_headers {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::try_from(k.as_str()),
                HeaderValue::from_str(v),
            ) {
                header_map.insert(name, val);
            }
        }
        if existing > 0 {
            if let Ok(v) = HeaderValue::from_str(&format!("bytes={}-", existing)) {
                header_map.insert(RANGE, v);
            }
        }
        req = req.headers(header_map);

        let response = tokio::time::timeout(STALL_TIMEOUT, req.send())
            .await
            .map_err(|_| stalled())?
            .map_err(|e| AppError::Other(format!("http get: {e}")))?;
        let status = response.status();

        // BowFile sends expired or refused tokens to its error page.
        if let Some(e) = bowfile::error_from_final_url(response.url()) {
            return Err(e);
        }

        // 416 = the byte range we asked for is past the end. Usually means the
        // file is already complete on disk.
        if status == StatusCode::RANGE_NOT_SATISFIABLE {
            return self
                .finalize_part(app, id, part_path, dest_path, expected_sha256, existing)
                .await;
        }

        // Anything other than 200 or 206 is fatal.
        if !status.is_success() {
            return Err(status_error(status));
        }

        let html_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|t| t.to_ascii_lowercase().contains("text/html"));

        // Decide whether we're resuming (206) or starting over (200, possibly
        // because the host doesn't honor Range).
        let resuming = status == StatusCode::PARTIAL_CONTENT && existing > 0;
        let mut downloaded: u64 = if resuming { existing } else { 0 };

        // Total bytes: prefer Content-Range "bytes start-end/total", fall back
        // to Content-Length + offset, then to the hint from the resolver.
        let total = parse_content_range_total(response.headers().get(CONTENT_RANGE))
            .or_else(|| {
                response
                    .content_length()
                    .map(|c| if resuming { c + existing } else { c })
            })
            .or(hint_total);

        // Look at the first bytes before touching the `.part`: a web page in
        // place of the file must not replace what is already on disk.
        let mut stream = response.bytes_stream();
        let mut pending = next_chunk(&mut stream).await?;
        if let Some(chunk) = pending.as_ref() {
            if (!resuming || html_type) && crate::gdrive::looks_like_html_bytes(chunk) {
                return Err(AppError::download(
                    "html_page",
                    "download: the host sent a web page instead of the file",
                ));
            }
        }

        // Hasher state. If resuming and we know an expected hash, we have to
        // rehash the bytes we already have on disk so the final digest covers
        // the full file. Skip if no hash to verify against.
        let mut hasher: Option<Sha256> = if expected_sha256.is_some() {
            Some(Sha256::new())
        } else {
            None
        };
        if resuming {
            if let Some(h) = hasher.as_mut() {
                hash_existing(part_path, h).await?;
            }
        } else {
            // Server ignored Range or we have no part - truncate.
            if part_path.exists() {
                let _ = fs::remove_file(part_path).await;
            }
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(resuming)
            .write(true)
            .truncate(!resuming)
            .open(part_path)
            .await?;

        let mut last_emit = Instant::now();
        let mut last_bytes: u64 = downloaded;
        loop {
            let chunk = match pending.take() {
                Some(c) => c,
                None => match next_chunk(&mut stream).await? {
                    Some(c) => c,
                    None => break,
                },
            };
            file.write_all(&chunk).await?;
            if let Some(h) = hasher.as_mut() {
                h.update(&chunk);
            }
            downloaded += chunk.len() as u64;
            if last_emit.elapsed() >= Duration::from_millis(250) {
                let elapsed = last_emit.elapsed().as_secs_f64().max(0.001);
                let speed = ((downloaded - last_bytes) as f64 / elapsed) as u64;
                let _ = app.emit(
                    "download:progress",
                    json!({
                        "id": id,
                        "bytes": downloaded,
                        "total": total,
                        "speedBps": speed,
                    }),
                );
                last_emit = Instant::now();
                last_bytes = downloaded;
            }
        }
        file.flush().await?;
        drop(file);

        self.finalize_part(app, id, part_path, dest_path, expected_sha256, downloaded)
            .await
    }

    /// Verify hash (if known), rename .part → final name, emit `download:done`.
    async fn finalize_part(
        &self,
        app: &AppHandle,
        id: i64,
        part_path: &Path,
        dest_path: &Path,
        expected_sha256: Option<&str>,
        downloaded: u64,
    ) -> Result<(), AppError> {
        if let Some(expected) = expected_sha256 {
            let actual = hash_file(part_path).await?;
            let exp_norm = expected.trim().to_lowercase();
            if exp_norm != actual {
                let _ = fs::remove_file(part_path).await;
                return Err(AppError::Other(format!(
                    "SHA-256 mismatch - esperado {exp_norm}, obtido {actual}. \
                     Arquivo descartado."
                )));
            }
        }
        // Atomic-ish rename (same directory, same FS).
        if dest_path.exists() {
            let _ = fs::remove_file(dest_path).await;
        }
        fs::rename(part_path, dest_path).await?;
        crate::dev_debug::log(
            Some(app),
            "download",
            format!(
                "done id={id} bytes={downloaded} file={}",
                dest_path.display()
            ),
        );
        let _ = app.emit(
            "download:done",
            json!({
                "id": id,
                "bytes": downloaded,
                "filePath": dest_path.to_string_lossy(),
            }),
        );
        Ok(())
    }

    /// Abort a running task. No-op if the id isn't tracked. Partial files are
    /// left in place; a retry on the same id resumes via `.part`.
    pub async fn cancel(&self, id: i64) {
        if let Some(h) = self.tasks.lock().await.remove(&id) {
            h.abort();
        }
        self.pending_file_choices.lock().await.remove(&id);
    }

    async fn run_mega(
        &self,
        app: &AppHandle,
        id: i64,
        url: &str,
        thread_id: &str,
        dest_root_override: Option<&Path>,
    ) -> Result<(), AppError> {
        if crate::mega::is_protected_link(url) {
            let _ = app.emit(
                "download:needs-browser",
                json!({ "id": id, "url": url, "host": "mega" }),
            );
            return Ok(());
        }

        let url = crate::mega::normalize_mega_public_url(url)?;
        let session = self.mega_session.read().await.clone();
        let mut client = crate::mega::build_client(session.as_deref()).await?;
        let (nodes, info) = crate::mega::inspect_public_link(&mut client, &url).await?;

        let root = dest_root_override.unwrap_or(&self.base_dir);
        let dest_dir = root.join(sanitize_segment(thread_id));
        fs::create_dir_all(&dest_dir).await?;

        let _ = info.file_count;
        let sample_dest = dest_dir.join(sanitize_segment(&info.primary_name));
        let _ = app.emit(
            "download:resolved",
            json!({
                "id": id,
                "fileName": info.primary_name,
                "fileSize": info.total_size,
                "directUrl": &url,
                "destPath": sample_dest.to_string_lossy(),
            }),
        );

        let paths =
            crate::mega::download_all_files(&client, &nodes, &dest_dir, app, id, info.total_size)
                .await?;

        let last_path = paths.last().cloned().unwrap_or_else(|| dest_dir.clone());
        let file_paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();

        let _ = app.emit(
            "download:done",
            json!({
                "id": id,
                "bytes": info.total_size,
                "filePath": last_path.to_string_lossy(),
                "filePaths": file_paths,
            }),
        );
        Ok(())
    }
}
impl Manager {
    async fn resolve(
        &self,
        app: &AppHandle,
        sidecar: &SidecarClient,
        url: &str,
        platform_group: Option<String>,
    ) -> Result<ResolveResult, AppError> {
        let host = host_of(url);
        let label = host_label(&host);
        crate::dev_debug::log(
            Some(app),
            "download",
            format!("resolve host={label} domain={host}"),
        );
        match label.as_str() {
            "pixeldrain" => resolve_pixeldrain(&self.http, url, &label).await,
            "mediafire" => resolve_mediafire(&self.http, url, &label).await,
            "gofile" => {
                let user_token = self
                    .gofile_creds
                    .read()
                    .await
                    .as_ref()
                    .map(|c| c.token.clone());
                resolve_gofile(
                    &self.http,
                    sidecar,
                    app,
                    url,
                    &label,
                    user_token.as_deref(),
                    platform_group,
                )
                .await
            }
            "buzzheavier" => {
                let account_id = self.buzzheavier_account.read().await.clone();
                resolve_buzzheavier(sidecar, app, url, &label, account_id.as_deref()).await
            }
            "datanodes" => {
                let key = self.datanodes_key.read().await.clone();
                resolve_datanodes(sidecar, &self.http, app, url, &label, key.as_deref()).await
            }
            "uploadhaven" => {
                let mut session = self.uploadhaven_session.read().await.clone();
                let page_url = normalize_uploadhaven_url(url);
                if let Some(ref mut s) = session {
                    match crate::uploadhaven::refresh_session_on_page(s, &page_url).await {
                        Ok(is_pro) => {
                            crate::dev_debug::log(
                                Some(app),
                                "uploadhaven",
                                format!(
                                    "session refresh ok is_pro={is_pro} has_cookie={}",
                                    crate::uploadhaven::has_session_cookie(&s.cookie_header)
                                ),
                            );
                        }
                        Err(e) => {
                            crate::dev_debug::log_warn(
                                Some(app),
                                "uploadhaven",
                                format!("session refresh failed: {e}"),
                            );
                        }
                    }
                }
                let result =
                    resolve_uploadhaven(&self.http, app, url, &label, &mut session).await?;
                if let Some(ref s) = session {
                    self.set_uploadhaven_session(session.clone()).await;
                    let _ = app.emit(
                        "uploadhaven:session-updated",
                        json!({
                            "cookieHeader": s.cookie_header,
                            "isPro": s.is_pro,
                        }),
                    );
                }
                Ok(result)
            }
            "gdrive" => resolve_gdrive(sidecar, &self.http, app, url, &label).await,
            "workupload" => resolve_workupload(sidecar, app, url, &label).await,
            "mixdrop" => {
                let creds = self.mixdrop_creds.read().await.clone();
                resolve_mixdrop(
                    sidecar,
                    app,
                    url,
                    &label,
                    creds.as_ref().map(|c| c.email.as_str()),
                    creds.as_ref().map(|c| c.api_key.as_str()),
                )
                .await
            }
            "vikingfile" => resolve_vikingfile(&self.http, url, &label).await,
            "akirabox" => resolve_akirabox(&self.http, url, &label).await,
            "terminal" => resolve_terminal(&self.http, url, &label).await,
            "bowfile" => resolve_bowfile(url, &label, platform_group).await,
            "uploadnow" => {
                resolve_uploadnow(&self.http, &self.uploadnow_guest, url, &label, platform_group)
                    .await
            }
            _ => Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(status: u16, html: bool) -> Option<&'static str> {
        probe_error(StatusCode::from_u16(status).unwrap(), html).map(|e| e.code())
    }

    #[test]
    fn probe_maps_a_dead_verified_link_to_a_final_error() {
        assert_eq!(code(206, false), None);
        assert_eq!(code(200, false), None);
        // A redirect the client did not follow, or a server hiccup, is left
        // for the download itself to report.
        assert_eq!(code(302, false), None);
        assert_eq!(code(503, true), None);
        assert_eq!(code(404, false), Some("file_gone"));
        assert_eq!(code(410, true), Some("file_gone"));
        assert_eq!(code(403, true), Some("link_refused"));
        assert_eq!(code(401, false), Some("link_refused"));
        assert_eq!(code(200, true), Some("html_page"));
    }
}
