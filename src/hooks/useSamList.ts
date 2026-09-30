import { useCallback, useEffect, useRef, useState } from 'react';
import { samList } from '../lib/ipc';
import { execute } from '../lib/db';
import type { SamFilters, SamGameCard, SamPage } from '../types/sam';

export interface SamListState {
  items: SamGameCard[];
  page: number;
  totalPages: number;
  totalRows: number;
  loading: boolean;
  /** Raw IPC failure of the last request (describe it with `describeIpcError`). */
  error: unknown;
  hasMore: boolean;
}

export interface SamListOptions {
  /** `infinite` appends pages as you scroll; `paged` shows one page at a time. */
  mode?: 'infinite' | 'paged';
  /** Page shown in paged mode, owned by the caller (the store keeps it in the URL). */
  page?: number;
  /** False holds the first request (e.g. until the saved scroll mode is known). */
  enabled?: boolean;
}

const PAGE_SIZE = 15;

interface CachedList {
  items: SamGameCard[];
  page: number;
  totalPages: number;
  totalRows: number;
  fetchedAt: number;
}

/**
 * Results per filter set for the session, so coming back to the store (Back
 * from a game, or another tab) shows the same cards at once, with every page
 * already scrolled through, instead of starting over from page 1.
 */
const listCache = new Map<string, CachedList>();
const LIST_CACHE_TTL_MS = 10 * 60_000;
const LIST_CACHE_MAX = 20;

function readCache(key: string): CachedList | null {
  const hit = listCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > LIST_CACHE_TTL_MS) {
    listCache.delete(key);
    return null;
  }
  return hit;
}

function writeCache(key: string, entry: CachedList): void {
  listCache.delete(key); // re-insert as the newest
  listCache.set(key, entry);
  while (listCache.size > LIST_CACHE_MAX) {
    const oldest = listCache.keys().next().value;
    if (oldest === undefined) break;
    listCache.delete(oldest);
  }
}

function dropCache(filterKey: string): void {
  for (const key of [...listCache.keys()]) {
    if (key.startsWith(`${filterKey}#`)) listCache.delete(key);
  }
}

