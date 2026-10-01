import { useEffect, useState } from 'react';
import { presenceOf } from '../lib/memberPresence';
import { loadFollowingCache, loadMemberCardsCache, type CardCache } from '../lib/socialCache';
import { useNow } from './useNow';

type SeenListener = (ownerId: string, lastSeen: (number | null)[]) => void;
const listeners = new Set<SeenListener>();

/**
 * A friends list on screen shares when each member was last seen, so the
 * counts elsewhere follow it without fetching anything themselves.
 */
export function reportFriendsSeen(ownerId: string, lastSeen: (number | null)[]): void {
  for (const listener of listeners) listener(ownerId, lastSeen);
}

/**
 * How many followed members are online, from the saved list and cards (no
 * network), then from what the friends list reports as it refreshes.
 */
export function useFriendsOnline(ownerId: string): number {
  const [seen, setSeen] = useState<(number | null)[]>([]);
  // "Online" means seen in the last 15 minutes: it ages without new data.
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    let reported = false;
    const onReport: SeenListener = (owner, lastSeen) => {
      if (owner !== ownerId) return;
      reported = true;
      setSeen(lastSeen);
    };
    listeners.add(onReport);
    void Promise.all([
      loadFollowingCache(ownerId).catch(() => null),
      loadMemberCardsCache(ownerId).catch((): CardCache => ({})),
    ]).then(([following, cards]) => {
      if (cancelled || reported || !following) return;
      setSeen(following.data.map((u) => cards[u.userId]?.data.lastSeenTs ?? null));
    });
    return () => {
      cancelled = true;
      listeners.delete(onReport);
    };
  }, [ownerId]);

  return seen.filter((ts) => presenceOf(ts, now) === 'online').length;
}
