export type OverlayTab = 'game' | 'notes' | 'guides' | 'browser' | 'achievements';

export const OVERLAY_TAB_ORDER: OverlayTab[] = ['game', 'notes', 'guides', 'browser', 'achievements'];

/** Tool names, shared by the dock buttons and the panel titles. */
export const OVERLAY_TAB_LABEL_KEYS: Record<OverlayTab, string> = {
  game: 'overlay.tab.game',
  notes: 'overlay.tab.notes',
  guides: 'overlay.tab.guides',
  browser: 'overlay.tab.browser',
  achievements: 'overlay.tab.achievements',
};
