//! Move save files from an old install directory to a new one, and clean up
//! the old directory afterwards.
//!
//! F95Zone hosts a grab-bag of engines (Ren'Py, RPGMaker MV/MZ, Unity, KiriKiri,
//! WolfRPG, raw HTML…). Most engines either keep saves inside the install
//! directory (so re-installing wipes them) or in a user-profile path that
//! survives reinstalls. We only worry about the first kind.
//!
//! Strategy: walk the old install root with a shallow recursion (capped depth)
//! and copy any directory whose name matches a list of known save folder
//! names. Anything outside that list is left alone — we don't try to be
//! clever about identifying arbitrary "user data" because guessing wrong
//! costs the player progress.
//!
//! After a successful migration the caller can call `delete_dir` on the old
//! install path to free disk space. To avoid catastrophic mistakes we refuse
//! to delete anything outside the app's own downloads root.

use crate::error::AppError;
use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const SAVE_DIR_NAMES: &[&str] = &[
    "saves",     // Ren'Py
    "save",      // KiriKiri, generic
    "Saves",     // some games on Windows
    "Save",      // VN engines
    "savedata",  // various
    "save_data", // various
    "www/save",  // RPGMaker MV (we look inside www/)
    "SaveGames", // Unreal (<Projeto>/Saved/SaveGames)
];

/// Extensões de arquivos de save que vivem SOLTOS na raiz do install (não em
/// pasta própria): família RGSS do RPG Maker (XP: .rxdata, VX: .rvdata,
/// VX Ace: .rvdata2) e RPG Maker 2000/2003 (.lsd). São nomes tipo
/// `Save01.rvdata2` ao lado do Game.exe. O prefixo "save" no nome é
/// OBRIGATÓRIO: `Data/` da mesma engine guarda os dados do jogo nas mesmas
/// extensões (Map001.rvdata2, Actors.rvdata2…) e copiá-los por cima da
/// versão nova reverteria o update.
const SAVE_FILE_EXTS: &[&str] = &["rvdata2", "rvdata", "rxdata", "lsd"];

// Look up to this many directory levels deep when scanning for save folders.
// Most engines stash saves at root or one level deep (Ren'Py: `game/saves/`,
// RPGMaker: `www/save/`). Three covers the common cases without iterating
// the entire tree of a 5GB unpacked game.
const MAX_SCAN_DEPTH: usize = 4;

#[derive(Debug, Serialize)]
pub struct MigrationResult {
    /// How many save directories were copied. Zero is a normal outcome — many
    /// games don't have local saves yet (fresh install) or use user-profile
    /// paths.
    pub copied: usize,
    /// Total bytes copied. For UI feedback.
    pub bytes_copied: u64,
    /// Where each copied directory landed in the new install, for logging.
    pub destinations: Vec<String>,
    /// Engine detectada no install antigo/novo (slug de `engine_detect`).
    /// `None` = não identificada.
    pub old_engine: Option<String>,
    pub new_engine: Option<String>,
    /// True quando as duas engines foram detectadas e são DIFERENTES — o dev
    /// trocou de engine entre versões (RPGM→Ren'Py acontece no F95). Nesse
    /// caso nada é copiado: o formato de save não é compatível e sobrescrever
    /// arquivos da instalação nova com lixo de outra engine só faz mal. A UI
    /// avisa o usuário que os saves antigos ficaram na versão anterior.
    pub engine_mismatch: bool,
}

