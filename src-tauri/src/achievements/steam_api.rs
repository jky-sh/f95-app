//! Acesso à Steam para obter o schema de achievements de um jogo.
//!
//! Duas estratégias:
//!
//! 1. **Com Steam Web API key** (opcional, settings): `GetSchemaForGame` —
//!    dados exatos e localizados, incluindo a flag `hidden` e o ícone cinza.
//! 2. **Sem key** (padrão): combina dois endpoints públicos que retornam a
//!    lista na MESMA ordenação (percentual global desc):
//!    - `GetGlobalAchievementPercentagesForApp` → api names + % global;
//!    - página `steamcommunity.com/stats/<appid>/achievements` → nome de
//!      exibição, descrição e ícone colorido.
//!    O zip por índice é validado comparando os percentuais dos dois lados.
//!
//! Também expõe a busca do catálogo (storesearch) e a detecção de appid a
//! partir de arquivos de configuração de crack no diretório do jogo.

use std::path::Path;
use std::time::Duration;

use crate::error::AppError;
use reqwest::Client;
use serde::Serialize;

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamAchievementSchemaEntry {
    pub api_name: String,
    pub display_name: String,
    pub description: String,
    pub icon_url: String,
    pub icon_gray_url: String,
    pub hidden: bool,
    pub global_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSearchResult {
    pub app_id: String,
    pub name: String,
}

fn client() -> Result<Client, AppError> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| AppError::Other(format!("steam client: {e}")))
}

/// (api_name, percent) na ordem retornada pela Steam (percent desc).
async fn fetch_global_percentages(
    client: &Client,
    app_id: &str,
) -> Result<Vec<(String, f64)>, AppError> {
    let url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid={app_id}&format=json"
    );
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("steam percentuais: {e}")))?;
    // Jogo sem achievements (ou appid inválido) responde 403/400 aqui.
    if !res.status().is_success() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value = res
        .json()
        .await
        .map_err(|e| AppError::Other(format!("steam percentuais json: {e}")))?;
    let Some(list) = value
        .pointer("/achievementpercentages/achievements")
        .and_then(|v| v.as_array())
    else {
        return Ok(Vec::new());
    };
    let mut out = Vec::with_capacity(list.len());
    for entry in list {
        let Some(name) = entry.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        // `percent` já veio como string e como número em épocas diferentes da API.
        let percent = entry
            .get("percent")
            .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .unwrap_or(0.0);
        out.push((name.to_string(), percent));
    }
    Ok(out)
}

/// `GetSchemaForGame` (requer API key). Retorna na ordem definida pelo dev.
async fn fetch_schema_with_key(
    client: &Client,
    app_id: &str,
    language: &str,
    api_key: &str,
) -> Result<Vec<SteamAchievementSchemaEntry>, AppError> {
    let url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key={api_key}&appid={app_id}&l={language}"
    );
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("steam schema: {e}")))?;
    if res.status().as_u16() == 403 {
        return Err(AppError::Other(
            "Steam API key inválida (HTTP 403). Verifique a key nas configurações.".into(),
        ));
    }
    if !res.status().is_success() {
        return Err(AppError::Other(format!(
            "steam schema: HTTP {}",
            res.status()
        )));
    }
    let value: serde_json::Value = res
        .json()
        .await
        .map_err(|e| AppError::Other(format!("steam schema json: {e}")))?;
    let Some(list) = value
        .pointer("/game/availableGameStats/achievements")
        .and_then(|v| v.as_array())
    else {
        return Ok(Vec::new());
    };
    let mut out = Vec::with_capacity(list.len());
    for entry in list {
        let Some(name) = entry.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        out.push(SteamAchievementSchemaEntry {
            api_name: name.to_string(),
            display_name: entry
                .get("displayName")
                .and_then(|v| v.as_str())
                .unwrap_or(name)
                .to_string(),
            description: entry
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            icon_url: entry
                .get("icon")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            icon_gray_url: entry
                .get("icongray")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            hidden: entry.get("hidden").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
            global_percent: None,
        });
    }
    Ok(out)
}

fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

/// Extrai o conteúdo entre `open`..`close` a partir de `from`, sem regex.
fn slice_between<'a>(hay: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = hay.find(open)? + open.len();
    let end = hay[start..].find(close)? + start;
    Some(&hay[start..end])
}

struct ScrapedAchievement {
    display_name: String,
    description: String,
    icon_url: String,
    percent: Option<f64>,
}

/// Raspa a página de conquistas globais da comunidade (lista TODAS as
/// conquistas, inclusive ocultas, ordenadas por % desc — mesma ordenação do
/// endpoint de percentuais).
async fn scrape_community_achievements(
    client: &Client,
    app_id: &str,
    language: &str,
) -> Result<Vec<ScrapedAchievement>, AppError> {
    let url = format!(
        "https://steamcommunity.com/stats/{app_id}/achievements/?l={language}"
    );
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("steam community: {e}")))?;
    if !res.status().is_success() {
        return Ok(Vec::new());
    }
    let body = res
        .text()
        .await
        .map_err(|e| AppError::Other(format!("steam community body: {e}")))?;

    let mut out = Vec::new();
    for chunk in body.split("class=\"achieveRow").skip(1) {
        // Cada bloco: img (ícone), achievePercent, h3 (nome), h5 (descrição).
        let icon_url = slice_between(chunk, "src=\"", "\"")
            .map(html_decode)
            .unwrap_or_default();
        let percent = slice_between(chunk, "achievePercent\">", "<")
            .and_then(|p| p.trim().trim_end_matches('%').parse::<f64>().ok());
        let display_name = slice_between(chunk, "<h3>", "</h3>")
            .map(|s| html_decode(s.trim()))
            .unwrap_or_default();
        let description = slice_between(chunk, "<h5>", "</h5>")
            .map(|s| html_decode(s.trim()))
            .unwrap_or_default();
        out.push(ScrapedAchievement {
            display_name,
            description,
            icon_url,
            percent,
        });
    }
    Ok(out)
}

/// Busca o schema completo. `api_key` opcional; sem ela usa o caminho público.
pub async fn fetch_schema(
    app_id: &str,
    language: &str,
    api_key: Option<&str>,
) -> Result<Vec<SteamAchievementSchemaEntry>, AppError> {
    let client = client()?;
    let percentages = fetch_global_percentages(&client, app_id).await?;

    if let Some(key) = api_key.map(str::trim).filter(|k| !k.is_empty()) {
        let mut schema = fetch_schema_with_key(&client, app_id, language, key).await?;
        let percent_map: std::collections::HashMap<&str, f64> = percentages
            .iter()
            .map(|(name, pct)| (name.as_str(), *pct))
            .collect();
        for entry in &mut schema {
            entry.global_percent = percent_map.get(entry.api_name.as_str()).copied();
        }
        return Ok(schema);
    }

    if percentages.is_empty() {
        // Sem key não há como distinguir "sem achievements" de "appid errado";
        // devolve vazio e o frontend mostra o estado "sem conquistas Steam".
        return Ok(Vec::new());
    }

    let scraped = scrape_community_achievements(&client, app_id, language).await?;

    if scraped.len() == percentages.len() {
        // Ambas as listas vêm ordenadas por % global desc a partir dos mesmos
        // dados — zip por índice. Os percentuais dos dois lados servem de
        // checagem de sanidade (a página arredonda para 1 casa decimal).
        let mismatches = scraped
            .iter()
            .zip(percentages.iter())
            .filter(|(s, (_, pct))| {
                s.percent
                    .map(|sp| (sp - ((pct * 10.0).round() / 10.0)).abs() > 0.2)
                    .unwrap_or(false)
            })
            .count();
        if mismatches * 10 <= scraped.len() {
            return Ok(scraped
                .into_iter()
                .zip(percentages)
                .map(|(s, (api_name, pct))| SteamAchievementSchemaEntry {
                    api_name,
                    display_name: s.display_name,
                    description: s.description,
                    icon_url: s.icon_url,
                    icon_gray_url: String::new(),
                    hidden: false,
                    global_percent: Some(pct),
                })
                .collect());
        }
        eprintln!(
            "[achievements] percentuais divergentes demais ({mismatches}/{}) para appid {app_id} — usando fallback",
            scraped.len()
        );
    }

    // Fallback degradado: só api names + percentuais (sem nome bonito/ícone).
    Ok(percentages
        .into_iter()
        .map(|(api_name, pct)| SteamAchievementSchemaEntry {
            display_name: api_name.clone(),
            api_name,
            description: String::new(),
            icon_url: String::new(),
            icon_gray_url: String::new(),
            hidden: false,
            global_percent: Some(pct),
        })
        .collect())
}

