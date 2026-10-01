import { createContext, useContext } from 'react';
import type { ContextMenuItem } from '../contextMenu/types';
import type { LibraryGameActionsDeps } from '../../lib/libraryGameActions';
import type { StoreMenuGame } from '../../lib/contextMenus/buildStoreMenu';
import type { LibraryGame } from '../../types/library';
import type { SamCategory, SamGameCard } from '../../types/sam';
import type { ProfileDto } from '../../types';
import type { BpAction } from './bpInput';

/** Top-level sections, in the order LB/RB walk them. */
export const BP_TABS = ['home', 'library', 'store', 'downloads'] as const;
export type BpTab = (typeof BP_TABS)[number];

export type BpRoute =
  | { screen: BpTab }
  | { screen: 'search' }
  | { screen: 'settings' }
  | { screen: 'profile' }
  | { screen: 'game'; threadId: string }
  /** `card` when opened from a store list (instant header), else loaded. */
  | { screen: 'storeGame'; threadId: string; category: SamCategory; card?: SamGameCard }
  /** Every store listing of a category, with filters. */
  | { screen: 'storeBrowse'; category: SamCategory }
  /** A comic's pages or an animation's videos. */
  | { screen: 'media'; threadId: string };

export function routeKey(route: BpRoute): string {
  switch (route.screen) {
    case 'game':
    case 'storeGame':
    case 'media':
      return `${route.screen}:${route.threadId}`;
    default:
      return route.screen;
  }
}

export function isTab(route: BpRoute): route is { screen: BpTab } {
  return (BP_TABS as readonly string[]).includes(route.screen);
}

export interface BpSheetSpec {
  title: string;
  subtitle?: string | null;
  art?: string | null;
  items: ContextMenuItem[];
}

/** Takes an action before the usual handling; true when it was used. */
export type BpActionHandler = (action: BpAction) => boolean;

/** Stable for the whole session: screens and tiles never re-render because of it. */
export interface BpApi {
  /** Open a screen over the current one; `from` morphs into its header art. */
  push: (route: BpRoute, from?: HTMLElement | null) => void;
  back: () => void;
  switchTab: (tab: BpTab) => void;
  openSheet: (sheet: BpSheetSpec) => void;
  openViewer: (images: string[], index: number) => void;
  openMenu: () => void;
  /** Leave Big Picture, then go to `to` in the desktop interface when given. */
  exit: (to?: string) => void;
  /** Art behind the current screen (the focused game); null clears it. */
  setBackdrop: (art: string | null) => void;
  /** Game actions (play, update, menus) with navigation kept inside Big Picture. */
  gameDeps: () => LibraryGameActionsDeps;
  openGame: (game: LibraryGame, from?: HTMLElement | null) => void;
  openStoreGame: (card: SamGameCard, category: SamCategory, from?: HTMLElement | null) => void;
  openGameOptions: (game: LibraryGame) => void;
  openStoreOptions: (game: StoreMenuGame & { creator?: string | null }, category: SamCategory) => void;
  /** A full-screen reader or player takes the controller while it is open. */
  setActionHandler: (handler: BpActionHandler | null) => void;
  /** Where full-screen layers render (above the top bar and hints). */
  layerHost: () => HTMLElement | null;
}

export const BpContext = createContext<BpApi | null>(null);

export function useBp(): BpApi {
  const api = useContext(BpContext);
  if (!api) throw new Error('useBp must be used inside Big Picture');
  return api;
}

/** Every library entry, kept current (null until the first read). */
export const BpGamesContext = createContext<LibraryGame[] | null>(null);

export function useBpGames(): LibraryGame[] | null {
  return useContext(BpGamesContext);
}

/** The signed-in member (the profile screen refreshes its own copy). */
export const BpProfileContext = createContext<ProfileDto | null>(null);

export function useBpProfile(): ProfileDto {
  const profile = useContext(BpProfileContext);
  if (!profile) throw new Error('useBpProfile must be used inside Big Picture');
  return profile;
}