/// Copy every recognized save directory from `old_root` into `new_root`,
/// preserving the relative path. Files inside an existing destination are
/// merged (existing files overwritten) so a partial new-install layout
/// doesn't lose the user's progress.
///
/// Antes de copiar, compara a engine detectada dos dois lados — só migra
/// quando compatíveis (iguais, ou quando algum lado é desconhecido: aí o
/// benefício de tentar supera o risco, já que só copiamos nomes de pasta
/// reconhecidamente de save).
pub fn migrate(old_root: &Path, new_root: &Path) -> Result<MigrationResult, AppError> {
    if !old_root.exists() {
        return Err(AppError::Other(format!(
            "diretório de origem não existe: {}",
            old_root.display()
        )));
    }
    if !new_root.exists() {
        return Err(AppError::Other(format!(
            "diretório de destino não existe: {}",
            new_root.display()
        )));
    }

    let old_engine = crate::engine_detect::detect_engine(old_root);
    let new_engine = crate::engine_detect::detect_engine(new_root);
    let engine_mismatch = match (old_engine, new_engine) {
        (Some(a), Some(b)) => a != b,
        _ => false,
    };

    let mut result = MigrationResult {
        copied: 0,
        bytes_copied: 0,
        destinations: Vec::new(),
        old_engine: old_engine.map(str::to_string),
        new_engine: new_engine.map(str::to_string),
        engine_mismatch,
    };
    if engine_mismatch {
        return Ok(result);
    }

    for entry in WalkDir::new(old_root)
        .max_depth(MAX_SCAN_DEPTH)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path == old_root {
            continue;
        }
        if entry.file_type().is_dir() {
            if !is_save_dir(path) {
                continue;
            }
            let rel = match path.strip_prefix(old_root) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let dest = new_root.join(rel);
            let copied_bytes = copy_dir_merge(path, &dest)?;
            result.copied += 1;
            result.bytes_copied += copied_bytes;
            result
                .destinations
                .push(dest.to_string_lossy().into_owned());
        } else if entry.file_type().is_file() && entry.depth() <= 2 && is_save_file(path) {
            // Saves soltos (RPGM RGSS/2k) — replica no mesmo nível relativo.
            let rel = match path.strip_prefix(old_root) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let dest = new_root.join(rel);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            let n = fs::copy(path, &dest)?;
            result.copied += 1;
            result.bytes_copied += n;
            result
                .destinations
                .push(dest.to_string_lossy().into_owned());
        }
    }

    Ok(result)
}

fn is_save_file(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(OsStr::to_str) else {
        return false;
    };
    let ext = ext.to_ascii_lowercase();
    if !SAVE_FILE_EXTS.contains(&ext.as_str()) {
        return false;
    }
    path.file_stem()
        .and_then(OsStr::to_str)
        .map(|stem| stem.to_ascii_lowercase().starts_with("save"))
        .unwrap_or(false)
}

fn is_save_dir(path: &Path) -> bool {
    let name = match path.file_name().and_then(OsStr::to_str) {
        Some(n) => n,
        None => return false,
    };
    // case-insensitive match on the basename. The "www/save" entry in
    // SAVE_DIR_NAMES is matched by its basename "save" — the parent context
    // is enforced by the walk itself.
    for candidate in SAVE_DIR_NAMES {
        let cand_base = candidate.rsplit('/').next().unwrap_or(candidate);
        if name.eq_ignore_ascii_case(cand_base) {
            return true;
        }
    }
    false
}

fn copy_dir_merge(src: &Path, dst: &Path) -> Result<u64, AppError> {
    fs::create_dir_all(dst)?;
    let mut bytes: u64 = 0;
    for entry in WalkDir::new(src) {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => return Err(AppError::Other(format!("walk: {e}"))),
        };
        let src_path = entry.path();
        let rel = match src_path.strip_prefix(src) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let dst_path = dst.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&dst_path)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = dst_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let n = fs::copy(src_path, &dst_path)?;
            bytes += n;
        }
        // symlinks are skipped intentionally — saves shouldn't depend on them.
    }
    Ok(bytes)
}

/// Recursively delete `path`. Refuses anything that isn't under at least one
/// of the `safe_roots`. Returns Ok(false) when the target was outside every
/// safe area (the caller typically just leaves the folder alone).
///
/// We accept a list (not a single root) because the user can register N
/// install libraries — any of them is a legitimate place for an install.
pub fn delete_under(path: &Path, safe_roots: &[PathBuf]) -> Result<bool, AppError> {
    if !path.exists() {
        return Ok(true);
    }
    let canon_target = canonicalize_lenient(path);
    let in_sandbox = safe_roots
        .iter()
        .map(|r| canonicalize_lenient(r))
        .any(|r| canon_target.starts_with(&r));
    if !in_sandbox {
        // Outside every sandbox — refuse. Lets the user point exe_path at a
        // file living somewhere else (e.g. an existing manual install) without
        // worrying that an "update" wipes their unrelated folder.
        return Ok(false);
    }
    if path.is_file() {
        fs::remove_file(path)?;
    } else if path.is_dir() {
        fs::remove_dir_all(path)?;
    }
    Ok(true)
}

/// Same as `std::fs::canonicalize` but falls back to the lexical path when the
/// target doesn't exist (which can happen if the user is deleting a path that
/// vanished between UI and us, or if Windows refuses `\\?\` prefixes).
fn canonicalize_lenient(p: &Path) -> PathBuf {
    fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}