/// Busca jogos no catálogo da Steam pelo nome (endpoint público storesearch).
pub async fn search_games(term: &str) -> Result<Vec<SteamSearchResult>, AppError> {
    let client = client()?;
    let url = format!(
        "https://store.steampowered.com/api/storesearch/?term={}&l=english&cc=US",
        urlencode(term)
    );
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("steam busca: {e}")))?;
    if !res.status().is_success() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value = res
        .json()
        .await
        .map_err(|e| AppError::Other(format!("steam busca json: {e}")))?;
    let Some(items) = value.get("items").and_then(|v| v.as_array()) else {
        return Ok(Vec::new());
    };
    Ok(items
        .iter()
        .filter_map(|item| {
            let id = item.get("id").and_then(|v| v.as_i64())?;
            let name = item.get("name").and_then(|v| v.as_str())?;
            Some(SteamSearchResult {
                app_id: id.to_string(),
                name: name.to_string(),
            })
        })
        .collect())
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Nomes de arquivo de configuração de crack que costumam carregar o appid.
const APPID_TXT_FILES: [&str; 1] = ["steam_appid.txt"];
const APPID_INI_FILES: [&str; 5] = [
    "steam_emu.ini",
    "coldclientloader.ini",
    "onlinefix.ini",
    "steamconfig.ini",
    "valve.ini",
];

/// Tenta descobrir o appid Steam vasculhando o diretório de instalação do
/// jogo por arquivos de configuração dos cracks (Goldberg, ALI213, OnlineFix…).
/// 480 (Spacewar, o appid de testes) é ignorado.
pub fn detect_appid(install_path: Option<&Path>, exe_path: Option<&Path>) -> Option<String> {
    let mut roots: Vec<&Path> = Vec::new();
    if let Some(dir) = exe_path.and_then(|p| p.parent()) {
        roots.push(dir);
    }
    if let Some(dir) = install_path {
        if !roots.iter().any(|r| *r == dir) {
            roots.push(dir);
        }
    }

    for root in roots {
        let mut visited = 0usize;
        for entry in walkdir::WalkDir::new(root)
            .max_depth(3)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            visited += 1;
            if visited > 4000 {
                break;
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if APPID_TXT_FILES.contains(&name.as_str()) {
                if let Some(id) = read_appid_txt(entry.path()) {
                    return Some(id);
                }
            } else if APPID_INI_FILES.contains(&name.as_str()) {
                if let Some(id) = read_appid_from_ini(entry.path()) {
                    return Some(id);
                }
            }
        }
    }
    None
}

fn valid_appid(id: &str) -> bool {
    !id.is_empty() && id != "480" && id.len() <= 9 && id.chars().all(|c| c.is_ascii_digit())
}

fn read_appid_txt(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let id = content.trim().to_string();
    valid_appid(&id).then_some(id)
}

fn read_appid_from_ini(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    // Preferência: RealAppId (OnlineFix) > AppId genérico.
    let mut fallback: Option<String> = None;
    for line in content.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim().to_lowercase();
        let value = value.trim().to_string();
        if !valid_appid(&value) {
            continue;
        }
        if key == "realappid" {
            return Some(value);
        }
        if key.ends_with("appid") && fallback.is_none() {
            fallback = Some(value);
        }
    }
    fallback
}
