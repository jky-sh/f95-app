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
      return detail;
    })
    .finally(() => inflight.delete(threadId));
  inflight.set(threadId, request);
  return request;
}
