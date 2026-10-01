//! Integração de achievements Steam (estilo Hydra Launcher).
//!
//! - `finder`: onde cada crack/emulador grava o arquivo de achievements;
//! - `parser`: como ler cada formato (INI/JSON/texto/pasta);
//! - `watcher`: polling + diff + evento `achievement:sync`;
//! - `steam_api`: schema de conquistas (nome/descrição/ícone/%) da Steam.
//!
//! O SQLite é território do frontend (plugin SQL); este módulo só observa o
//! disco, fala com a Steam e emite eventos.

pub mod finder;
pub mod parser;
pub mod savescan;
pub mod steam_api;
pub mod watcher;

pub use watcher::{WatchedGameConfig, Watcher};

/// Crack/emulador que originou um arquivo de achievements.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Cracker {
    Codex,
    Rune,
    OnlineFix,
    Goldberg,
    Rld,
    Empress,
    Skidrow,
    CreamApi,
    SmartSteamEmu,
    Rle,
    Razor1911,
    UserStats,
    ThreeDm,
    Flt,
}

impl Cracker {
    pub fn as_str(&self) -> &'static str {
        match self {
            Cracker::Codex => "CODEX",
            Cracker::Rune => "RUNE",
            Cracker::OnlineFix => "OnlineFix",
            Cracker::Goldberg => "Goldberg",
            Cracker::Rld => "RLD!",
            Cracker::Empress => "EMPRESS",
            Cracker::Skidrow => "SKIDROW",
            Cracker::CreamApi => "CreamAPI",
            Cracker::SmartSteamEmu => "SmartSteamEmu",
            Cracker::Rle => "RLE",
            Cracker::Razor1911 => "Razor1911",
            Cracker::UserStats => "UserStats",
            Cracker::ThreeDm => "3DM",
            Cracker::Flt => "FLT",
        }
    }
}
