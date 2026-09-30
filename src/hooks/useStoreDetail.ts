import { useEffect, useState } from 'react';
import { cachedGameDetail, loadGameDetail, storedGameDetail } from '../lib/gameDetailCache';
import type { GameDetail } from '../types/game';

/**
 * F95 details for a library page: what was fetched this session, else the
 * copy saved on disk (shown at once, and the only source offline), then a
 * fresh scrape when online. Never the previous game's details while the
 * next one loads.
 */
export function useStoreDetail(threadId: string | undefined, isOffline: boolean): GameDetail | null {
  const [detail, setDetail] = useState<GameDetail | null>(() =>
    threadId ? cachedGameDetail(threadId) : null,
  );

  useEffect(() => {
    if (!threadId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const fresh = cachedGameDetail(threadId);
    setDetail(fresh);
    if (fresh) return;
    void storedGameDetail(threadId).then((stored) => {
      // The network answer may have landed first; it wins.
      if (!cancelled && stored) setDetail((current) => current ?? stored);
    });
    if (!isOffline) {
      loadGameDetail(threadId)
        .then((loaded) => {
          if (!cancelled) setDetail(loaded);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [threadId, isOffline]);

  return detail;
}
