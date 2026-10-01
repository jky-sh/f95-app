//! Detecção de conquistas nos saves do PRÓPRIO jogo (builds DRM-free).
//!
//! Muitos jogos do F95 são distribuídos sem emulador Steam nenhum (a
//! integração é removida da build) — mas continuam rastreando as conquistas
//! internamente no save. Este módulo, opt-in por jogo, vasculha os locais de
//! save conhecidos por engine e marca como desbloqueada toda conquista do
//! schema Steam cujo nome aparece como string no save:
//!
//! - Godot:  `%APPDATA%/Godot/app_userdata/<jogo>/` (ex.: `progress.dat`);
//! - Ren'Py: `<install>/game/saves/persistent` e `%APPDATA%/RenPy/<jogo>-*/persistent`
//!           (zlib + pickle; o módulo `achievement` do Ren'Py grava os nomes
//!           concedidos no persistent);
//! - Unity:  `%USERPROFILE%/AppData/LocalLow/<studio>/<jogo>/`;
//! - Genérico: pastas `save`/`saves`/`www/save`/`SaveData` na instalação.
//!
//! É heurística de igualdade exata de strings (normalizadas), então é
//! exposta como modo experimental — um save que contenha a palavra por outro
//! motivo (ex.: dificuldade "Beginner") geraria falso positivo.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::parser::UnlockedAchievement;

pub const SOURCE: &str = "SaveScan";

/// Limites de segurança da varredura.
const MAX_FILES: usize = 60;
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_INFLATED_BYTES: usize = 32 * 1024 * 1024;
const MAX_DIR_ENTRIES: usize = 400;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementNamePair {
    pub api_name: String,
    pub display_name: String,
}

fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

/// Título F95 sem colchetes de versão/dev ("Jogo [v0.5] [Dev]" → "Jogo").
fn clean_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut depth = 0usize;
    for c in title.chars() {
        match c {
            '[' => depth += 1,
            ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

/// Nomes de pastas de save que casam com o título do jogo (igualdade ou
/// prefixo normalizado — Ren'Py usa "Titulo-1234567890").
fn dir_matches_title(dir_name: &str, title_norm: &str) -> bool {
    if title_norm.len() < 5 {
        return normalize(dir_name) == title_norm && !title_norm.is_empty();
    }
    let dir_norm = normalize(dir_name);
    dir_norm == title_norm
        || dir_norm.starts_with(title_norm)
        || title_norm.starts_with(dir_norm.as_str()) && dir_norm.len() >= 5
}

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}

/// Diretórios candidatos a conter saves deste jogo.
fn candidate_dirs(title: &str, install_path: Option<&Path>, exe_path: Option<&Path>) -> Vec<PathBuf> {
    let title_norm = normalize(&clean_title(title));
    let mut dirs: Vec<PathBuf> = Vec::new();

    // Pastas de save dentro da instalação (Ren'Py, RPG Maker, genérico).
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(p) = install_path {
        roots.push(p.to_path_buf());
    }
    if let Some(dir) = exe_path.and_then(|p| p.parent()) {
        if !roots.iter().any(|r| r == dir) {
            roots.push(dir.to_path_buf());
        }
    }
    for root in &roots {
        for sub in [
            "game/saves",
            "save",
            "saves",
            "Save",
            "Saves",
            "SaveData",
            "www/save",
        ] {
            let dir = root.join(sub);
            if dir.is_dir() {
                dirs.push(dir);
            }
        }
    }

    // Godot: %APPDATA%/Godot/app_userdata/<jogo>
    if let Some(app_data) = env_dir("APPDATA") {
        push_matching_children(&app_data.join("Godot").join("app_userdata"), &title_norm, &mut dirs);
        // Ren'Py: %APPDATA%/RenPy/<save_directory>
        push_matching_children(&app_data.join("RenPy"), &title_norm, &mut dirs);
    }

    // Unity: %USERPROFILE%/AppData/LocalLow/<studio>/<jogo>
    if let Some(profile) = env_dir("USERPROFILE") {
        let local_low = profile.join("AppData").join("LocalLow");
        if let Ok(studios) = std::fs::read_dir(&local_low) {
            for studio in studios.flatten().take(MAX_DIR_ENTRIES) {
                if studio.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    push_matching_children(&studio.path(), &title_norm, &mut dirs);
                }
            }
        }
    }

    dirs
}

fn push_matching_children(parent: &Path, title_norm: &str, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten().take(MAX_DIR_ENTRIES) {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if dir_matches_title(&name, title_norm) {
            out.push(entry.path());
        }
    }
}

fn is_scannable_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    // `persistent` do Ren'Py não tem extensão.
    if name == "persistent" {
        return true;
    }
    matches!(
        path.extension().and_then(|s| s.to_str()).map(str::to_lowercase).as_deref(),
        Some("dat" | "sav" | "save" | "json" | "txt" | "bin" | "cfg" | "es3" | "prefs")
    )
}

/// Arquivos de save observáveis deste jogo (para o watcher acompanhar mtime).
pub fn discover_save_files(
    title: &str,
    install_path: Option<&Path>,
    exe_path: Option<&Path>,
) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for dir in candidate_dirs(title, install_path, exe_path) {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten().take(MAX_DIR_ENTRIES) {
            if files.len() >= MAX_FILES {
                return files;
            }
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_file() && meta.len() <= MAX_FILE_BYTES && is_scannable_file(&path) {
                files.push(path);
            }
        }
    }
    files
}

