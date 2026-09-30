import { execute, query } from './db';
import * as ipc from './ipc';
import type { GameDetail } from '../types/game';

/**
 * Thread details for the session. The store page, the download modal and the
 * library page of the same game share one scrape: the sidecar serves one
 * request at a time, so a duplicate delays everything queued behind it.
 */
const DETAIL_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 60;

const cache = new Map<string, { detail: GameDetail; fetchedAt: number }>();
const inflight = new Map<string, Promise<GameDetail>>();

/** Details fetched in the last few minutes, or null. */
export function cachedGameDetail(threadId: string): GameDetail | null {
  const hit = cache.get(threadId);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > DETAIL_TTL_MS) {
    cache.delete(threadId);
    return null;
  }
  return hit.detail;
}

function remember(threadId: string, detail: GameDetail): void {
  cache.delete(threadId); // re-insert as the newest
  cache.set(threadId, { detail, fetchedAt: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface LoadGameDetailOptions {
  /** Skip the cache: update checks and retries want what F95 shows now. */
  fresh?: boolean;
}

/** Cached details, or one scrape shared by every caller asking meanwhile. */
export function loadGameDetail(
  threadId: string,
  { fresh = false }: LoadGameDetailOptions = {},
): Promise<GameDetail> {
  if (!fresh) {
    const hit = cachedGameDetail(threadId);
    if (hit) return Promise.resolve(hit);
  }
  const pending = inflight.get(threadId);
  if (pending) return pending;
  const request = ipc
    .gameDetail(threadId)
    .then((detail) => {
      remember(threadId, detail);
      void persist(threadId, detail);
      return detail;
    })
    .finally(() => inflight.delete(threadId));
  inflight.set(threadId, request);
  return request;
}

/*
 * On-disk copy of the last details seen, so library pages show the
 * description, screenshots and changelog at once after a restart, and at
 * all while offline. The table is a disposable cache created on first use
 * rather than by a migration, so databases stay usable by builds without
 * it. Games in the library are kept; others expire after a week.
 */
const KEEP_OUTSIDE_LIBRARY_MS = 7 * 24 * 60 * 60 * 1000;

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = execute(
      `CREATE TABLE IF NOT EXISTS game_detail_cache (
         thread_id   TEXT PRIMARY KEY,
         detail_json TEXT NOT NULL,
         fetched_at  INTEGER NOT NULL
       )`,
    )
      .then(() => undefined)
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}

async function persist(threadId: string, detail: GameDetail): Promise<void> {
  try {
    await ensureTable();
    const now = Date.now();
    await execute(
      `INSERT INTO game_detail_cache (thread_id, detail_json, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         detail_json = excluded.detail_json,
         fetched_at = excluded.fetched_at`,
      [threadId, JSON.stringify(detail), now],
    );
    await execute(
      `DELETE FROM game_detail_cache
        WHERE fetched_at < ?
          AND thread_id NOT IN (SELECT thread_id FROM library_games)`,
      [now - KEEP_OUTSIDE_LIBRARY_MS],
    );
  } catch (err) {
    console.warn('[detail-cache] persist failed', err);
  }
}

/** The last details saved on disk for this thread (any age), or null. */
export async function storedGameDetail(threadId: string): Promise<GameDetail | null> {
  try {
    await ensureTable();
    const rows = await query<{ detail_json: string }>(
      `SELECT detail_json FROM game_detail_cache WHERE thread_id = ?`,
      [threadId],
    );
    return rows[0] ? (JSON.parse(rows[0].detail_json) as GameDetail) : null;
  } catch (err) {
    console.warn('[detail-cache] read failed', err);
    return null;
  }
}

/** Drop every saved detail (Settings → clear cache). */
export async function clearStoredGameDetails(): Promise<void> {
  cache.clear();
  await ensureTable();
  await execute(`DELETE FROM game_detail_cache`);
}
