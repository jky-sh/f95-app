//! Parsers para arquivos de achievements gravados por emuladores/cracks Steam.
//!
//! Cada emulador grava o progresso num formato próprio (INI, JSON, texto ou
//! até uma pasta com um arquivo por conquista). A lógica é um port fiel do
//! parse-achievement-file.ts do Hydra Launcher, que é a referência de fato
//! para esses formatos. Todos os parsers são tolerantes: linha/entrada
//! inválida é ignorada, erro de leitura vira lista vazia no chamador.

use std::collections::HashMap;
use std::path::Path;

use super::Cracker;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockedAchievement {
    /// API name da conquista (a chave usada pela Steam, ex.: "EPISODE1").
    pub api_name: String,
    /// Epoch em milissegundos. None quando o formato não guarda horário.
    pub unlock_time: Option<i64>,
    /// Qual cracker/emulador originou o unlock.
    pub source: &'static str,
}

pub fn parse_achievement_file(path: &Path, cracker: Cracker) -> Vec<UnlockedAchievement> {
    let result = std::panic::catch_unwind(|| parse_inner(path, cracker));
    match result {
        Ok(list) => list,
        Err(_) => Vec::new(),
    }
}

fn parse_inner(path: &Path, cracker: Cracker) -> Vec<UnlockedAchievement> {
    match cracker {
        Cracker::Codex | Cracker::Rune | Cracker::SmartSteamEmu | Cracker::Rle => {
            process_default(&ini_parse(path), cracker)
        }
        Cracker::OnlineFix => process_online_fix(&ini_parse(path)),
        Cracker::Goldberg | Cracker::Empress => process_goldberg(path, cracker),
        Cracker::UserStats => process_user_stats(&ini_parse(path)),
        Cracker::Rld => process_rld(&ini_parse(path)),
        Cracker::Skidrow => process_skidrow(&ini_parse(path)),
        Cracker::ThreeDm => process_3dm(&ini_parse(path)),
        Cracker::CreamApi => process_cream_api(&ini_parse(path)),
        Cracker::Razor1911 => process_razor1911(path),
        Cracker::Flt => process_flt(path),
    }
}

type IniMap = HashMap<String, HashMap<String, String>>;

/// Parser INI minimalista idêntico ao do Hydra: remove BOM, ignora linhas
/// vazias e comentários `###`, seções `[nome]`, pares `chave=valor` (o valor
/// pode conter `=`).
fn ini_parse(path: &Path) -> IniMap {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return IniMap::new();
    };
    let content = raw.strip_prefix('\u{feff}').unwrap_or(&raw);

    let mut map = IniMap::new();
    let mut section = String::new();
    for line in content.split(['\r', '\n']) {
        if line.is_empty() || line.starts_with("###") {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].to_string();
            map.entry(section.clone()).or_default();
        } else if let Some((key, value)) = line.split_once('=') {
            map.entry(section.clone())
                .or_default()
                .insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    map
}

/// Converte um timestamp textual em epoch-ms seguindo a heurística do Hydra:
/// valores de 7 dígitos são epoch/1000 (OnlineFix/CreamAPI), o resto é epoch
/// em segundos.
fn epoch_field_to_ms(value: &str) -> Option<i64> {
    let trimmed = value.trim();
    let n: f64 = trimmed.parse().ok()?;
    if n <= 0.0 {
        return None;
    }
    let ms = if trimmed.len() == 7 {
        n * 1000.0 * 1000.0
    } else {
        n * 1000.0
    };
    Some(ms as i64)
}

fn seconds_to_ms(n: f64) -> Option<i64> {
    if n <= 0.0 {
        None
    } else {
        Some((n * 1000.0) as i64)
    }
}

/// CODEX / RUNE / SmartSteamEmu / RLE: seção por conquista com
/// `Achieved=1` + `UnlockTime=<segundos>`.
fn process_default(ini: &IniMap, cracker: Cracker) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, fields) in ini {
        if fields.get("Achieved").map(String::as_str) == Some("1") {
            let unlock_time = fields
                .get("UnlockTime")
                .and_then(|v| v.parse::<f64>().ok())
                .and_then(seconds_to_ms);
            out.push(UnlockedAchievement {
                api_name: name.clone(),
                unlock_time,
                source: cracker.as_str(),
            });
        }
    }
    out
}