export function useSamList(
  filters: SamFilters,
  options: SamListOptions = {},
): SamListState & {
  loadMore: () => void;
  /** Refetch the current filters, skipping the cache. */
  reload: () => void;
  /** Re-run the request that failed. */
  retry: () => void;
} {
  const mode = options.mode ?? 'infinite';
  const enabled = options.enabled ?? true;
  const requestedPage = mode === 'paged' ? Math.max(1, options.page ?? 1) : 1;

  // Keep a stable key of filters that should trigger a reload. Excludes `page`
  // because we manage page internally.
  const filterKey = JSON.stringify({
    category: filters.category,
    prefixes: filters.prefixes,
    noprefixes: filters.noprefixes,
    tags: filters.tags,
    notags: filters.notags,
    tagtype: filters.tagtype,
    search: filters.search,
    sort: filters.sort,
    order: filters.order,
    rows: filters.rows ?? PAGE_SIZE,
  });
  // Infinite scroll caches the whole list, paged mode each page.
  const cacheKey = useCallback(
    (page: number) => (mode === 'paged' ? `${filterKey}#page${page}` : `${filterKey}#all`),
    [filterKey, mode],
  );

  // Restored in the first render, so Back lands on the same cards (and the
  // scroll offset can be put back right away).
  const [restored] = useState(() => readCache(cacheKey(requestedPage)));

  const [items, setItems] = useState<SamGameCard[]>(restored?.items ?? []);
  const [page, setPage] = useState(restored?.page ?? 0);
  const [totalPages, setTotalPages] = useState(restored?.totalPages ?? 1);
  const [totalRows, setTotalRows] = useState(restored?.totalRows ?? 0);
  // Nothing to show yet means a request is coming: skeleton, not "no results".
  const [loading, setLoading] = useState(!restored);
  const [error, setError] = useState<unknown>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const reqIdRef = useRef(0);
  /** Request that failed last, re-run as-is by `retry`. */
  const failedRef = useRef<{ target: number; append: boolean } | null>(null);
  /** Mode + filters of the cards on screen: a new page of the same list keeps them until it loads. */
  const shownKeyRef = useRef<string | null>(restored ? `${mode}|${filterKey}` : null);

  const show = useCallback((entry: CachedList) => {
    ++reqIdRef.current; // drop whatever was in flight for other filters
    failedRef.current = null;
    setItems(entry.items);
    setPage(entry.page);
    setTotalPages(entry.totalPages);
    setTotalRows(entry.totalRows);
    setError(null);
    setLoading(false);
  }, []);

  const fetchPage = useCallback(
    async (target: number, append: boolean) => {
      const myId = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      failedRef.current = null;
      try {
        const result: SamPage = await samList({
          category: filters.category ?? 'games',
          prefixes: filters.prefixes,
          noprefixes: filters.noprefixes,
          tags: filters.tags,
          notags: filters.notags,
          tagtype: filters.tagtype,
          search: filters.search,
          sort: filters.sort ?? 'date',
          order: filters.order,
          rows: filters.rows ?? PAGE_SIZE,
          page: target,
        });
        if (reqIdRef.current !== myId) return; // stale response
        const next = append ? dedup([...itemsRef.current, ...result.items]) : result.items;
        setPage(result.page);
        setTotalPages(result.totalPages);
        setTotalRows(result.totalRows);
        setItems(next);
        writeCache(cacheKey(result.page), {
          items: next,
          page: result.page,
          totalPages: result.totalPages,
          totalRows: result.totalRows,
          fetchedAt: Date.now(),
        });
        // Best-effort cache write — never block the UI on cache errors.
        cacheItems(result.items).catch(() => undefined);
      } catch (err) {
        if (reqIdRef.current !== myId) return;
        failedRef.current = { target, append };
        setError(err ?? 'unknown error');
      } finally {
        if (reqIdRef.current === myId) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey, cacheKey],
  );

  // Load when the filters, the mode or the requested page change: from the
  // cache when that list was shown a moment ago, else from F95. Idempotent,
  // so StrictMode's double run still fetches once.
  useEffect(() => {
    if (!enabled) return;
    const shownKey = `${mode}|${filterKey}`;
    const sameList = shownKeyRef.current === shownKey;
    shownKeyRef.current = shownKey;
    const hit = readCache(cacheKey(requestedPage));
    if (hit) {
      show(hit);
      return;
    }
    const t = setTimeout(() => {
      if (!sameList) {
        setItems([]);
        setPage(0);
      }
      fetchPage(requestedPage, false);
    }, 0);
    return () => clearTimeout(t);
  }, [enabled, mode, filterKey, requestedPage, cacheKey, fetchPage, show]);

  // Infinite scroll calls this whenever the sentinel is visible. After a
  // failure it must wait for an explicit retry: re-creating the observer
  // fires it again at once, which used to loop against F95.
  const loadMore = useCallback(() => {
    if (loading || error) return;
    if (page >= totalPages) return;
    fetchPage(page + 1, true);
  }, [loading, error, page, totalPages, fetchPage]);

  const retry = useCallback(() => {
    const failed = failedRef.current;
    if (loading || !failed) return;
    fetchPage(failed.target, failed.append);
  }, [loading, fetchPage]);

  const reload = useCallback(() => {
    dropCache(filterKey);
    if (mode === 'infinite') {
      setItems([]);
      setPage(0);
    }
    fetchPage(requestedPage, false);
  }, [mode, filterKey, requestedPage, fetchPage]);

  return {
    items,
    page,
    totalPages,
    totalRows,
    loading,
    error,
    hasMore: page < totalPages,
    loadMore,
    reload,
    retry,
  };
}

function dedup(items: SamGameCard[]): SamGameCard[] {
  const seen = new Set<string>();
  const out: SamGameCard[] = [];
  for (const it of items) {
    if (seen.has(it.threadId)) continue;
    seen.add(it.threadId);
    out.push(it);
  }
  return out;
}

async function cacheItems(items: SamGameCard[]): Promise<void> {
  if (items.length === 0) return;
  for (const it of items) {
    await execute(
      `INSERT INTO games_cache (
         thread_id, title, version, thumbnail_url, thread_url,
         engine, status, rating, views, likes, updated_at,
         prefixes_json, tags_json, cached_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(thread_id) DO UPDATE SET
         title=excluded.title,
         version=excluded.version,
         thumbnail_url=excluded.thumbnail_url,
         thread_url=excluded.thread_url,
         engine=excluded.engine,
         status=excluded.status,
         rating=excluded.rating,
         views=excluded.views,
         likes=excluded.likes,
         updated_at=excluded.updated_at,
         prefixes_json=excluded.prefixes_json,
         tags_json=excluded.tags_json,
         cached_at=excluded.cached_at`,
      [
        it.threadId,
        it.title,
        it.version,
        it.thumbnailUrl,
        it.threadUrl,
        null,
        null,
        it.rating,
        it.views,
        it.likes,
        it.updatedAt,
        JSON.stringify(it.prefixIds),
        JSON.stringify(it.tagIds),
      ],
    );
  }
}
