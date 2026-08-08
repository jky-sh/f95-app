/**
 * Repositório da integração de achievements Steam (estilo Hydra).
 *
 * O Rust observa os arquivos dos cracks e emite `achievement:sync`; este
 * módulo é o dono das tabelas `steam_achievements` (cache de schema por
 * appid) e `steam_achievement_unlocks` (histórico por thread_id), e de
 * reconfigurar o watcher quando os vínculos mudam.
 */
import { execute, query } from './db';
import * as ipc from './ipc';
import * as library from './library';
import * as settings from './settings';
import type { SteamAchievement, SteamAchievementStats } from '../types/achievements';
import type { Locale } from './i18n';

/** Evento (frontend → todas as janelas) após persistir unlocks/schema. */
export const ACHIEVEMENTS_UPDATED_EVENT = 'achievements:updated';

/** Idade máxima do cache de schema antes de rebuscar da Steam. */
const SCHEMA_TTL_DAYS = 7;

interface SchemaRow {
  steam_appid: string;
  api_name: string;
  display_name: string;
  description: string | null;
  icon_url: string | null;
  icon_gray_url: string | null;
  hidden: number;
  global_percent: number | null;
  sort_order: number;
  language: string;
  fetched_at: string;
}

interface UnlockRow {
  thread_id: string;
  api_name: string;
  unlock_time: number | null;
  source: string | null;
}

/** Locale do app → código de idioma da Steam. */
export function steamLanguage(locale: Locale): string {
  switch (locale) {
    case 'pt':
      return 'brazilian';
    case 'de':
      return 'german';
    case 'ru':
      return 'russian';
    default:
      return 'english';
  }
}

/** Fetches de schema em voo, por `${appId}:${language}` — o boot (warm-up),
 *  a página da biblioteca e a da loja podem pedir o mesmo schema ao mesmo
 *  tempo; sem dedup, as reescritas concorrentes se intercalam e uma leitura
 *  no meio vê a tabela vazia. */
const schemaInFlight = new Map<string, Promise<void>>();
/** Schemas já validados nesta sessão — evita re-checar TTL/refetch a cada
 *  visita de página (inclusive para jogos sem nenhuma conquista). */
const schemaFreshThisSession = new Set<string>();

/**
 * Garante que o schema do appid está no cache (busca da Steam quando não
 * existe, expirou ou o idioma mudou). Deduplicada em voo; silenciosamente
 * mantém o cache local em falha de rede ou resposta vazia transiente.
 */
export async function ensureSchema(
  appId: string,
  locale: Locale,
  opts: { force?: boolean } = {},
): Promise<void> {
  const language = steamLanguage(locale);
  const key = `${appId}:${language}`;
  if (!opts.force) {
    if (schemaFreshThisSession.has(key)) return;
    const inFlight = schemaInFlight.get(key);
    if (inFlight) return inFlight;
  }
  const task = doEnsureSchema(appId, language, opts.force ?? false)
    .then(() => {
      schemaFreshThisSession.add(key);
    })
    .finally(() => {
      schemaInFlight.delete(key);
    });
  schemaInFlight.set(key, task);
  return task;
}

async function doEnsureSchema(
  appId: string,
  language: string,
  force: boolean,
): Promise<void> {
  const rows = await query<{ language: string; fetched_at: string; n: number }>(
    `SELECT language, MAX(fetched_at) AS fetched_at, COUNT(*) AS n
       FROM steam_achievements WHERE steam_appid = ?`,
    [appId],
  );
  const cached = rows[0];
  const hasCache = (cached?.n ?? 0) > 0;
  if (!force && hasCache && cached!.language === language) {
    const ageMs = Date.now() - new Date(cached!.fetched_at + 'Z').getTime();
    if (ageMs < SCHEMA_TTL_DAYS * 24 * 3600 * 1000) return;
  }

  let entries: ipc.SteamAchievementSchemaEntry[];
  try {
    const apiKey = await settings.get(settings.KEY_STEAM_API_KEY);
    entries = await ipc.steamFetchAchievementSchema({ appId, language, apiKey });
  } catch (err) {
    if (hasCache) {
      console.warn('[achievements] refresh do schema falhou, usando cache', err);
      return;
    }
    throw err;
  }

  // Resposta vazia com cache existente = quase sempre hiccup da Steam, não
  // "o jogo perdeu as conquistas" — nunca troque dados bons por nada.
  if (entries.length === 0 && hasCache) {
    console.warn('[achievements] Steam retornou schema vazio; mantendo cache');
    return;
  }

  await execute(`DELETE FROM steam_achievements WHERE steam_appid = ?`, [appId]);
  // Inserção em lotes: 128 execute() individuais eram ~128 roundtrips de IPC
  // e deixavam a tabela parcialmente escrita por segundos.
  const CHUNK = 50; // 10 parâmetros por linha, folga sob o limite de 999
  for (let start = 0; start < entries.length; start += CHUNK) {
    const chunk = entries.slice(start, start + CHUNK);
    const placeholders = chunk
      .map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .join(', ');
    const values: unknown[] = [];
    chunk.forEach((e, j) => {
      values.push(
        appId,
        e.apiName,
        e.displayName,
        e.description,
        e.iconUrl,
        e.iconGrayUrl,
        e.hidden ? 1 : 0,
        e.globalPercent,
        start + j,
        language,
      );
    });
    await execute(
      `INSERT INTO steam_achievements
         (steam_appid, api_name, display_name, description, icon_url, icon_gray_url,
          hidden, global_percent, sort_order, language, fetched_at)
       VALUES ${placeholders}
       ON CONFLICT(steam_appid, api_name) DO UPDATE SET
         display_name = excluded.display_name,
         description = excluded.description,
         icon_url = excluded.icon_url,
         icon_gray_url = excluded.icon_gray_url,
         hidden = excluded.hidden,
         global_percent = excluded.global_percent,
         sort_order = excluded.sort_order,
         language = excluded.language,
         fetched_at = excluded.fetched_at`,
      values,
    );
  }
}

