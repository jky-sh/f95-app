import { useCallback, useEffect, useState } from 'react';
import * as ipc from '../lib/ipc';
import { loadFollowingCache, saveFollowingCache } from '../lib/socialCache';
import type { FollowedUser } from '../types/social';

export type FollowingState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      users: FollowedUser[];
      /** When `users` was fetched (cache or live). */
      savedAt: number;
      refreshing: boolean;
      /** Last refresh failed; `users` is the saved list. */
      refreshError: string | null;
    };

function formatErr(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

/**
 * Members the logged-in account follows: the saved list first (instant,
 * works offline), then a live refresh unless `offline`.
 */
export function useFollowing(ownerId: string, offline: boolean) {
  const [state, setState] = useState<FollowingState>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    setState((s) => (s.kind === 'ready' ? { ...s, refreshing: true, refreshError: null } : { kind: 'loading' }));
    try {
      const users = await ipc.getFollowing();
      setState({ kind: 'ready', users, savedAt: Date.now(), refreshing: false, refreshError: null });
      saveFollowingCache(ownerId, users).catch((err) => console.warn('[friends] cache save failed', err));
    } catch (err) {
      const message = formatErr(err);
      setState((s) =>
        s.kind === 'ready' ? { ...s, refreshing: false, refreshError: message } : { kind: 'error', message },
      );
    }
  }, [ownerId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadFollowingCache(ownerId).catch(() => null);
      if (cancelled) return;
      if (cached) {
        setState({
          kind: 'ready',
          users: cached.data,
          savedAt: cached.savedAt,
          refreshing: !offline,
          refreshError: null,
        });
      }
      if (!offline) await refresh();
      else if (!cached) setState({ kind: 'ready', users: [], savedAt: 0, refreshing: false, refreshError: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerId, offline, refresh]);

  /** Unfollow on F95; drops the member from the list once F95 confirms. */
  const unfollow = useCallback(
    async (userId: string) => {
      const { following } = await ipc.setMemberFollow(userId, false);
      if (following) return false;
      setState((s) => {
        if (s.kind !== 'ready') return s;
        const users = s.users.filter((u) => u.userId !== userId);
        saveFollowingCache(ownerId, users).catch(() => {});
        return { ...s, users };
      });
      return true;
    },
    [ownerId],
  );

  return { state, refresh, unfollow };
}
