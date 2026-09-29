//! Detecção heurística da engine de um jogo pelo conteúdo do diretório
//! instalado.
//!
//! Usada em duas frentes do versionamento de instalações:
//! - decidir se os saves da versão anterior podem ser copiados para a nova
//!   (engines diferentes = formatos de save incompatíveis, não copia);
//! - exibir a engine como badge na lista de versões da página do jogo.
//!
//! A detecção olha só marcadores baratos (nomes de arquivos/pastas até 2
//! níveis) — nada de abrir arquivo. Empates são resolvidos pela ordem dos
//! testes: marcadores específicos (renpy/, *_Data/, Data.wolf…) vêm antes dos
//! genéricos (index.html). Retorna `None` quando nada casa; o chamador trata
//! como "desconhecida" e NÃO bloqueia migração de saves por isso.

use std::fs;
use std::path::Path;

/// Slugs estáveis — gravados no banco (install_versions.engine) e mapeados
/// para rótulos de UI no frontend. Não renomear sem migração.
pub const RENPY: &str = "renpy";
pub const RPGM_MV: &str = "rpgm_mv";
pub const RPGM_MZ: &str = "rpgm_mz";
pub const RPGM_VX: &str = "rpgm_vx"; // família RGSS: XP/VX/VX Ace
pub const RPGM_2K: &str = "rpgm_2k"; // RPG Maker 2000/2003
pub const UNITY: &str = "unity";
pub const UNREAL: &str = "unreal";
pub const GODOT: &str = "godot";
pub const WOLF: &str = "wolf";
pub const KIRIKIRI: &str = "kirikiri";
pub const HTML: &str = "html";
pub const FLASH: &str = "flash";

/// Detecta a engine do jogo instalado em `root`. Jogos costumam extrair com
/// uma pasta-shell (`Jogo-1.0-pc/Jogo/game/...`), então quando o root só tem
/// uma subpasta a busca desce nela também.
pub fn detect_engine(root: &Path) -> Option<&'static str> {
    if let Some(engine) = detect_in_dir(root) {
        return Some(engine);
    }
    // Shell folder: um único subdiretório e nenhum marcador no nível atual.
    let mut dirs = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                dirs.push(entry.path());
                if dirs.len() > 1 {
                    break;
                }
            }
        }
    }
    if dirs.len() == 1 {
        return detect_in_dir(&dirs[0]);
    }
    None
}

fn detect_in_dir(dir: &Path) -> Option<&'static str> {
    let listing = DirListing::read(dir)?;

    // Ren'Py: pasta renpy/ ao lado de game/, ou game/ contendo .rpa/.rpyc.
    if listing.has_dir("renpy") {
        return Some(RENPY);
    }
    if listing.has_dir("game")
        && dir_has_ext(&dir.join("game"), &["rpa", "rpyc", "rpy"])
    {
        return Some(RENPY);
    }

    // RPG Maker MZ primeiro (MV e MZ compartilham layout nw.js; o MZ tem
    // js/rmmz_core.js na raiz do projeto).
    if listing.has_dir("js") && dir.join("js").join("rmmz_core.js").is_file() {
        return Some(RPGM_MZ);
    }
    if listing.has_dir("www") {
        let www = dir.join("www");
        if www.join("js").join("rmmz_core.js").is_file() {
            return Some(RPGM_MZ);
        }
        if www.join("js").join("rpg_core.js").is_file() || www.join("data").is_dir() {
            return Some(RPGM_MV);
        }
    }
    // MV "linear deploy" raro: js/rpg_core.js na raiz.
    if listing.has_dir("js") && dir.join("js").join("rpg_core.js").is_file() {
        return Some(RPGM_MV);
    }

    // RPG Maker XP/VX/VX Ace: arquivo empacotado RGSS ou Data/ com .r?data.
    if listing.has_ext(&["rgss3a", "rgss2a", "rgssad"]) {
        return Some(RPGM_VX);
    }
    if listing.has_file("game.ini")
        && dir_has_ext(&dir.join("Data"), &["rvdata2", "rvdata", "rxdata"])
    {
        return Some(RPGM_VX);
    }

    // RPG Maker 2000/2003: RPG_RT.exe + mapas .lmu.
    if listing.has_file("rpg_rt.exe") {
        return Some(RPGM_2K);
    }

    // Unity: UnityPlayer.dll na raiz ou pasta *_Data com globalgamemanagers.
    if listing.has_file("unityplayer.dll") {
        return Some(UNITY);
    }
    if let Some(data_dir) = listing.dir_ending_with("_data") {
        let d = dir.join(data_dir);
        if d.join("globalgamemanagers").is_file()
            || d.join("data.unity3d").is_file()
            || d.join("resources.assets").is_file()
        {
            return Some(UNITY);
        }
    }

    // Unreal: Engine/ + <Projeto>/Content/Paks (build shipped padrão).
    if listing.has_dir("engine") {
        for sub in &listing.dirs {
            if sub.eq_ignore_ascii_case("engine") {
                continue;
            }
            if dir.join(sub).join("Content").join("Paks").is_dir() {
                return Some(UNREAL);
            }
        }
    }

    // Godot: .pck ao lado do executável.
    if listing.has_ext(&["pck"]) {
        return Some(GODOT);
    }

    // Wolf RPG: Data.wolf (ou vários .wolf) + Game.exe.
    if listing.has_ext(&["wolf"]) {
        return Some(WOLF);
    }
    if listing.has_file("gamedata.wolf") {
        return Some(WOLF);
    }

    // KiriKiri: pacotes .xp3.
    if listing.has_ext(&["xp3"]) {
        return Some(KIRIKIRI);
    }

    // Flash: .swf na raiz.
    if listing.has_ext(&["swf"]) {
        return Some(FLASH);
    }

    // HTML puro (Twine, RAGS web…): index.html sem nenhum marcador acima.
    if listing.has_file("index.html") {
        return Some(HTML);
    }

    None
}

