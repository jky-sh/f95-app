import { parseSamCategory } from '../constants/samCategories';
import type { InstallStatus, LibrarySort } from '../types/library';
import type { SamCategory } from '../types/sam';

export type LibraryStatusFilter = InstallStatus | 'all';

/**
 * Library filters as they live in the URL (`/library?cat=mods&st=installed`),
 * so Back from a game and the nav link reopen the same view. Defaults are
 * left out.
 */
export interface LibraryQuery {
  category: SamCategory;
  status: LibraryStatusFilter;
  search: string;
  sort: LibrarySort;
}

const STATUSES: readonly LibraryStatusFilter[] = [
  'all',
  'installed',
  'not_installed',
  'downloading',
  'extracting',
  'update_available',
  'error',
];

export const LIBRARY_SORTS: readonly LibrarySort[] = [
  'added',
  'title',
  'last_played',
  'playtime',
  'size',
  'rating',
];

export function readLibraryQuery(params: URLSearchParams): LibraryQuery {
  const status = params.get('st') as LibraryStatusFilter | null;
  const sort = params.get('sort') as LibrarySort | null;
  return {
    category: parseSamCategory(params.get('cat')),
    status: status && STATUSES.includes(status) ? status : 'all',
    search: params.get('q') ?? '',
    sort: sort && LIBRARY_SORTS.includes(sort) ? sort : 'added',
  };
}

export function writeLibraryQuery(query: LibraryQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.category !== 'games') params.set('cat', query.category);
  if (query.status !== 'all') params.set('st', query.status);
  if (query.search.trim()) params.set('q', query.search);
  if (query.sort !== 'added') params.set('sort', query.sort);
  return params;
}
