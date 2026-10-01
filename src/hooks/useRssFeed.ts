import { useCallback, useEffect, useSyncExternalStore } from 'react';
import * as ipc from '../lib/ipc';
import type { RssFeedItem } from '../types/rss';

/** A feed loaded less than this ago is shown as is when a page asks again. */
const FRESH_MS = 10 * 60 * 1000;

interface FeedState {
  items: RssFeedItem[];
  /** When `items` arrived; null until the first load. */
  fetchedAt: number | null;
  loading: boolean;
  /** Raw failure of the last load, so callers can translate it (describeIpcError). */
  error: unknown;
}

// One copy for the session: the News page and Big Picture share it, and
// coming back to either shows the last feed at once.
let state: FeedState = { items: [], fetchedAt: null, loading: false, error: null };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<FeedState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fetch F95's latest updates; a load already running is joined, a fresh feed kept unless `force`. */
function load(force: boolean): Promise<void> {
  if (inflight) return inflight;
  const fresh = state.fetchedAt != null && state.error == null && Date.now() - state.fetchedAt < FRESH_MS;
  if (fresh && !force) return Promise.resolve();
  setState({ loading: true, error: null });
  inflight = ipc
    .fetchRssFeed({ category: 'games' })
    .then((feed) => setState({ items: feed.items, fetchedAt: Date.now(), loading: false }))
    .catch((err) => setState({ loading: false, error: err ?? 'error' }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * F95's "latest updates" feed (new threads and updates), kept for the
 * session. Loads when `enabled` turns on and the copy is missing, failed or
 * older than ten minutes; `reload` always fetches.
 */
export function useRssFeed({ enabled = true }: { enabled?: boolean } = {}) {
  const feed = useSyncExternalStore(subscribe, () => state);

  useEffect(() => {
    if (enabled) void load(false);
  }, [enabled]);

  const reload = useCallback(() => load(true), []);

  return {
    items: feed.items,
    fetchedAt: feed.fetchedAt,
    // Before the first load starts there is nothing to show yet either.
    loading: feed.loading || (enabled && feed.fetchedAt == null && feed.error == null),
    error: feed.error,
    reload,
  };
}
