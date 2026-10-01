import type { GameDownload } from '../types/game';
import type { DownloadRow } from '../types/download';

/**
 * Hosts the app downloads by itself, with no one at the keyboard. The ones
 * in `VERIFY_HOSTS` also download in the app, after a quick check; the
 * others go to the queue and finish in the browser.
 */
export const STREAMABLE_HOSTS = new Set(['pixeldrain', 'mediafire', 'gofile', 'mega', 'uploadhaven', 'buzzheavier', 'datanodes', 'gdrive', 'workupload', 'bowfile', 'uploadnow', 'terminal']);

/**
 * Hosts whose link only comes after a human check (Turnstile or reCAPTCHA),
 * done in the app's own small verification window. Same list as
 * `VERIFY_WINDOW_HOSTS` in `src-tauri/src/download/host.rs`.
 */
export const VERIFY_HOSTS = new Set(['mixdrop', 'vikingfile', 'akirabox']);

/** Of those, the ones where the user presses "Continue download" after the
 * check; the others continue by themselves once the page has the link. */
const VERIFY_NEEDS_CONTINUE = new Set(['mixdrop']);

export function needsVerifyWindow(host: string): boolean {
  return VERIFY_HOSTS.has(host.trim().toLowerCase());
}

export function verifyNeedsContinue(host: string): boolean {
  return VERIFY_NEEDS_CONTINUE.has(host.trim().toLowerCase());
}

/** How a link gets downloaded, for the labels in the install pickers. */
export type HostDelivery = 'app' | 'verify' | 'browser';

export function hostDelivery(host: string): HostDelivery {
  if (needsVerifyWindow(host)) return 'verify';
  return STREAMABLE_HOSTS.has(host) ? 'app' : 'browser';
}

/**
 * A `needs_browser` row the verification window can finish. Not when F95
 * itself asked for a captcha before revealing the host link: that one only
 * opens in the browser.
 */
export function canVerifyInApp(row: Pick<DownloadRow, 'state' | 'host' | 'resolvedUrl'>): boolean {
  if (row.state !== 'needs_browser' || !row.resolvedUrl) return false;
  if (/^https?:\/\/f95zone\.to\/masked\//i.test(row.resolvedUrl)) return false;
  return needsVerifyWindow(row.host) && verifyWindowOpens(row.host, row.resolvedUrl);
}

/**
 * Links the window can open, as `verify::page_url` in Rust decides: a
 * VikingFile `/f/<hash>` page, an AkiraBox file or folder page. Anything
 * else (a VikingFile folder…) only opens in the browser.
 */
function verifyWindowOpens(host: string, url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const site = u.hostname.replace(/^www\./, '');
  const [first = '', second = ''] = u.pathname.split('/').filter(Boolean);
  switch (host.trim().toLowerCase()) {
    case 'vikingfile':
      return (
        ['vikingfile.com', 'vik1ngfile.site', 'vikingf1le.us.to'].includes(site) &&
        first === 'f' &&
        /^[A-Za-z0-9]{6,16}$/.test(second)
      );
    case 'akirabox':
      return (
        ['akirabox.com', 'akirabox.to'].includes(site) &&
        /^[A-Za-z0-9]{6,32}$/.test(first) &&
        (second === 'file' || second === 'folder')
      );
    default:
      // MixDrop: its page is rebuilt from any of its links.
      return true;
  }
}

export const HOST_COLORS: Record<string, string> = {
  mega: '#d9272e',
  mediafire: 'var(--status-info)',
  mixdrop: '#e85c00',
  pixeldrain: '#3a3a8f',
  gofile: '#4d4d4d',
  workupload: '#1f7a3a',
  uploadhaven: '#888888',
  datanodes: '#2a8aa8',
  buzzheavier: '#a87a2a',
  gdrive: '#4285f4',
  vikingfile: '#c0392b',
  akirabox: '#7b4fd6',
  bowfile: '#2f6fb3',
  uploadnow: '#18a57b',
  terminal: '#70c65e',
  krakenfiles: '#3a6f8a',
  bunkr: '#8a3a3a',
  cyberfile: '#6f4d8a',
  cyberdrop: '#8a4d6f',
  rapidgator: '#cc8a3a',
  '1fichier': '#3aaa8a',
};

/** The host next to a link's label, unless the label already names it. */
export function shouldShowHostBadge(label: string, host: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s._-]+/g, '');
  const nl = norm(label);
  const nh = norm(host);
  if (!nh) return false;
  if (nl === nh) return false;
  if (nl.includes(nh) || nh.includes(nl)) return false;
  return true;
}

/** Links by the thread's section label ("Win/Linux", "Mac"…), in thread order. */
export function groupDownloads(items: GameDownload[]): [string | null, GameDownload[]][] {
  const map = new Map<string | null, GameDownload[]>();
  const order: (string | null)[] = [];
  for (const item of items) {
    const key = item.group?.trim() || null;
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)!.push(item);
  }
  return order.map((key) => [key, map.get(key)!]);
}
