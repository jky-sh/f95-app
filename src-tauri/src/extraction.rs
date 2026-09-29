//! Archive extraction + main-executable heuristic.
//!
//! `.7z` prefere o binário nativo do 7-Zip quando instalado — multithread e
//! cobre todos os codecs/filtros (BCJ2, ARM64…) que decodificadores puros em
//! Rust não têm; sem ele, cai na `sevenz-rust2`. `.zip` usa a crate `zip` e
//! `.rar` o engine oficial do UnRAR. After extracting, walk the destination
//! tree and pick the most likely game executable using a small scoring
//! function (filename match, depth, block patterns for installers/redists).

use crate::error::AppError;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

/// Callback de progresso da extração: recebe o percentual (0–100).
pub type ProgressFn<'a> = &'a mut dyn FnMut(u8);

/// Extract `archive` into `dest`. The dest directory is created if missing.
/// Existing files inside it are overwritten. Returns the dest path on success.
pub fn extract(archive: &Path, dest: &Path, progress: ProgressFn) -> Result<(), AppError> {
    let ext = archive
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    preflight_disk_space(archive, dest, &ext)?;
    match ext.as_str() {
        "zip" => extract_zip(archive, dest, progress),
        "7z" => extract_7z(archive, dest, progress),
        "rar" => extract_rar(archive, dest, progress),
        other => Err(AppError::Other(format!("formato não suportado: .{other}"))),
    }
}

fn percent(done: u64, total: u64) -> u8 {
    (done.saturating_mul(100) / total.max(1)).min(100) as u8
}

/// Margem além do tamanho estimado (metadados de FS, arredondamento de cluster).
const DISK_SPACE_MARGIN: u64 = 256 * 1024 * 1024;

/// Falha ANTES de extrair quando o disco de destino claramente não comporta o
/// conteúdo. Estourar espaço no meio da extração aparecia como um críptico
/// "rar extract: Could not create file" — comum aqui porque a extração ocorre
/// ao lado do arquivo baixado, muitas vezes no C: quase cheio.
fn preflight_disk_space(archive: &Path, dest: &Path, ext: &str) -> Result<(), AppError> {
    let needed = estimated_unpacked_size(archive, ext).unwrap_or_else(|| {
        // Sem metadados legíveis: estimativa conservadora de 2× o arquivo
        // (jogos são pesados em mídia e comprimem pouco).
        fs::metadata(archive).map(|m| m.len().saturating_mul(2)).unwrap_or(0)
    });
    if needed == 0 {
        return Ok(());
    }
    // dest ainda não existe na primeira extração; mede no ancestral existente.
    let probe = if dest.exists() {
        dest
    } else {
        dest.parent().unwrap_or(dest)
    };
    let Ok(free) = fs4::available_space(probe) else {
        return Ok(()); // sem leitura de espaço, deixa a extração tentar
    };
    let needed_total = needed.saturating_add(DISK_SPACE_MARGIN);
    if free < needed_total {
        return Err(AppError::Other(format!(
            "Espaço em disco insuficiente para extrair: o conteúdo precisa de ~{} e o destino ({}) tem só {} livres. Libere espaço ou adicione uma biblioteca de instalação em outro disco (Configurações → Armazenamento).",
            fmt_bytes(needed_total),
            probe.display(),
            fmt_bytes(free)
        )));
    }
    Ok(())
}

/// Soma dos tamanhos descomprimidos lendo só os metadados (zip: central
/// directory; rar: listagem de headers; 7z: header do arquivo). Também serve
/// de denominador para o percentual de progresso.
fn estimated_unpacked_size(archive: &Path, ext: &str) -> Option<u64> {
    match ext {
        "zip" => {
            let f = fs::File::open(archive).ok()?;
            let mut z = zip::ZipArchive::new(f).ok()?;
            let mut total = 0u64;
            for i in 0..z.len() {
                if let Ok(entry) = z.by_index_raw(i) {
                    total = total.saturating_add(entry.size());
                }
            }
            Some(total)
        }
        "rar" => {
            let open = unrar::Archive::new(archive).open_for_listing().ok()?;
            let mut total = 0u64;
            for header in open.flatten() {
                total = total.saturating_add(header.unpacked_size);
            }
            Some(total)
        }
        "7z" => {
            let meta = sevenz_rust2::Archive::open(archive).ok()?;
            let mut total = 0u64;
            for entry in &meta.files {
                if !entry.is_directory() {
                    total = total.saturating_add(entry.size());
                }
            }
            Some(total)
        }
        _ => None,
    }
}