/**
 * Lista combinada schema + unlocks de um jogo. Desbloqueadas primeiro
 * (mais recentes no topo), depois bloqueadas por raridade (mais comuns
 * primeiro), imitando a página de conquistas da Steam.
 */
export async function listForGame(
  threadId: string,
  appId: string,
): Promise<SteamAchievement[]> {
  const [schemaRows, unlockRows] = await Promise.all([
    query<SchemaRow>(
      `SELECT * FROM steam_achievements WHERE steam_appid = ? ORDER BY sort_order ASC`,
      [appId],
    ),
    listUnlockRows(threadId),
  ]);
  const unlocks = new Map(
    unlockRows.map((u) => [u.api_name.toUpperCase(), u] as const),
  );

  const list: SteamAchievement[] = schemaRows.map((r) => {
    const unlock = unlocks.get(r.api_name.toUpperCase());
    return {
      apiName: r.api_name,
      displayName: r.display_name,
      description: r.description ?? '',
      iconUrl: r.icon_url ?? '',
      iconGrayUrl: r.icon_gray_url ?? '',
      hidden: r.hidden !== 0,
      globalPercent: r.global_percent,
      unlocked: !!unlock,
      unlockTime: unlock?.unlock_time ?? null,
    };
  });

  return list.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    if (a.unlocked) return (b.unlockTime ?? 0) - (a.unlockTime ?? 0);
    return (b.globalPercent ?? 0) - (a.globalPercent ?? 0);
  });
}

async function listUnlockRows(threadId: string): Promise<UnlockRow[]> {
  return query<UnlockRow>(
    `SELECT * FROM steam_achievement_unlocks WHERE thread_id = ?`,
    [threadId],
  );
}

export async function getStats(
  threadId: string,
  appId: string,
): Promise<SteamAchievementStats> {
  const rows = await query<{ total: number; unlocked: number }>(
    `SELECT
       (SELECT COUNT(*) FROM steam_achievements WHERE steam_appid = ?) AS total,
       (SELECT COUNT(*) FROM steam_achievement_unlocks u
         WHERE u.thread_id = ?
           AND EXISTS (SELECT 1 FROM steam_achievements s
                        WHERE s.steam_appid = ? AND UPPER(s.api_name) = UPPER(u.api_name))
       ) AS unlocked`,
    [appId, threadId, appId],
  );
  return { total: rows[0]?.total ?? 0, unlocked: rows[0]?.unlocked ?? 0 };
}

/**
 * Persiste unlocks vindos do watcher. Retorna os api_names que eram REALMENTE
 * novos (não existiam na tabela) — é essa lista que gera toast/notificação.
 */
