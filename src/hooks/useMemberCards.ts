import { useEffect, useMemo, useRef, useState } from 'react';
import * as ipc from '../lib/ipc';
import {
  loadMemberCardsCache,
  saveMemberCardsCache,
  type CardCache,
} from '../lib/socialCache';
import type { MemberCardDto } from '../types/social';

/** Cards older than this are refetched (last seen drifts quickly). */
const CARD_TTL_MS = 5 * 60 * 1000;
/** Sidecar cap per call; batches run one after another. */
const BATCH_SIZE = 24;

/**
 * Member tooltip cards (last seen, cover, badges) for the friends list.
 * Shows saved cards right away and refreshes stale ones in batches, so a
 * long list never holds the sidecar for long.
 */
export function useMemberCards(ownerId: string, userIds: string[], offline: boolean) {
  const [cache, setCache] = useState<CardCache>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const cacheRef = useRef<CardCache>({});
  const loadedFor = useRef<string | null>(null);
  const idsKey = userIds.join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (loadedFor.current !== ownerId) {
        cacheRef.current = await loadMemberCardsCache(ownerId).catch(() => ({}));
        loadedFor.current = ownerId;
        if (cancelled) return;
        setCache(cacheRef.current);
      }
      if (offline) return;

      const now = Date.now();
      const stale = idsKey
        .split(',')
        .filter((id) => id && !(cacheRef.current[id] && now - cacheRef.current[id].savedAt < CARD_TTL_MS));
      if (stale.length === 0) return;
      setPending(new Set(stale));

      for (let i = 0; i < stale.length && !cancelled; i += BATCH_SIZE) {
        const batch = stale.slice(i, i + BATCH_SIZE);
        try {
          const cards = await ipc.getMemberCards(batch);
          const savedAt = Date.now();
          const next = { ...cacheRef.current };
          for (const card of cards) next[card.userId] = { savedAt, data: card };
          cacheRef.current = next;
          if (!cancelled) setCache(next);
          saveMemberCardsCache(ownerId, next).catch(() => {});
        } catch (err) {
          console.warn('[friends] member cards failed', err);
        }
        if (!cancelled) {
          setPending((p) => {
            const rest = new Set(p);
            batch.forEach((id) => rest.delete(id));
            return rest;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      setPending(new Set());
    };
  }, [ownerId, idsKey, offline]);

  const cards = useMemo(() => {
    const out: Record<string, MemberCardDto> = {};
    for (const [id, entry] of Object.entries(cache)) out[id] = entry.data;
    return out;
  }, [cache]);
  return { cards, pending };
}
