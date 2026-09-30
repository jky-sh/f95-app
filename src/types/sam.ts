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

// Curated subset of well-known F95Zone prefix IDs used for the filter sidebar
// in the first store iteration. Verified via community catalog; refinements
// can come from a live `samPrefixes` RPC later.
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
  { id: 8, name: 'Unreal Engine', group: 'engine', color: 'var(--border-faint)' },
  { id: 15, name: 'HTML', group: 'engine', color: '#d97a3a' },
  { id: 1, name: 'Flash', group: 'engine', color: 'var(--accent-strong)' },
  { id: 16, name: 'QSP', group: 'engine', color: '#586e75' },
  { id: 17, name: 'Java', group: 'engine', color: '#b07219' },
  { id: 18, name: 'Tads', group: 'engine', color: '#6f7e8a' },
  { id: 32, name: 'Wolf RPG', group: 'engine', color: '#7a3a9c' },
  { id: 24, name: 'Others', group: 'engine', color: 'var(--text-faint)' },
  { id: 26, name: 'ADRIFT', group: 'engine', color: '#5a8a6a' },
  { id: 19, name: 'RAGS', group: 'engine', color: '#8a5a6a' },
  { id: 31, name: 'WebGL', group: 'engine', color: '#4a9aaa' },
  // Statuses
  { id: 22, name: 'Completed', group: 'status', color: 'var(--status-success)' },
  { id: 23, name: 'On Hold', group: 'status', color: 'var(--status-warning)' },
  { id: 21, name: 'Abandoned', group: 'status', color: '#9c3a3a' },
  // Other
  { id: 13, name: 'VN', group: 'other', color: 'var(--status-info)' },
  { id: 25, name: 'Collection', group: 'other', color: 'var(--text-faint)' },
  { id: 27, name: 'SiteRip', group: 'other', color: 'var(--text-muted)' },
];

export function prefixById(id: number): PrefixOption | undefined {
  return KNOWN_PREFIXES.find((p) => p.id === id);
}
