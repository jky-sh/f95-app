export type SamCategory = 'games' | 'mods' | 'comics' | 'animations' | 'assets';
export type SamSort = 'date' | 'likes' | 'views' | 'rating' | 'title';
export type SamOrder = 'asc' | 'desc';
export type SamTagMode = 'and' | 'or';

export interface SamFilters {
  category?: SamCategory;
  prefixes?: number[];
  noprefixes?: number[];
  tags?: number[];
  notags?: number[];
  tagtype?: SamTagMode;
  search?: string;
  /** Developer name; SAM's title search does not match developers. */
  creator?: string;
  /** Updated within this many days (see `SAM_DATE_RANGES`). */
  date?: number;
  page?: number;
  rows?: number;
  sort?: SamSort;
  order?: SamOrder;
}

/** "Updated within" choices SAM accepts, in days (0 = any time). */
export const SAM_DATE_RANGES = [0, 1, 3, 7, 14, 30, 90, 180, 365] as const;

export interface SamTag {
  id: number;
  name: string;
}

export interface SamPrefixEntry {
  id: number;
  name: string;
  cssClass: string | null;
}

export interface SamPrefixGroup {
  id: number;
  name: string;
  prefixes: SamPrefixEntry[];
}

export interface SamOptionsResult {
  prefixGroups: SamPrefixGroup[];
  tagCatalog: Record<string, string>;
}

export type PrefixFilterMode = 'include' | 'exclude' | null;

export interface SamGameCard {
  threadId: string;
  title: string;
  version: string | null;
  thumbnailUrl: string | null;
  screens: string[];
  threadUrl: string;
  prefixIds: number[];
  tagIds: number[];
  rating: number | null;
  views: number | null;
  likes: number | null;
  updatedAt: string | null;
  updatedTs: number | null;
  creator: string | null;
  watched: boolean;
  ignored: boolean;
  isNew: boolean;
}

export interface SamPage {
  page: number;
  totalPages: number;
  totalRows: number;
  items: SamGameCard[];
  endpoint: string;
}

// Games prefixes as SAM defines them (latest_alpha `latestUpdates.prefixes`,
// checked 2026-09-30). Only a fallback: the sidebar and the pills use the
// live catalog from `sam_options` whenever it loads.
export interface PrefixOption {
  id: number;
  name: string;
  group: 'engine' | 'status' | 'other';
  color: string;
}

export const KNOWN_PREFIXES: PrefixOption[] = [
  // Engines
  { id: 7, name: "Ren'Py", group: 'engine', color: 'var(--status-purple)' },
  { id: 3, name: 'Unity', group: 'engine', color: 'var(--text-faint)' },
  { id: 2, name: 'RPGM', group: 'engine', color: 'var(--status-info)' },
  { id: 31, name: 'Unreal Engine', group: 'engine', color: 'var(--border-faint)' },
  { id: 4, name: 'HTML', group: 'engine', color: '#d97a3a' },
  { id: 8, name: 'Flash', group: 'engine', color: 'var(--accent-strong)' },
  { id: 116, name: 'Godot', group: 'engine', color: '#478cbf' },
  { id: 1, name: 'QSP', group: 'engine', color: '#586e75' },
  { id: 6, name: 'Java', group: 'engine', color: '#b07219' },
  { id: 17, name: 'Tads', group: 'engine', color: '#6f7e8a' },
  { id: 30, name: 'Wolf RPG', group: 'engine', color: '#7a3a9c' },
  { id: 14, name: 'Others', group: 'engine', color: 'var(--text-faint)' },
  { id: 12, name: 'ADRIFT', group: 'engine', color: '#5a8a6a' },
  { id: 5, name: 'RAGS', group: 'engine', color: '#8a5a6a' },
  { id: 47, name: 'WebGL', group: 'engine', color: '#4a9aaa' },
  // Statuses
  { id: 18, name: 'Completed', group: 'status', color: 'var(--status-success)' },
  { id: 20, name: 'Onhold', group: 'status', color: 'var(--status-warning)' },
  { id: 22, name: 'Abandoned', group: 'status', color: '#9c3a3a' },
  // Other
  { id: 13, name: 'VN', group: 'other', color: 'var(--status-info)' },
  { id: 19, name: 'Collection', group: 'other', color: 'var(--text-faint)' },
  { id: 23, name: 'SiteRip', group: 'other', color: 'var(--text-muted)' },
];

export function prefixById(id: number): PrefixOption | undefined {
  return KNOWN_PREFIXES.find((p) => p.id === id);
}