export async function recordUnlocks(
  threadId: string,
  entries: { apiName: string; unlockTime: number | null; source: string }[],
): Promise<string[]> {
  if (entries.length === 0) return [];
  const existing = await listUnlockRows(threadId);
  const known = new Set(existing.map((u) => u.api_name.toUpperCase()));
  const fresh = entries.filter((e) => !known.has(e.apiName.toUpperCase()));
  for (const e of fresh) {
    await execute(
      `INSERT OR IGNORE INTO steam_achievement_unlocks
         (thread_id, api_name, unlock_time, source, synced_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [threadId, e.apiName, e.unlockTime, e.source],
    );
  }
  return fresh.map((e) => e.apiName);
}

/** Apaga o vínculo e o histórico de unlocks de um jogo (o cache de schema
 *  fica — outro jogo pode apontar para o mesmo appid). Grava `''` (e não
 *  NULL) para marcar "desvinculado pelo usuário": a autodetecção só roda
 *  quando o campo é NULL, então um unlink manual não é re-vinculado sozinho. */
export async function unlink(threadId: string): Promise<void> {
  await library.setSteamAppid(threadId, '');
  await execute(`DELETE FROM steam_achievement_unlocks WHERE thread_id = ?`, [
    threadId,
  ]);
  await syncWatcher();
}

/** Reenvia ao Rust a lista de jogos com appid — o conjunto observado. Para
 *  jogos com save-scan ativo, envia junto os nomes do schema (o Rust não lê
 *  o SQLite). */
export async function syncWatcher(): Promise<void> {
  const games = await library.listWithSteamAppid();
  const configs: ipc.AchievementWatchConfig[] = [];
  for (const g of games) {
    let achievementNames: { apiName: string; displayName: string }[] | undefined;
    if (g.achSaveScan) {
      const rows = await query<{ api_name: string; display_name: string }>(
        `SELECT api_name, display_name FROM steam_achievements WHERE steam_appid = ?`,
        [g.steamAppid],
      );
      achievementNames = rows.map((r) => ({
        apiName: r.api_name,
        displayName: r.display_name,
      }));
    }
    configs.push({
      threadId: g.threadId,
      appId: g.steamAppid!,
      exePath: g.exePath,
      installPath: g.installPath,
      title: g.title,
      saveScan: g.achSaveScan,
      achievementNames,
    });
  }
  await ipc.achievementsConfigure(configs);
}

/** Extrai um appid de um texto: número puro ou URL da loja/steamdb. */
export function parseAppidInput(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{1,9}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(
    /(?:store\.steampowered\.com|steamdb\.info)\/app\/(\d+)/i,
  );
  return match ? match[1] : null;
}

/** Procura um link de loja Steam nos metadados do thread F95 (links sociais
 *  e descrição) — jogos F95 com release na Steam costumam linkar. */
export function findAppidInStoreDetail(detail: {
  social?: { url: string }[];
  descriptionHtml?: string | null;
} | null): string | null {
  if (!detail) return null;
  for (const link of detail.social ?? []) {
    const id = parseAppidInput(link.url);
    if (id) return id;
  }
  const match = detail.descriptionHtml?.match(
    /store\.steampowered\.com\/app\/(\d+)/i,
  );
  return match ? match[1] : null;
}

/* ── Agregados para perfil / página de conquistas ──────────────────────── */

/** Um unlock enriquecido com os dados do jogo e do schema (para feeds). */
export interface UnlockedAchievementView {
  threadId: string;
  gameTitle: string;
  gameThumbnailUrl: string | null;
  apiName: string;
  displayName: string;
  description: string;
  iconUrl: string;
  globalPercent: number | null;
  unlockTime: number | null;
  syncedAt: string;
}

interface UnlockViewRow {
  thread_id: string;
  game_title: string;
  thumbnail_url: string | null;
  api_name: string;
  display_name: string;
  description: string | null;
  icon_url: string | null;
  global_percent: number | null;
  unlock_time: number | null;
  synced_at: string;
}

const UNLOCK_VIEW_SQL = `
  SELECT u.thread_id, u.api_name, u.unlock_time, u.synced_at,
         g.title AS game_title, g.thumbnail_url,
         s.display_name, s.description, s.icon_url, s.global_percent
    FROM steam_achievement_unlocks u
    JOIN library_games g ON g.thread_id = u.thread_id
    JOIN steam_achievements s
      ON s.steam_appid = g.steam_appid
     AND UPPER(s.api_name) = UPPER(u.api_name)`;

function rowToUnlockView(r: UnlockViewRow): UnlockedAchievementView {
  return {
    threadId: r.thread_id,
    gameTitle: r.game_title,
    gameThumbnailUrl: r.thumbnail_url,
    apiName: r.api_name,
    displayName: r.display_name,
    description: r.description ?? '',
    iconUrl: r.icon_url ?? '',
    globalPercent: r.global_percent,
    unlockTime: r.unlock_time,
    syncedAt: r.synced_at,
  };
}

/** Desbloqueios mais recentes do usuário, entre todos os jogos. */
export async function listRecentUnlocks(
  limit = 12,
): Promise<UnlockedAchievementView[]> {
  const rows = await query<UnlockViewRow>(
    `${UNLOCK_VIEW_SQL}
     ORDER BY COALESCE(u.unlock_time, 0) DESC, datetime(u.synced_at) DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map(rowToUnlockView);
}

/** Progresso de conquistas por jogo vinculado (só jogos com schema). */
export interface GameAchievementProgress {
  threadId: string;
  title: string;
  thumbnailUrl: string | null;
  steamAppid: string;
  total: number;
  unlocked: number;
}

export async function listGameProgress(): Promise<GameAchievementProgress[]> {
  const rows = await query<{
    thread_id: string;
    title: string;
    thumbnail_url: string | null;
    steam_appid: string;
    total: number;
    unlocked: number;
  }>(
    `SELECT g.thread_id, g.title, g.thumbnail_url, g.steam_appid,
            (SELECT COUNT(*) FROM steam_achievements s
              WHERE s.steam_appid = g.steam_appid) AS total,
            (SELECT COUNT(*) FROM steam_achievement_unlocks u
              WHERE u.thread_id = g.thread_id
                AND EXISTS (SELECT 1 FROM steam_achievements s2
                             WHERE s2.steam_appid = g.steam_appid
                               AND UPPER(s2.api_name) = UPPER(u.api_name))
            ) AS unlocked
       FROM library_games g
      WHERE g.steam_appid IS NOT NULL AND g.steam_appid != ''
      ORDER BY unlocked DESC, LOWER(g.title) ASC`,
  );
  return rows
    .filter((r) => r.total > 0)
    .map((r) => ({
      threadId: r.thread_id,
      title: r.title,
      thumbnailUrl: r.thumbnail_url,
      steamAppid: r.steam_appid,
      total: r.total,
      unlocked: r.unlocked,
    }));
}

export interface OverallAchievementStats {
  totalUnlocked: number;
  totalAvailable: number;
  gamesTracked: number;
  perfectGames: number;
  rarest: UnlockedAchievementView | null;
}

export async function getOverallStats(): Promise<OverallAchievementStats> {
  const progress = await listGameProgress();
  const rarestRows = await query<UnlockViewRow>(
    `${UNLOCK_VIEW_SQL}
     WHERE s.global_percent IS NOT NULL
     ORDER BY s.global_percent ASC
     LIMIT 1`,
  );
  return {
    totalUnlocked: progress.reduce((acc, p) => acc + p.unlocked, 0),
    totalAvailable: progress.reduce((acc, p) => acc + p.total, 0),
    gamesTracked: progress.length,
    perfectGames: progress.filter((p) => p.total > 0 && p.unlocked === p.total).length,
    rarest: rarestRows[0] ? rowToUnlockView(rarestRows[0]) : null,
  };
}

/* ── Autodetecção do jogo na Steam ─────────────────────────────────────── */

/** Título F95 sem os colchetes de versão/dev: "Jogo [v0.5] [Dev]" → "Jogo". */
export function cleanF95Title(title: string): string {
  return title.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeGameName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Match conservador no catálogo da Steam: aceita igualdade normalizada, ou
 * um resultado cujo nome COMEÇA com o título (pega "Jogo - Season 1" mas
 * rejeita "Tor Eternum" para "Eternum"). Retorna null na dúvida.
 */
export async function matchSteamByName(title: string): Promise<string | null> {
  const clean = cleanF95Title(title);
  const target = normalizeGameName(clean);
  if (!target) return null;
  const results = await ipc.steamSearchGames(clean);
  const exact = results.find((r) => normalizeGameName(r.name) === target);
  if (exact) return exact.appId;
  const prefixed = results.find((r) => normalizeGameName(r.name).startsWith(target));
  return prefixed ? prefixed.appId : null;
}

export type AppidDetectionSource = 'install' | 'thread' | 'name';

export interface AppidDetection {
  appId: string;
  source: AppidDetectionSource;
}

/**
 * Cadeia de autodetecção, da fonte mais confiável para a menos:
 * 1. configs de crack na pasta do jogo (é o appid que o emulador USA);
 * 2. link Steam no thread do F95;
 * 3. busca por nome no catálogo (match conservador).
 * Cada etapa falha em silêncio; retorna null quando nada convence.
 */
export async function autoDetectAppid(args: {
  title: string;
  installPath?: string | null;
  exePath?: string | null;
  storeDetail?: {
    social?: { url: string }[];
    descriptionHtml?: string | null;
  } | null;
}): Promise<AppidDetection | null> {
  if (args.installPath || args.exePath) {
    try {
      const found = await ipc.steamDetectAppid({
        installPath: args.installPath,
        exePath: args.exePath,
      });
      if (found) return { appId: found, source: 'install' };
    } catch {
      /* segue para a próxima fonte */
    }
  }
  const fromThread = findAppidInStoreDetail(args.storeDetail ?? null);
  if (fromThread) return { appId: fromThread, source: 'thread' };
  try {
    const byName = await matchSteamByName(args.title);
    if (byName) return { appId: byName, source: 'name' };
  } catch {
    /* sem rede/sem resultado */
  }
  return null;
}
