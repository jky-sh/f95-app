import { useLocation } from 'react-router-dom';
import { parseSamCategory } from '../constants/samCategories';
import {
  SAM_DATE_RANGES,
  type PrefixFilterMode,
  type SamCategory,
  type SamSort,
  type SamTagMode,
} from '../types/sam';

/**
 * Store filters as they live in the URL (`/store?cat=mods&sort=likes&t=12,40`),
 * so Back from a game, the nav link or a reload opens the same list.
 * Defaults are left out to keep the URL short.
 */
export interface StoreQuery {
  category: SamCategory;
  search: string;
  /** Developer filter (SAM `creator`). */
  creator: string;
  /** Which of the two the search box edits. */
  searchIn: 'title' | 'creator';
  sort: SamSort;
  /** Updated within this many days; 0 = any time. */
  date: number;
  prefixFilter: Record<number, PrefixFilterMode>;
  tagIds: number[];
  excludedTagIds: number[];
  tagMode: SamTagMode;
  /** Page shown in paged mode (1-based). */
  page: number;
}

const SORTS: readonly SamSort[] = ['date', 'likes', 'views', 'rating', 'title'];

function readIds(raw: string | null): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const id = Number(part);
    if (Number.isInteger(id) && id > 0 && !out.includes(id)) out.push(id);
  }
  return out;
}

export function readStoreQuery(params: URLSearchParams): StoreQuery {
  const prefixFilter: Record<number, PrefixFilterMode> = {};
  for (const id of readIds(params.get('pi'))) prefixFilter[id] = 'include';
  for (const id of readIds(params.get('px'))) prefixFilter[id] = 'exclude';
  const sort = params.get('sort') as SamSort | null;
  const page = Number(params.get('page'));
  const date = Number(params.get('d'));
  const tagIds = readIds(params.get('t'));
  return {
    category: parseSamCategory(params.get('cat')),
    search: params.get('q') ?? '',
    creator: params.get('dev') ?? '',
    searchIn:
      params.get('in') === 'dev' || (params.has('dev') && !params.has('q')) ? 'creator' : 'title',
    sort: sort && SORTS.includes(sort) ? sort : 'date',
    date: (SAM_DATE_RANGES as readonly number[]).includes(date) ? date : 0,
    prefixFilter,
    tagIds,
    excludedTagIds: readIds(params.get('tx')).filter((id) => !tagIds.includes(id)),
    tagMode: params.get('tm') === 'and' ? 'and' : 'or',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function writeStoreQuery(query: StoreQuery): URLSearchParams {
  const params = new URLSearchParams();
  const prefixes = (mode: PrefixFilterMode) =>
    Object.entries(query.prefixFilter)
      .filter(([, m]) => m === mode)
      .map(([id]) => id)
      .join(',');
  if (query.category !== 'games') params.set('cat', query.category);
  if (query.search.trim()) params.set('q', query.search);
  if (query.creator.trim()) params.set('dev', query.creator);
  if (query.searchIn === 'creator') params.set('in', 'dev');
  if (query.sort !== 'date') params.set('sort', query.sort);
  if (query.date > 0) params.set('d', String(query.date));
  if (prefixes('include')) params.set('pi', prefixes('include'));
  if (prefixes('exclude')) params.set('px', prefixes('exclude'));
  if (query.tagIds.length > 0) params.set('t', query.tagIds.join(','));
  if (query.excludedTagIds.length > 0) params.set('tx', query.excludedTagIds.join(','));
  if (query.tagMode === 'and') params.set('tm', 'and');
  if (query.page > 1) params.set('page', String(query.page));
  return params;
}

/** Query string of the store list last shown (`?cat=mods…` or ''). */
let lastStoreSearch = '';

export function rememberStoreSearch(search: string): void {
  lastStoreSearch = search;
}

/**
 * Link back to the store as the user left it. Reads the location so nav
 * links holding it re-render after every navigation (on the store itself
 * the remembered query is one render behind, so use the live one).
 */
export function useStoreHref(): string {
  const location = useLocation();
  if (location.pathname === '/store') return `/store${location.search}`;
  return `/store${lastStoreSearch}`;
}
