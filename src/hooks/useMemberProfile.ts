import { useCallback, useEffect, useRef, useState } from 'react';
import * as ipc from '../lib/ipc';
import type { ActivityItem, FollowState } from '../types';
import type { MemberAboutDto, MemberProfileDto } from '../types/social';

/** Profiles and tabs loaded this session; back navigation renders instantly. */
const FRESH_MS = 2 * 60 * 1000;
const profiles = new Map<string, { data: MemberProfileDto; savedAt: number }>();
const tabData = new Map<string, { data: unknown; savedAt: number }>();

function formatErr(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

export type MemberProfileState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; member: MemberProfileDto; refreshing: boolean };

export function useMemberProfile(userId: string | undefined) {
  const [state, setState] = useState<MemberProfileState>(() => {
    const hit = userId ? profiles.get(userId) : undefined;
    return hit ? { kind: 'ready', member: hit.data, refreshing: false } : { kind: 'loading' };
  });

  const load = useCallback(
    async (force: boolean) => {
      if (!userId) return;
      const hit = profiles.get(userId);
      if (hit && !force && Date.now() - hit.savedAt < FRESH_MS) {
        setState({ kind: 'ready', member: hit.data, refreshing: false });
        return;
      }
      setState(hit ? { kind: 'ready', member: hit.data, refreshing: true } : { kind: 'loading' });
      try {
        const member = await ipc.getMemberProfile(userId);
        profiles.set(userId, { data: member, savedAt: Date.now() });
        setState({ kind: 'ready', member, refreshing: false });
      } catch (err) {
        setState(
          hit
            ? { kind: 'ready', member: hit.data, refreshing: false }
            : { kind: 'error', message: formatErr(err) },
        );
      }
    },
    [userId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  /** Follow/unfollow; resolves to the state F95 reports afterwards. */
  const setFollowing = useCallback(
    async (follow: boolean): Promise<FollowState> => {
      if (!userId) throw new Error('no member');
      const { following } = await ipc.setMemberFollow(userId, follow);
      const followState: FollowState = following ? 'following' : 'not_following';
      const hit = profiles.get(userId);
      if (hit) profiles.set(userId, { ...hit, data: { ...hit.data, followState } });
      setState((s) => (s.kind === 'ready' ? { ...s, member: { ...s.member, followState } } : s));
      return followState;
    },
    [userId],
  );

  return { state, reload: () => load(true), setFollowing };
}

export type TabState<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: T };

/** Lazy tab loader: fetches when `enabled` turns on, cached per member. */
function useTabData<T>(key: string | null, enabled: boolean, fetcher: () => Promise<T>) {
  const [state, setState] = useState<TabState<T>>({ kind: 'idle' });
  // Callers pass inline closures; the cache key identifies the data.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(
    async (force: boolean) => {
      if (!key) return;
      const hit = tabData.get(key);
      if (hit && !force && Date.now() - hit.savedAt < FRESH_MS) {
        setState({ kind: 'ready', data: hit.data as T });
        return;
      }
      setState({ kind: 'loading' });
      try {
        const data = await fetcherRef.current();
        tabData.set(key, { data, savedAt: Date.now() });
        setState({ kind: 'ready', data });
      } catch (err) {
        setState({ kind: 'error', message: formatErr(err) });
      }
    },
    [key],
  );

  useEffect(() => {
    setState({ kind: 'idle' });
  }, [key]);

  useEffect(() => {
    if (enabled && state.kind === 'idle') void load(false);
  }, [enabled, state.kind, load]);

  return { state, reload: () => load(true) };
}

export function useMemberPostings(userId: string | undefined, enabled: boolean) {
  return useTabData<ActivityItem[]>(userId ? `${userId}:postings` : null, enabled, () =>
    ipc.getMemberActivity(userId!, 'postings'),
  );
}

export function useMemberAbout(userId: string | undefined, enabled: boolean) {
  return useTabData<MemberAboutDto>(userId ? `${userId}:about` : null, enabled, () =>
    ipc.getMemberAbout(userId!),
  );
}
