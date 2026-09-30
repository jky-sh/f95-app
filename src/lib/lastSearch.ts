import { useLocation } from 'react-router-dom';

/** Query string each list page was last shown with, for the session. */
const lastSearch = new Map<string, string>();

/** Called by list pages whenever their URL query changes. */
export function rememberSearch(path: string, search: string): void {
  lastSearch.set(path, search);
}

/**
 * Link back to a list page as the user left it (filters, category, page).
 * Reads the location so nav links re-render after every navigation; on the
 * page itself the remembered query lags one render, so use the live one.
 */
export function useSectionHref(path: string): string {
  const location = useLocation();
  if (location.pathname === path) return `${path}${location.search}`;
  return `${path}${lastSearch.get(path) ?? ''}`;
}