/// OnlineFix: `achieved=true` + `timestamp`, ou `Achieved=true` + `TimeUnlocked`.
fn process_online_fix(ini: &IniMap) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, fields) in ini {
        let lower = fields.get("achieved").map(|v| v.trim().to_lowercase());
        let upper = fields.get("Achieved").map(|v| v.trim().to_lowercase());
        if lower.as_deref() == Some("true") {
            out.push(UnlockedAchievement {
                api_name: name.clone(),
                unlock_time: fields.get("timestamp").and_then(|v| epoch_field_to_ms(v)),
                source: Cracker::OnlineFix.as_str(),
            });
        } else if upper.as_deref() == Some("true") {
            out.push(UnlockedAchievement {
                api_name: name.clone(),
                unlock_time: fields
                    .get("TimeUnlocked")
                    .and_then(|v| epoch_field_to_ms(v)),
                source: Cracker::OnlineFix.as_str(),
            });
        }
    }
    out
}

/// CreamAPI: `achieved=true` + `unlocktime` (regra dos 7 dígitos).
fn process_cream_api(ini: &IniMap) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, fields) in ini {
        if fields
            .get("achieved")
            .map(|v| v.trim().eq_ignore_ascii_case("true"))
            .unwrap_or(false)
        {
            out.push(UnlockedAchievement {
                api_name: name.clone(),
                unlock_time: fields.get("unlocktime").and_then(|v| epoch_field_to_ms(v)),
                source: Cracker::CreamApi.as_str(),
            });
        }
    }
    out
}

/// Goldberg/GSE e EMPRESS: JSON, ou como array `[{name, earned, earned_time}]`
/// ou como objeto `{ "ACH": { earned, earned_time } }`.
fn process_goldberg(path: &Path, cracker: Cracker) -> Vec<UnlockedAchievement> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let mut out = Vec::new();

    let mut push = |name: Option<&str>, entry: &serde_json::Value| {
        let earned = entry
            .get("earned")
            .map(|v| v.as_bool().unwrap_or(false) || v.as_str() == Some("true"))
            .unwrap_or(false);
        if !earned {
            return;
        }
        let Some(name) = name else { return };
        let unlock_time = entry
            .get("earned_time")
            .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .and_then(seconds_to_ms);
        out.push(UnlockedAchievement {
            api_name: name.to_string(),
            unlock_time,
            source: cracker.as_str(),
        });
    };

    if let Some(arr) = value.as_array() {
        for entry in arr {
            let name = entry.get("name").and_then(|v| v.as_str());
            push(name, entry);
        }
    } else if let Some(obj) = value.as_object() {
        for (name, entry) in obj {
            push(Some(name.as_str()), entry);
        }
    }
    out
}

/// SKIDROW: seção `[Achievements]`, valor `1@...@<segundos>`.
fn process_skidrow(ini: &IniMap) -> Vec<UnlockedAchievement> {
    let Some(achievements) = ini.get("Achievements") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (name, value) in achievements {
        let parts: Vec<&str> = value.split('@').collect();
        if parts.first().copied() == Some("1") {
            let unlock_time = parts
                .last()
                .and_then(|v| v.parse::<f64>().ok())
                .and_then(seconds_to_ms);
            out.push(UnlockedAchievement {
                api_name: name.clone(),
                unlock_time,
                source: Cracker::Skidrow.as_str(),
            });
        }
    }
    out
}

/// Decodifica um u32 little-endian gravado como string hex (formato RLD!/3DM).
fn hex_le_u32(value: &str) -> Option<u32> {
    let bytes = hex_decode(value.trim())?;
    if bytes.len() < 4 {
        return None;
    }
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// RLD!: seção por conquista (exceto `[Steam]`) com `State`/`Time` em hex LE.
fn process_rld(ini: &IniMap) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, fields) in ini {
        if name == "Steam" {
            continue;
        }
        let Some(state) = fields.get("State") else {
            continue;
        };
        if hex_le_u32(state) == Some(1) {
            let unlock_time = fields
                .get("Time")
                .and_then(|v| hex_le_u32(v))
                .and_then(|secs| seconds_to_ms(secs as f64));
            out.push(UnlockedAchievement {
                api_name: name.clone(),
                unlock_time,
                source: Cracker::Rld.as_str(),
            });
        }
    }
    out
}

/// 3DM: seções `[State]` (`0101` = desbloqueada) e `[Time]` (hex LE, segundos).
fn process_3dm(ini: &IniMap) -> Vec<UnlockedAchievement> {
    let Some(states) = ini.get("State") else {
        return Vec::new();
    };
    let times = ini.get("Time");
    let mut out = Vec::new();
    for (name, state) in states {
        if state.trim() == "0101" {
            let unlock_time = times
                .and_then(|t| t.get(name))
                .and_then(|v| hex_le_u32(v))
                .and_then(|secs| seconds_to_ms(secs as f64));
            out.push(UnlockedAchievement {
                api_name: name.clone(),
                unlock_time,
                source: Cracker::ThreeDm.as_str(),
            });
        }
    }
    out
}