fn fmt_bytes(bytes: u64) -> String {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else {
        format!("{:.0} MB", b / MB)
    }
}

fn extract_zip(archive: &Path, dest: &Path, progress: ProgressFn) -> Result<(), AppError> {
    let f = fs::File::open(archive).map_err(io_err)?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| AppError::Other(format!("zip open: {e}")))?;
    fs::create_dir_all(dest).map_err(io_err)?;
    let mut total = 0u64;
    for i in 0..z.len() {
        if let Ok(entry) = z.by_index_raw(i) {
            total = total.saturating_add(entry.size());
        }
    }
    let mut done = 0u64;
    for i in 0..z.len() {
        let mut entry = z
            .by_index(i)
            .map_err(|e| AppError::Other(format!("zip entry {i}: {e}")))?;
        // enclosed_name strips absolute paths and "../" segments - defense
        // against zip-slip.
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        let out = dest.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(io_err)?;
        } else {
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(io_err)?;
            }
            let mut writer = fs::File::create(&out).map_err(io_err)?;
            io::copy(&mut entry, &mut writer).map_err(io_err)?;
            done = done.saturating_add(entry.size());
            if total > 0 {
                progress(percent(done, total));
            }
        }
    }
    Ok(())
}

fn extract_7z(archive: &Path, dest: &Path, progress: ProgressFn) -> Result<(), AppError> {
    fs::create_dir_all(dest).map_err(io_err)?;
    if let Some(seven) = native_7zip() {
        match run_native_7zip(seven, archive, dest, progress) {
            Ok(result) => return result,
            Err(spawn_err) => {
                // Binário removido/sem permissão desde a detecção: ainda dá
                // para extrair com o motor embutido.
                eprintln!(
                    "[extract] 7-Zip nativo não iniciou ({spawn_err}); usando extrator embutido"
                );
            }
        }
    }
    extract_7z_builtin(archive, dest, progress)
}

/// Caminho do 7-Zip nativo (instalação padrão do Windows ou PATH), detectado
/// uma vez por execução.
fn native_7zip() -> Option<&'static Path> {
    static CACHE: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHE.get_or_init(locate_native_7zip).as_deref()
}

