import type { SamCategory } from './sam';

export type InstallStatus =
  | 'not_installed'
  | 'downloading'
  | 'extracting'
  | 'installed'
  | 'update_available'
  | 'error';

export interface LibraryGame {
  threadId: string;
  category: SamCategory;
  title: string;
  threadUrl: string;
  thumbnailUrl: string | null;
  currentVersion: string | null;
  availableVersion: string | null;
  installStatus: InstallStatus;
  installPath: string | null;
  exePath: string | null;
  addedAt: string;
  lastPlayedAt: string | null;
  totalPlaytimeSeconds: number;
  customTags: string[];
  notes: string;
  /** AppID Steam vinculado (para achievements). Null = nunca vinculado
   *  (autodetecção pode rodar); '' = desvinculado pelo usuário (não
   *  re-detectar sozinho). */
  steamAppid: string | null;
  /** Modo experimental: detectar conquistas nos saves do próprio jogo
   *  (builds DRM-free sem emulador Steam). */
  achSaveScan: boolean;
}

export interface LibraryFilter {
  category?: SamCategory;
  status?: InstallStatus | 'all';
  search?: string;
  sort?: LibrarySort;
}

export type LibrarySort = 'added' | 'title' | 'last_played' | 'playtime';

/**
 * Translation key for an install status. Callers pass the result through
 * `t()` (`t(statusKey(s))`). Kept as a key indirection so the function
 * itself stays pure and locale-agnostic.
 */
export function statusKey(s: InstallStatus): string {
  return `status.${s}`;
}

export function statusColor(s: InstallStatus): string {
  switch (s) {
    case 'installed':
      return 'var(--status-success)';
    case 'downloading':
      return 'var(--status-warning)';
    case 'extracting':
      return '#b07fc7';
    case 'update_available':
      return 'var(--status-info)';
    case 'error':
      return 'var(--accent-strong)';
    case 'not_installed':
    default:
      return 'var(--text-faint)';
  }
}

/**
 * Format a duration in seconds via i18n. Returns the LITERAL string (already
 * translated) because callers need the final text — internally uses
 * `tStandalone` for the active locale.
 */
import { tStandalone } from '../lib/i18n';

export function formatPlaytime(seconds: number): string {
  if (seconds <= 0) return tStandalone('time.neverPlayed');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return tStandalone('time.minutes', { m });
  if (m === 0) return tStandalone('time.hours', { h });
  return tStandalone('time.hoursMinutes', { h, m });
}