/// UserStats (`SteamData/user_stats.ini`): seção `[ACHIEVEMENTS]` com valores
/// `"{unlocked = true, time = <segundos>}"`.
fn process_user_stats(ini: &IniMap) -> Vec<UnlockedAchievement> {
    let Some(achievements) = ini.get("ACHIEVEMENTS") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (name, value) in achievements {
        let value = value.trim();
        if value.len() < 2 {
            continue;
        }
        let inner = &value[1..value.len() - 1];
        let time_str = inner.replace("unlocked = true, time = ", "");
        if let Ok(secs) = time_str.trim().parse::<f64>() {
            if let Some(unlock_time) = seconds_to_ms(secs) {
                out.push(UnlockedAchievement {
                    api_name: name.replace('"', ""),
                    unlock_time: Some(unlock_time),
                    source: Cracker::UserStats.as_str(),
                });
            }
        }
    }
    out
}

/// Razor1911 (`.1911/<appid>/achievement`): linhas `nome desbloqueada epoch`.
fn process_razor1911(path: &Path) -> Vec<UnlockedAchievement> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let content = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    let mut out = Vec::new();
    for line in content.split(['\r', '\n']) {
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split(' ');
        let (Some(name), Some(unlocked), time) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        if unlocked == "1" {
            let unlock_time = time
                .and_then(|v| v.parse::<f64>().ok())
                .and_then(seconds_to_ms);
            out.push(UnlockedAchievement {
                api_name: name.to_string(),
                unlock_time,
                source: Cracker::Razor1911.as_str(),
            });
        }
    }
    out
}

/// FLT: a "conquista" é um arquivo dentro da pasta; o nome do arquivo é o
/// api_name e não há timestamp.
fn process_flt(dir: &Path) -> Vec<UnlockedAchievement> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .map(|name| UnlockedAchievement {
            api_name: name,
            unlock_time: None,
            source: Cracker::Flt.as_str(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_temp(name: &str, content: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("f95_ach_parser_tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn codex_ini_com_bom() {
        let path = write_temp(
            "codex.ini",
            "\u{feff}[SteamAchievements]\nTotal=2\n[EPISODE1]\nAchieved=1\nUnlockTime=1754500000\n[EPISODE2]\nAchieved=0\nUnlockTime=0\n",
        );
        let got = parse_achievement_file(&path, Cracker::Codex);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].api_name, "EPISODE1");
        assert_eq!(got[0].unlock_time, Some(1_754_500_000_000));
    }

    #[test]
    fn goldberg_json_objeto_e_array() {
        let obj = write_temp(
            "goldberg_obj.json",
            r#"{"ACH_A":{"earned":true,"earned_time":1700000000},"ACH_B":{"earned":false,"earned_time":0}}"#,
        );
        let got = parse_achievement_file(&obj, Cracker::Goldberg);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].api_name, "ACH_A");
        assert_eq!(got[0].unlock_time, Some(1_700_000_000_000));

        let arr = write_temp(
            "goldberg_arr.json",
            r#"[{"name":"ACH_C","earned":true,"earned_time":1700000001}]"#,
        );
        let got = parse_achievement_file(&arr, Cracker::Empress);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].api_name, "ACH_C");
    }

    #[test]
    fn onlinefix_sete_digitos() {
        // 7 dígitos = epoch/1000 (heurística do Hydra): 1754500 → 1754500000000 ms.
        let path = write_temp(
            "onlinefix.ini",
            "[ACH_X]\nachieved=true\ntimestamp=1754500\n",
        );
        let got = parse_achievement_file(&path, Cracker::OnlineFix);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].unlock_time, Some(1_754_500_000_000));
    }

    #[test]
    fn rld_hex_little_endian() {
        // 01000000 LE = 1 (desbloqueada); 00E1F565 LE = 0x65F5E100 = 1710612736 s.
        let path = write_temp(
            "rld.ini",
            "[Steam]\nAppId=123\n[ACH_R]\nState=01000000\nTime=00E1F565\n",
        );
        let got = parse_achievement_file(&path, Cracker::Rld);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].api_name, "ACH_R");
        assert_eq!(got[0].unlock_time, Some(1_710_612_736_000));
    }

    #[test]
    fn skidrow_formato_arroba() {
        let path = write_temp(
            "skidrow.ini",
            "[Achievements]\nACH_S=1@extra@1700000000\nACH_T=0@extra@1700000000\n",
        );
        let got = parse_achievement_file(&path, Cracker::Skidrow);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].api_name, "ACH_S");
    }

    #[test]
    fn arquivo_corrompido_nao_explode() {
        let path = write_temp("lixo.json", "{{{{ nada disso é json");
        assert!(parse_achievement_file(&path, Cracker::Goldberg).is_empty());
        let path2 = write_temp("lixo.ini", "César=🎮\n=\n[");
        assert!(parse_achievement_file(&path2, Cracker::Codex).is_empty());
    }
}