/// Uma listagem rasa: nomes (lowercase) de arquivos e pastas do diretório.
struct DirListing {
    files: Vec<String>,
    dirs: Vec<String>,
}

impl DirListing {
    fn read(dir: &Path) -> Option<Self> {
        let entries = fs::read_dir(dir).ok()?;
        let mut files = Vec::new();
        let mut dirs = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            match entry.file_type() {
                Ok(t) if t.is_dir() => dirs.push(name),
                Ok(t) if t.is_file() => files.push(name),
                _ => {}
            }
        }
        Some(Self { files, dirs })
    }

    fn has_dir(&self, name: &str) -> bool {
        self.dirs.iter().any(|d| d == name)
    }

    fn has_file(&self, name: &str) -> bool {
        self.files.iter().any(|f| f == name)
    }

    fn has_ext(&self, exts: &[&str]) -> bool {
        self.files.iter().any(|f| {
            f.rsplit_once('.')
                .map(|(_, e)| exts.contains(&e))
                .unwrap_or(false)
        })
    }

    fn dir_ending_with(&self, suffix: &str) -> Option<&str> {
        self.dirs
            .iter()
            .find(|d| d.ends_with(suffix))
            .map(|s| s.as_str())
    }
}

/// True quando `dir` contém (raso) algum arquivo com uma das extensões.
fn dir_has_ext(dir: &Path, exts: &[&str]) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if let Some((_, ext)) = name.rsplit_once('.') {
            if exts.contains(&ext) {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, File};

    fn touch(p: &Path) {
        create_dir_all(p.parent().unwrap()).unwrap();
        File::create(p).unwrap();
    }

    #[test]
    fn detects_renpy_via_shell_folder() {
        let tmp = std::env::temp_dir().join("f95_engine_test_renpy");
        let _ = std::fs::remove_dir_all(&tmp);
        touch(&tmp.join("Jogo-1.0-pc").join("game").join("scripts.rpa"));
        touch(&tmp.join("Jogo-1.0-pc").join("Jogo.exe"));
        assert_eq!(detect_engine(&tmp), Some(RENPY));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn detects_rpgm_mv() {
        let tmp = std::env::temp_dir().join("f95_engine_test_mv");
        let _ = std::fs::remove_dir_all(&tmp);
        touch(&tmp.join("www").join("js").join("rpg_core.js"));
        touch(&tmp.join("Game.exe"));
        assert_eq!(detect_engine(&tmp), Some(RPGM_MV));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn detects_unity() {
        let tmp = std::env::temp_dir().join("f95_engine_test_unity");
        let _ = std::fs::remove_dir_all(&tmp);
        touch(&tmp.join("UnityPlayer.dll"));
        touch(&tmp.join("Jogo.exe"));
        assert_eq!(detect_engine(&tmp), Some(UNITY));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn unknown_dir_returns_none() {
        let tmp = std::env::temp_dir().join("f95_engine_test_none");
        let _ = std::fs::remove_dir_all(&tmp);
        touch(&tmp.join("qualquer.txt"));
        assert_eq!(detect_engine(&tmp), None);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
