import { useSyncExternalStore } from 'react';
import { currentSkin, SKIN_CHANGE_EVENT, type SkinId } from '../lib/theme';

function subscribe(onChange: () => void): () => void {
  window.addEventListener(SKIN_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(SKIN_CHANGE_EVENT, onChange);
}

/**
 * Reactive current skin. Components that swap layout per skin (Steam top
 * nav, Steam library sidebar) re-render immediately when the user switches
 * the style in Settings — `applySkin` dispatches SKIN_CHANGE_EVENT.
 */
export function useSkin(): SkinId {
  return useSyncExternalStore(subscribe, currentSkin);
}
