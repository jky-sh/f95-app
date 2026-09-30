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

const PAGE_SIZE = 15;

export function useSamList(filters: SamFilters): SamListState & {
  loadMore: () => void;
  goToPage: (target: number) => void;
  reload: () => void;
  /** Re-run the request that failed. */
  retry: () => void;
} {
  const [items, setItems] = useState<SamGameCard[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

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

  const reqIdRef = useRef(0);
  /** Request that failed last, re-run as-is by `retry`. */
  const failedRef = useRef<{ target: number; append: boolean } | null>(null);

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
        setPage(result.page);
        setTotalPages(result.totalPages);
        setTotalRows(result.totalRows);
        setItems((prev) => (append ? dedup([...prev, ...result.items]) : result.items));
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
    [filterKey],
  );

  // Reload when filters change (debounced for search).
  useEffect(() => {
    const isSearch = (filters.search ?? '').length > 0;
    const t = setTimeout(
      () => {
        setItems([]);
        setPage(0);
        fetchPage(1, false);
      },
      isSearch ? 350 : 0,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

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

  const goToPage = useCallback(
    (target: number) => {
      if (loading) return;
      if (target < 1 || target > totalPages) return;
      if (target === page) return;
      fetchPage(target, false);
    },
    [loading, page, totalPages, fetchPage],
  );

  const reload = useCallback(() => {
    setItems([]);
    setPage(0);
    fetchPage(1, false);
  }, [fetchPage]);

  return {
    items,
    page,
    totalPages,
    totalRows,
    loading,
    error,
    hasMore: page < totalPages,
    loadMore,
    goToPage,
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
