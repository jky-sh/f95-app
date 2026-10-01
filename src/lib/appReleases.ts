/**
 * The app's changelog as GitHub Releases publish it: the notes of every
 * published release, newest first, as GitHub renders them. The last answer
 * is kept on disk, so Settings → About and the version modal show it at
 * once and offline; until a first fetch succeeds, the CHANGELOG.md bundled
 * with the build stands in (lib/changelog).
 */
import { useEffect, useSyncExternalStore } from 'react';
import DOMPurify from 'dompurify';

export const RELEASES_PAGE_URL = 'https://github.com/jky-sh/f95-app/releases';
const RELEASES_API_URL = 'https://api.github.com/repos/jky-sh/f95-app/releases?per_page=30';
const GITHUB_ORIGIN = 'https://github.com';
const STORAGE_KEY = 'f95-app-releases-v1';
/** GitHub allows 60 requests an hour per IP without a token. */
const FRESH_MS = 30 * 60_000;
/** A saved list without the running version (the app was just updated) is refreshed sooner. */
const MISSING_VERSION_RETRY_MS = 2 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface AppRelease {
  /** Tag without a leading "v". */
  version: string;
  publishedAt: string | null;
  url: string;
  /** Notes as GitHub renders them; `prepareReleaseHtml` before showing. */
  html: string;
  prerelease: boolean;
}

export interface AppReleasesState {
  /** Published releases from the last fetch that worked, or from disk. */
  releases: AppRelease[] | null;
  fetchedAt: number | null;
  loading: boolean;
  /** The last fetch failed. */
  failed: boolean;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  body_html?: string | null;
}

interface StoredReleases {
  releases: AppRelease[];
  fetchedAt: number;
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function loadStored(): StoredReleases | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredReleases>;
    if (!Array.isArray(parsed.releases) || typeof parsed.fetchedAt !== 'number') return null;
    return { releases: parsed.releases, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function saveStored(stored: StoredReleases): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // ignore quota / private mode
  }
}

const stored = loadStored();
let state: AppReleasesState = {
  releases: stored?.releases ?? null,
  fetchedAt: stored?.fetchedAt ?? null,
  loading: false,
  failed: false,
};
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function setState(patch: Partial<AppReleasesState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AppReleasesState {
  return state;
}

function toRelease(release: GithubRelease): AppRelease {
  return {
    version: normalizeVersion(release.tag_name),
    publishedAt: release.published_at,
    url: release.html_url,
    html: release.body_html ?? '',
    prerelease: release.prerelease,
  };
}

/** Fetch the published releases again; concurrent calls share one request. */
export function refreshAppReleases(): Promise<void> {
  if (inFlight) return inFlight;
  setState({ loading: true });
  inFlight = (async () => {
    try {
      const res = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github.html+json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const data = (await res.json()) as GithubRelease[];
      const releases = data.filter((release) => !release.draft).map(toRelease);
      const fetchedAt = Date.now();
      saveStored({ releases, fetchedAt });
      setState({ releases, fetchedAt, loading: false, failed: false });
    } catch (err) {
      console.warn('[appReleases] could not load the releases', err);
      setState({ loading: false, failed: true });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function isStale(currentVersion: string | null): boolean {
  if (state.releases == null || state.fetchedAt == null) return true;
  const age = Date.now() - state.fetchedAt;
  if (age > FRESH_MS) return true;
  if (!currentVersion || age <= MISSING_VERSION_RETRY_MS) return false;
  const version = normalizeVersion(currentVersion);
  return !state.releases.some((release) => release.version === version);
}

/**
 * The published releases; refreshes a stale list while `enabled` (pass
 * false offline). `currentVersion` missing from the list counts as stale.
 */
export function useAppReleases(currentVersion: string | null, enabled = true): AppReleasesState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    if (enabled && isStale(currentVersion)) void refreshAppReleases();
  }, [currentVersion, enabled]);
  return snapshot;
}

/**
 * Sanitized notes ready to render: the leading title (the entry's header
 * already names the version) is dropped and GitHub's relative links and
 * images point at github.com.
 */
export function prepareReleaseHtml(html: string): string {
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true });
  const first = fragment.firstElementChild;
  if (first?.tagName === 'H1') first.remove();
  for (const [selector, attr] of [
    ['a[href]', 'href'],
    ['img[src]', 'src'],
  ] as const) {
    fragment.querySelectorAll(selector).forEach((el) => {
      const value = el.getAttribute(attr) ?? '';
      try {
        el.setAttribute(attr, new URL(value, GITHUB_ORIGIN).href);
      } catch {
        el.removeAttribute(attr);
      }
    });
  }
  const holder = document.createElement('div');
  holder.appendChild(fragment);
  return holder.innerHTML.trim();
}