/// Strings ASCII imprimíveis (len >= 3) de um blob binário.
fn extract_tokens(bytes: &[u8], out: &mut Vec<String>) {
    let mut cur = String::new();
    for &b in bytes {
        if (0x20..0x7f).contains(&b) {
            cur.push(b as char);
        } else {
            if cur.len() >= 3 {
                out.push(std::mem::take(&mut cur));
            } else {
                cur.clear();
            }
        }
    }
    if cur.len() >= 3 {
        out.push(cur);
    }
}

/// Varre os arquivos e devolve as conquistas cujos nomes aparecem como
/// string exata (normalizada) em algum save. `unlock_time` = mtime do
/// arquivo onde o nome apareceu (melhor aproximação disponível).
pub fn scan_unlocked(files: &[PathBuf], names: &[AchievementNamePair]) -> Vec<UnlockedAchievement> {
    // norm(nome) → api_name. Nomes curtos demais ficam de fora (falso
    // positivo fácil: "win", "end"…).
    let mut lookup: HashMap<String, &str> = HashMap::new();
    for pair in names {
        let api_norm = normalize(&pair.api_name);
        if api_norm.len() >= 4 {
            lookup.entry(api_norm).or_insert(pair.api_name.as_str());
        }
        let display_norm = normalize(&pair.display_name);
        if display_norm.len() >= 4 {
            lookup.entry(display_norm).or_insert(pair.api_name.as_str());
        }
    }
    if lookup.is_empty() {
        return Vec::new();
    }

    let mut found: HashMap<&str, i64> = HashMap::new();
    for path in files {
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        let mtime_ms = std::fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let mut tokens = Vec::new();
        extract_tokens(&bytes, &mut tokens);
        // Ren'Py `persistent` (e outros) são zlib puro: magic 0x78.
        if bytes.first() == Some(&0x78) {
            use flate2::read::ZlibDecoder;
            use std::io::Read;
            let mut inflated = Vec::new();
            let mut decoder = ZlibDecoder::new(&bytes[..]).take(MAX_INFLATED_BYTES as u64);
            if decoder.read_to_end(&mut inflated).is_ok() {
                extract_tokens(&inflated, &mut tokens);
            }
        }

        for token in tokens {
            if let Some(api_name) = lookup.get(normalize(&token).as_str()) {
                found.entry(api_name).or_insert(mtime_ms);
            }
        }
    }

    found
        .into_iter()
        .map(|(api_name, mtime_ms)| UnlockedAchievement {
            api_name: api_name.to_string(),
            unlock_time: (mtime_ms > 0).then_some(mtime_ms),
            source: SOURCE,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(names: &[(&str, &str)]) -> Vec<AchievementNamePair> {
        names
            .iter()
            .map(|(api, display)| AchievementNamePair {
                api_name: api.to_string(),
                display_name: display.to_string(),
            })
            .collect()
    }

    #[test]
    fn acha_nomes_em_blob_binario_estilo_godot() {
        let dir = std::env::temp_dir().join("f95_savescan_tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("progress.dat");
        // Length-prefixed como o Godot: bytes de controle separam as strings.
        let mut blob: Vec<u8> = vec![0x48, 0x00, 0x21, 0x02];
        for name in ["Beginner", "Why Not", "A Little Nudge"] {
            blob.extend_from_slice(&(name.len() as u32).to_le_bytes());
            blob.extend_from_slice(name.as_bytes());
        }
        std::fs::write(&path, &blob).unwrap();

        let names = pairs(&[
            ("Beginner", "Beginner"),
            ("Why Not", "Why Not"),
            ("Mortal", "Mortal"),
            ("Win", "Win"), // curto demais: nunca deve casar
        ]);
        let got = scan_unlocked(&[path], &names);
        let mut apis: Vec<&str> = got.iter().map(|u| u.api_name.as_str()).collect();
        apis.sort();
        assert_eq!(apis, vec!["Beginner", "Why Not"]);
    }

    #[test]
    fn acha_nomes_dentro_de_zlib_estilo_renpy() {
        use flate2::write::ZlibEncoder;
        use flate2::Compression;
        use std::io::Write;
        let dir = std::env::temp_dir().join("f95_savescan_tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("persistent");
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(b"\x80\x04\x95also\x00\x8c\x0aFirst Kiss\x94garbage")
            .unwrap();
        std::fs::write(&path, enc.finish().unwrap()).unwrap();

        let names = pairs(&[("ach_first_kiss", "First Kiss")]);
        let got = scan_unlocked(&[path], &names);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].api_name, "ach_first_kiss");
    }

    #[test]
    fn match_de_diretorio_por_titulo() {
        let t = normalize(&clean_title("Anomalous Coffee Machine 2 [v1.0] [Dev]"));
        assert!(dir_matches_title("Anomalous Coffee Machine 2", &t));
        let t2 = normalize(&clean_title("My Game [v0.5]"));
        assert!(dir_matches_title("MyGame-1234567890", &t2));
        assert!(!dir_matches_title("OtherGame", &t2));
    }
}
