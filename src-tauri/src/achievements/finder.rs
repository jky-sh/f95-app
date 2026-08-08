//! Descoberta dos arquivos de achievements que os cracks/emuladores gravam.
//!
//! Cada emulador tem pastas conhecidas keyed pelo appid Steam (port da tabela
//! do find-achievement-files.ts do Hydra). Além delas, dois formatos moram ao
//! lado do executável do jogo (`SteamData/user_stats.ini` e
//! `3DMGAME/Player/stats/achievements.ini`).

use std::path::{Path, PathBuf};

use super::Cracker;

#[derive(Debug, Clone)]
pub struct AchievementFileCandidate {
    pub cracker: Cracker,
    pub path: PathBuf,
    /// FLT usa uma PASTA (um arquivo por conquista) em vez de um arquivo.
    pub is_dir: bool,
}

fn env_path(var: &str, fallback: &str) -> PathBuf {
    std::env::var_os(var)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(fallback))
}

struct SystemDirs {
    app_data: PathBuf,
    local_app_data: PathBuf,
    documents: PathBuf,
    public_documents: PathBuf,
    program_data: PathBuf,
}

fn system_dirs() -> SystemDirs {
    let user_profile = env_path("USERPROFILE", "C:\\Users\\Default");
    SystemDirs {
        app_data: env_path("APPDATA", "C:\\Users\\Default\\AppData\\Roaming"),
        local_app_data: env_path("LOCALAPPDATA", "C:\\Users\\Default\\AppData\\Local"),
        documents: user_profile.join("Documents"),
        public_documents: env_path("PUBLIC", "C:\\Users\\Public").join("Documents"),
        program_data: env_path("PROGRAMDATA", "C:\\ProgramData"),
    }
}

/// Todos os caminhos candidatos para um jogo (existentes ou não — o watcher
/// decide o que fazer com base em `fs::metadata`).
pub fn candidate_files(app_id: &str, exe_path: Option<&Path>) -> Vec<AchievementFileCandidate> {
    let dirs = system_dirs();
    let mut out: Vec<AchievementFileCandidate> = Vec::new();
    let mut push = |cracker: Cracker, path: PathBuf| {
        // Windows é case-insensitive; evita candidatos duplicados tipo
        // `achievements.ini` vs `Achievements.ini`.
        let exists = out.iter().any(|c| {
            c.path.as_os_str().eq_ignore_ascii_case(path.as_os_str())
        });
        if !exists {
            out.push(AchievementFileCandidate {
                cracker,
                path,
                is_dir: matches!(cracker, Cracker::Flt),
            });
        }
    };

    // CODEX
    push(
        Cracker::Codex,
        dirs.public_documents
            .join("Steam")
            .join("CODEX")
            .join(app_id)
            .join("achievements.ini"),
    );
    push(
        Cracker::Codex,
        dirs.app_data
            .join("Steam")
            .join("CODEX")
            .join(app_id)
            .join("achievements.ini"),
    );

    // RUNE
    push(
        Cracker::Rune,
        dirs.public_documents
            .join("Steam")
            .join("RUNE")
            .join(app_id)
            .join("achievements.ini"),
    );

    // OnlineFix
    push(
        Cracker::OnlineFix,
        dirs.public_documents
            .join("OnlineFix")
            .join(app_id)
            .join("Stats")
            .join("Achievements.ini"),
    );
    push(
        Cracker::OnlineFix,
        dirs.public_documents
            .join("OnlineFix")
            .join(app_id)
            .join("Achievements.ini"),
    );

    // Goldberg / GSE
    push(
        Cracker::Goldberg,
        dirs.app_data
            .join("Goldberg SteamEmu Saves")
            .join(app_id)
            .join("achievements.json"),
    );
    push(
        Cracker::Goldberg,
        dirs.app_data
            .join("GSE Saves")
            .join(app_id)
            .join("achievements.json"),
    );

    // RLD! (e variantes dodi/Player)
    push(
        Cracker::Rld,
        dirs.program_data
            .join("RLD!")
            .join(app_id)
            .join("achievements.ini"),
    );
    for sub in ["Player", "RLD!", "dodi"] {
        push(
            Cracker::Rld,
            dirs.program_data
                .join("Steam")
                .join(sub)
                .join(app_id)
                .join("stats")
                .join("achievements.ini"),
        );
    }

    // EMPRESS
    push(
        Cracker::Empress,
        dirs.app_data
            .join("EMPRESS")
            .join("remote")
            .join(app_id)
            .join("achievements.json"),
    );
    push(
        Cracker::Empress,
        dirs.public_documents
            .join("EMPRESS")
            .join(app_id)
            .join("remote")
            .join(app_id)
            .join("achievements.json"),
    );

    // SKIDROW
    for base in [
        dirs.documents.join("SKIDROW"),
        dirs.documents.join("Player"),
        dirs.local_app_data.join("SKIDROW"),
    ] {
        push(
            Cracker::Skidrow,
            base.join(app_id)
                .join("SteamEmu")
                .join("UserStats")
                .join("achiev.ini"),
        );
    }

    // CreamAPI
    push(
        Cracker::CreamApi,
        dirs.app_data
            .join("CreamAPI")
            .join(app_id)
            .join("stats")
            .join("CreamAPI.Achievements.cfg"),
    );

    // SmartSteamEmu
    push(
        Cracker::SmartSteamEmu,
        dirs.app_data
            .join("SmartSteamEmu")
            .join(app_id)
            .join("User")
            .join("Achievements.ini"),
    );

    // RLE
    push(
        Cracker::Rle,
        dirs.app_data.join("RLE").join(app_id).join("achievements.ini"),
    );

    // Razor1911
    push(
        Cracker::Razor1911,
        dirs.app_data.join(".1911").join(app_id).join("achievement"),
    );

    // Formatos que moram ao lado do executável do jogo.
    if let Some(exe_dir) = exe_path.and_then(|p| p.parent()) {
        push(
            Cracker::UserStats,
            exe_dir.join("SteamData").join("user_stats.ini"),
        );
        push(
            Cracker::ThreeDm,
            exe_dir
                .join("3DMGAME")
                .join("Player")
                .join("stats")
                .join("achievements.ini"),
        );
    }

    out
}
