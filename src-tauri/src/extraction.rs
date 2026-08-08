//! Archive extraction + main-executable heuristic.
//!
//! Phase 5.5: pure-Rust extraction for `.zip` and `.7z`. `.rar` is recognized
//! but rejected with a friendly error until we wire `unrar`'s native engine.
//! After extracting, walk the destination tree and pick the most likely game
//! executable using a small scoring function (filename match, depth, block
//! patterns for installers/redistributables).

use crate::error::AppError;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Extract `archive` into `dest`. The dest directory is created if missing.
/// Existing files inside it are overwritten. Returns the dest path on success.
pub fn extract(archive: &Path, dest: &Path) -> Result<(), AppError> {
    let ext = archive
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    preflight_disk_space(archive, dest, &ext)?;
    match ext.as_str() {
        "zip" => extract_zip(archive, dest),
        "7z" => extract_7z(archive, dest),
        "rar" => extract_rar(archive, dest),
        other => Err(AppError::Other(format!("formato não suportado: .{other}"))),
    }
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

/// Soma dos tamanhos descomprimidos, quando o formato permite ler barato
/// (zip: central directory; rar: listagem de headers). 7z cai no fallback.
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

fn extract_zip(archive: &Path, dest: &Path) -> Result<(), AppError> {
    let f = fs::File::open(archive).map_err(io_err)?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| AppError::Other(format!("zip open: {e}")))?;
    fs::create_dir_all(dest).map_err(io_err)?;
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
        }
    }
    Ok(())
}

fn extract_7z(archive: &Path, dest: &Path) -> Result<(), AppError> {
    fs::create_dir_all(dest).map_err(io_err)?;
    sevenz_rust2::decompress_file(archive, dest)
        .map_err(|e| AppError::Other(format!("7z: {e}")))?;
    Ok(())
}

/// Extracts a `.rar` archive (single or multi-volume - point at the first
/// volume for multi-part sets). Uses the `unrar` crate which statically links
/// the official UnRAR C++ engine; no DLL needed on Windows. Encrypted archives
/// surface a "missing password" error since we don't prompt - the user can
/// extract those manually with 7-Zip.
fn extract_rar(archive: &Path, dest: &Path) -> Result<(), AppError> {
    fs::create_dir_all(dest).map_err(io_err)?;
    let mut open = unrar::Archive::new(archive)
        .open_for_processing()
        .map_err(|e| AppError::Other(format!("rar open ({}): {e}", archive.display())))?;
    loop {
        let next = open
            .read_header()
            .map_err(|e| AppError::Other(format!("rar read header: {e}")))?;
        let Some(header) = next else { break };
        let is_file = header.entry().is_file();
        let entry_name = header.entry().filename.display().to_string();
        open = if is_file {
            header
                .extract_with_base(dest)
                .map_err(|e| rar_extract_error(e, &entry_name, dest))?
        } else {
            header
                .skip()
                .map_err(|e| AppError::Other(format!("rar skip: {e}")))?
        };
    }
    Ok(())
}

/// "Could not create file" do UnRAR (ERAR_ECREATE) não diz o porquê; os dois
/// culpados reais são disco cheio e caminho acima do limite do Windows.
/// Anexa o diagnóstico para o usuário não ficar no escuro.
fn rar_extract_error(e: unrar::error::UnrarError, entry_name: &str, dest: &Path) -> AppError {
    let base = format!("rar extract ({entry_name}): {e}");
    let msg = e.to_string().to_lowercase();
    if msg.contains("could not create") || msg.contains("write") {
        let free = fs4::available_space(dest)
            .map(fmt_bytes)
            .unwrap_or_else(|_| "?".into());
        let full_path_len = dest.join(entry_name).as_os_str().len();
        let hint = if full_path_len > 250 {
            format!(
                "O caminho de destino tem {full_path_len} caracteres — acima do limite do Windows. Mova a biblioteca de instalação para um caminho mais curto."
            )
        } else {
            format!(
                "Provável disco cheio (livres no destino: {free}). Libere espaço ou adicione uma biblioteca de instalação em outro disco (Configurações → Armazenamento)."
            )
        };
        return AppError::Other(format!("{base}. {hint}"));
    }
    AppError::Other(base)
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