fn locate_native_7zip() -> Option<PathBuf> {
    #[cfg(windows)]
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Some(base) = std::env::var_os(var) {
            let candidate = PathBuf::from(base).join("7-Zip").join("7z.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let names: &[&str] = if cfg!(windows) {
        &["7z.exe", "7za.exe", "7zz.exe"]
    } else {
        &["7z", "7za", "7zz"]
    };
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Roda `7z x` com progresso no stdout (`-bsp1`). `Err(io)` = o processo nem
/// iniciou (vale tentar o extrator embutido); `Ok(Err)` = o 7-Zip rodou e
/// reprovou o arquivo — erro final, sem fallback: se o motor mais capaz
/// falhou, o embutido também vai falhar.
fn run_native_7zip(
    seven: &Path,
    archive: &Path,
    dest: &Path,
    progress: ProgressFn,
) -> Result<Result<(), AppError>, io::Error> {
    let mut cmd = Command::new(seven);
    cmd.arg("x")
        .arg(archive)
        .arg(format!("-o{}", dest.display()))
        // -p vazio: arquivo com senha falha em vez de esperar input no console.
        .args(["-y", "-aoa", "-p", "-bso0", "-bsp1"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn()?;

    let mut stderr = child.stderr.take();
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(err) = stderr.as_mut() {
            let _ = err.take(16 * 1024).read_to_string(&mut buf);
        }
        buf
    });
    if let Some(stdout) = child.stdout.take() {
        scan_7zip_progress(stdout, progress);
    }

    let status = child.wait()?;
    let stderr_text = stderr_thread.join().unwrap_or_default();
    // 0 = ok; 1 = avisos não fatais (o conteúdo foi extraído mesmo assim).
    if matches!(status.code(), Some(0) | Some(1)) {
        return Ok(Ok(()));
    }
    let code = status
        .code()
        .map(|c| c.to_string())
        .unwrap_or_else(|| "?".into());
    let detail = stderr_text.trim();
    Ok(Err(AppError::Other(if detail.is_empty() {
        format!("7-Zip retornou código {code}")
    } else {
        format!("7-Zip retornou código {code}: {detail}")
    })))
}

/// Converte as marcações "NN%" do stdout do 7z em callbacks de progresso.
/// O 7z reescreve a linha com \r e backspaces, então basta varrer por dígitos
/// imediatamente antes de '%'.
fn scan_7zip_progress(mut stdout: impl Read, progress: ProgressFn) {
    let mut buf = [0u8; 4096];
    let mut digits: Vec<u8> = Vec::with_capacity(4);
    let mut last = u8::MAX;
    loop {
        let n = match stdout.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        for &b in &buf[..n] {
            if b.is_ascii_digit() {
                digits.push(b);
            } else {
                if b == b'%' && (1..=3).contains(&digits.len()) {
                    if let Some(pct) = std::str::from_utf8(&digits)
                        .ok()
                        .and_then(|s| s.parse::<u8>().ok())
                    {
                        let pct = pct.min(100);
                        if pct != last {
                            last = pct;
                            progress(pct);
                        }
                    }
                }
                digits.clear();
            }
        }
    }
}

/// Extração 7z pura em Rust, para máquinas sem 7-Zip. A sevenz-rust2 cobre
/// LZMA/LZMA2, BCJ2 e os filtros BCJ (incluindo ARM64); num método ainda mais
/// exótico o erro aponta a instalação do 7-Zip como saída.
fn extract_7z_builtin(archive: &Path, dest: &Path, progress: ProgressFn) -> Result<(), AppError> {
    let total = estimated_unpacked_size(archive, "7z").unwrap_or(0);
    let mut done = 0u64;
    sevenz_rust2::decompress_file_with_extract_fn(archive, dest, |entry, reader, dest_path| {
        let keep_going = sevenz_rust2::default_entry_extract_fn(entry, reader, dest_path)?;
        if !entry.is_directory() && total > 0 {
            done = done.saturating_add(entry.size());
            progress(percent(done, total));
        }
        Ok(keep_going)
    })
    .map_err(map_7z_error)
}

fn map_7z_error(e: sevenz_rust2::Error) -> AppError {
    use sevenz_rust2::Error as E;
    match &e {
        E::UnsupportedCompressionMethod(method) => AppError::Other(format!(
            "7z: o arquivo usa um método de compressão ({method}) que o extrator embutido não suporta. Instale o 7-Zip (https://www.7-zip.org) e extraia de novo — com ele instalado o app usa o motor nativo."
        )),
        E::PasswordRequired => AppError::Other(
            "7z: o arquivo é protegido por senha. Extraia manualmente com o 7-Zip.".into(),
        ),
        _ => AppError::Other(format!("7z: {e}")),
    }
}

/// Extracts a `.rar` archive (single or multi-volume - point at the first
/// volume for multi-part sets). Uses the `unrar` crate which statically links
/// the official UnRAR C++ engine; no DLL needed on Windows. Encrypted archives
/// surface a "missing password" error since we don't prompt - the user can
/// extract those manually with 7-Zip.
///
/// "Could not create file" (ERAR_ECREATE) no Windows costuma ser TRANSITÓRIO:
/// o antivírus segura o arquivo recém-criado para escanear (visto na prática
/// com jogos HTML de centenas de arquivos) e o UnRAR aborta a extração
/// inteira. Sobrescrever é idempotente, então com espaço de sobra em disco a
/// extração é repetida do zero algumas vezes antes de desistir.
fn extract_rar(archive: &Path, dest: &Path, progress: ProgressFn) -> Result<(), AppError> {
    fs::create_dir_all(dest).map_err(io_err)?;
    let total = estimated_unpacked_size(archive, "rar").unwrap_or(0);
    const MAX_ATTEMPTS: u32 = 3;
    let mut attempt = 1u32;
    loop {
        let fail = match extract_rar_once(archive, dest, total, progress) {
            Ok(()) => return Ok(()),
            Err(f) => f,
        };
        let can_retry = fail.transient && attempt < MAX_ATTEMPTS && !disk_nearly_full(dest);
        if !can_retry {
            return Err(rar_extract_error(fail, attempt, dest));
        }
        eprintln!(
            "[extract] rar: tentativa {attempt} falhou em '{}' ({}); repetindo em 1,5s",
            fail.entry, fail.message
        );
        std::thread::sleep(std::time::Duration::from_millis(1500));
        attempt += 1;
    }
}

/// Uma passada completa de extração. Erros de criação/gravação de arquivo
/// saem marcados como `transient` (candidatos a retry); o resto é definitivo.
fn extract_rar_once(
    archive: &Path,
    dest: &Path,
    total: u64,
    progress: ProgressFn,
) -> Result<(), RarFail> {
    let mut done = 0u64;
    let mut open = unrar::Archive::new(archive)
        .open_for_processing()
        .map_err(|e| RarFail::fatal(format!("rar open ({}): {e}", archive.display())))?;
    loop {
        let next = open
            .read_header()
            .map_err(|e| RarFail::fatal(format!("rar read header: {e}")))?;
        let Some(header) = next else { break };
        let is_file = header.entry().is_file();
        let entry_name = header.entry().filename.display().to_string();
        let unpacked = header.entry().unpacked_size;
        open = if is_file {
            let next = header
                .extract_with_base(dest)
                .map_err(|e| RarFail::from_extract(e, &entry_name))?;
            done = done.saturating_add(unpacked);
            if total > 0 {
                progress(percent(done, total));
            }
            next
        } else {
            header
                .skip()
                .map_err(|e| RarFail::fatal(format!("rar skip: {e}")))?
        };
    }
    Ok(())
}

struct RarFail {
    /// True para falhas de criar/gravar arquivo (ECREATE/EWRITE) — as que na
    /// prática se resolvem repetindo (lock momentâneo de antivírus).
    transient: bool,
    entry: String,
    message: String,
}

impl RarFail {
    fn fatal(message: String) -> Self {
        Self {
            transient: false,
            entry: String::new(),
            message,
        }
    }

    fn from_extract(e: unrar::error::UnrarError, entry: &str) -> Self {
        let message = e.to_string();
        let low = message.to_lowercase();
        let transient = low.contains("could not create") || low.contains("write");
        Self {
            transient,
            entry: entry.to_string(),
            message,
        }
    }
}

/// Abaixo disso o destino conta como "disco cheio" — aí retry não ajuda e a
/// mensagem deve mandar liberar espaço, não culpar o antivírus.
const DISK_NEARLY_FULL: u64 = 1024 * 1024 * 1024;

fn disk_nearly_full(dest: &Path) -> bool {
    matches!(fs4::available_space(dest), Ok(free) if free < DISK_NEARLY_FULL)
}

/// Mensagem final de erro do RAR com o diagnóstico correto: caminho longo
/// demais, disco realmente cheio, ou (o caso comum com espaço de sobra)
/// arquivo bloqueado por antivírus/outro programa — nunca "provável disco
/// cheio" com dezenas de GB livres.
fn rar_extract_error(fail: RarFail, attempts: u32, dest: &Path) -> AppError {
    if !fail.transient {
        return AppError::Other(fail.message);
    }
    let base = format!("rar extract ({}): {}", fail.entry, fail.message);
    let full_path_len = dest.join(&fail.entry).as_os_str().len();
    if full_path_len > 250 {
        return AppError::Other(format!(
            "{base}. O caminho de destino tem {full_path_len} caracteres — acima do limite do Windows. Mova a biblioteca de instalação para um caminho mais curto."
        ));
    }
    let free = fs4::available_space(dest).ok();
    if let Some(free) = free {
        if free < DISK_NEARLY_FULL {
            return AppError::Other(format!(
                "{base}. Disco cheio no destino (livres: {}). Libere espaço ou adicione uma biblioteca de instalação em outro disco (Configurações → Armazenamento).",
                fmt_bytes(free)
            ));
        }
    }
    let free_txt = free.map(fmt_bytes).unwrap_or_else(|| "?".into());
    AppError::Other(format!(
        "{base}. O Windows recusou criar o arquivo mesmo com espaço livre ({free_txt}) — normalmente é o antivírus segurando o arquivo recém-extraído, ou ele estar aberto em outro programa. Tentamos {attempts}x. Extraia de novo; se persistir, adicione a pasta da biblioteca às exclusões do antivírus."
    ))
}

fn io_err(e: io::Error) -> AppError {
    AppError::Io(e.to_string())
}

// -- main exe heuristic -------------------------------------------------------

const BLOCK_KEYWORDS: &[&str] = &[
    "unins",
    "uninst",
    "uninstall",
    "setup",
    "install",
    "redist",
    "_commonredist",
    "directx",
    "vc_redist",
    "vcredist",
    "dotnet",
    "ffmpeg",
    "crashpad",
    "crashreport",
    "updater",
    "python.exe",
    "node.exe",
    "pythonw.exe",
    "remove.exe",
    "regsvr",
];

/// Walk `root` recursively and return the most likely game executable.
/// Returns `None` if no candidates exist or all of them look like
/// installers/redists.
pub fn find_main_exe(root: &Path, game_title: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    walk(root, &mut candidates, 0);
    if candidates.is_empty() {
        return None;
    }
    let title_key = first_word_lowercase(game_title);
    candidates.sort_by_key(|p| score_path(p, root, &title_key));
    // Pull the best (lowest score). If everything is blocked, return None so
    // the user can pick manually.
    let best = candidates.into_iter().next()?;
    let best_score = score_path(&best, root, &title_key);
    if best_score >= 10_000 {
        None
    } else {
        Some(best)
    }
}

fn first_word_lowercase(title: &str) -> String {
    title
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase()
        // Strip surrounding punctuation that often clings to the first word.
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_string()
}

fn score_path(path: &Path, root: &Path, title_key: &str) -> i64 {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let rel = path.strip_prefix(root).unwrap_or(path);
    let rel_str = rel.to_string_lossy().to_lowercase();

    // Block list - block hits dominate any positive signals.
    for kw in BLOCK_KEYWORDS {
        if rel_str.contains(kw) {
            return 10_000;
        }
    }

    let mut score: i64 = 0;

    // Strong positive (lower score) for matching the game title prefix.
    if !title_key.is_empty() && name.contains(title_key) {
        score -= 1000;
    }
    // Common launcher filenames.
    match name.as_str() {
        "game.exe" | "start.exe" | "play.exe" | "launch.exe" | "launcher.exe" => score -= 500,
        _ => {}
    }
    if name.starts_with("game-") || name.starts_with("game_") {
        score -= 200;
    }

    // Penalize depth so a top-level exe wins ties.
    let depth = rel.components().count() as i64;
    score += depth * 10;
    // Mild preference for shorter filenames (cleaner ones tend to be shorter).
    score += name.len() as i64;

    score
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 8 {
        return; // safety net for pathological archives
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.file_type() else {
            continue;
        };
        if meta.is_dir() {
            walk(&path, out, depth + 1);
        } else if path
            .extension()
            .and_then(|s| s.to_str())
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
}
