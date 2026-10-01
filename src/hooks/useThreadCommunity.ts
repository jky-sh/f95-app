import { useCallback, useEffect, useRef, useState } from 'react';
import * as ipc from '../lib/ipc';
import type { ThreadPost, ThreadReview } from '../types/game';

/** How long a loaded feed is reused when the tab or the game opens again. */
const CACHE_TTL_MS = 10 * 60 * 1000;
/** A newest page this short also brings the page before it. */
const MIN_FIRST_POSTS = 8;

interface PageResult<T> {
  page: number;
  totalPages: number;
  items: T[];
}

interface FeedData<T> {
  /** Pages loaded, in the order they were added. */
  pages: number[];
  totalPages: number;
  items: T[];
}

export interface ThreadFeed<T> {
  items: T[];
  /** First load or a "load more" in flight. */
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  /** Pages loaded so far and the thread's total. */
  pages: number[];
  totalPages: number;
  loadMore: () => void;
  retry: () => void;
}

const cache = new Map<string, { data: FeedData<unknown>; at: number }>();

/**
 * A thread's posts, newest first: the last page, then older pages on demand
 * (page 1 ends at post #2; the OP is the game description).
 */
export function useThreadPosts(threadId: string, enabled: boolean): ThreadFeed<ThreadPost> {
  return useFeed<ThreadPost>(`posts:${threadId}`, enabled, {
    first: async () => pageOf(await ipc.gamePosts(threadId, 'last'), 'posts'),
    page: async (n) => pageOf(await ipc.gamePosts(threadId, n), 'posts'),
    next: (data) => {
      const oldest = Math.min(...data.pages);
      return oldest > 1 ? oldest - 1 : null;
    },
    // Each page reads oldest to newest; the feed shows newest first.
    order: (items) => [...items].reverse(),
    fill: (data) => data.items.length < MIN_FIRST_POSTS,
  });
}

/** A thread's reviews, newest first, a page at a time. */
export function useThreadReviews(threadId: string, enabled: boolean): ThreadFeed<ThreadReview> {
  return useFeed<ThreadReview>(`reviews:${threadId}`, enabled, {
    first: async () => pageOf(await ipc.gameReviews(threadId, 1), 'reviews'),
    page: async (n) => pageOf(await ipc.gameReviews(threadId, n), 'reviews'),
    next: (data) => {
      const newest = Math.max(...data.pages);
      return newest < data.totalPages ? newest + 1 : null;
    },
    order: (items) => items,
    fill: () => false,
  });
}

function pageOf<K extends 'posts' | 'reviews', T>(
  res: { page: number; totalPages: number } & Record<K, T[]>,
  key: K,
): PageResult<T> {
  return { page: res.page, totalPages: res.totalPages, items: res[key] };
}

interface FeedSource<T> {
  first: () => Promise<PageResult<T>>;
  page: (n: number) => Promise<PageResult<T>>;
  /** The page "load more" asks for, or null when there is none. */
  next: (data: FeedData<T>) => number | null;
  /** A page's items in the order the feed shows them. */
  order: (items: T[]) => T[];
  /** After the first page: fetch one more right away? */
  fill: (data: FeedData<T>) => boolean;
}

function useFeed<T>(key: string, enabled: boolean, source: FeedSource<T>): ThreadFeed<T> {
  const [data, setData] = useState<FeedData<T> | null>(() => cached<T>(key));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const dataRef = useRef(data);
  dataRef.current = data;
  /** Bumped when the thread changes, so late answers for the old one are dropped. */
  const generation = useRef(0);
  const busy = useRef(false);

  const commit = useCallback(
    (next: FeedData<T>) => {
      cache.set(key, { data: next as FeedData<unknown>, at: Date.now() });
      dataRef.current = next;
      setData(next);
    },
    [key],
  );

  const run = useCallback(
    async (load: () => Promise<PageResult<T>>) => {
      if (busy.current) return;
      busy.current = true;
      const gen = generation.current;
      setLoading(true);
      setError(null);
      try {
        const res = await load();
        if (gen !== generation.current) return;
        const prev = dataRef.current;
        if (prev?.pages.includes(res.page)) return;
        const merged: FeedData<T> = {
          pages: [...(prev?.pages ?? []), res.page],
          totalPages: Math.max(res.totalPages, prev?.totalPages ?? 1),
          items: [...(prev?.items ?? []), ...sourceRef.current.order(res.items)],
        };
        commit(merged);
        busy.current = false;
        const more = sourceRef.current.next(merged);
        if (!prev && more !== null && sourceRef.current.fill(merged)) {
          await run(() => sourceRef.current.page(more));
        }
      } catch (err) {
        if (gen === generation.current) setError(err);
      } finally {
        if (gen === generation.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [commit],
  );

  // A new thread: its cached feed or nothing, and any request in flight is ignored.
  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    const hit = cached<T>(key);
    dataRef.current = hit;
    setData(hit);
    setError(null);
    setLoading(false);
  }, [key]);

  useEffect(() => {
    if (enabled && !dataRef.current && !busy.current) void run(() => sourceRef.current.first());
  }, [enabled, key, run]);

  const loadMore = useCallback(() => {
    const current = dataRef.current;
    const more = current ? sourceRef.current.next(current) : null;
    if (more !== null) void run(() => sourceRef.current.page(more));
  }, [run]);

  const retry = useCallback(() => {
    if (dataRef.current) loadMore();
    else void run(() => sourceRef.current.first());
  }, [loadMore, run]);

  return {
    items: data?.items ?? [],
    loading,
    error,
    hasMore: data ? source.next(data) !== null : false,
    pages: data?.pages ?? [],
    totalPages: data?.totalPages ?? 0,
    loadMore,
    retry,
  };
}

function cached<T>(key: string): FeedData<T> | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.data as FeedData<T>;
}
