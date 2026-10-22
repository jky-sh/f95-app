export type HostCategory = 'direct' | 'social' | 'unknown';

export interface HostInfo {
  host: string;
  category: HostCategory;
}

interface Pattern {
  host: string;
  regex: RegExp;
  category: HostCategory;
}

/** Every MixDrop mirror seen live (most 302 to mxdrop.top); the resolver uses the same list. */
export const MIXDROP_HOST_RE =
  /^(www\.)?(mixdrop\.(co|ag|sx|to|top|club|gl|ch|ms|nu|bz|vc|is|si|ps|my|sb)|mixdrp\.(co|to)|mxdrop\.(to|top)|m1xdrop\.(com|net))$/i;

const PATTERNS: Pattern[] = [
  // direct file hosts
  { host: 'mega',          regex: /^(www\.)?mega\.(nz|co\.nz|io)$/i,                       category: 'direct' },
  { host: 'mediafire',     regex: /^(www\.)?mediafire\.com$/i,                              category: 'direct' },
  { host: 'mixdrop',       regex: MIXDROP_HOST_RE,                                          category: 'direct' },
  { host: 'pixeldrain',    regex: /^(www\.)?pixeldrain\.com$/i,                             category: 'direct' },
  { host: 'gofile',        regex: /^(www\.)?gofile\.io$/i,                                  category: 'direct' },
  { host: 'workupload',    regex: /^(www\.)?workupload\.com$/i,                             category: 'direct' },
  { host: 'anonfiles',     regex: /^(www\.)?anonfiles\.com$/i,                              category: 'direct' },
  { host: 'datanodes',     regex: /^(www\.)?datanodes\.to$/i,                               category: 'direct' },
  { host: 'buzzheavier',   regex: /^(www\.)?(buzzheavier\.com|bzzhr\.(co|to)|fuckingfast\.(net|co))$/i, category: 'direct' },
  { host: 'vikingfile',    regex: /^(www\.)?(vikingfile\.com|vik1ngfile\.site|vikingf1le\.us\.to)$/i, category: 'direct' },
  { host: 'terminal',      regex: /^(www\.)?terminal\.lc$/i,                                category: 'direct' },
  { host: 'akirabox',      regex: /^(www\.)?akirabox\.(com|to)$/i,                          category: 'direct' },
  { host: 'bowfile',       regex: /^(www\.)?bowfile\.com$/i,                                category: 'direct' },
  { host: 'uploadnow',     regex: /^(www\.)?uploadnow\.(io|co|app)$/i,                      category: 'direct' },
  { host: 'krakenfiles',   regex: /^(www\.)?krakenfiles\.com$/i,                            category: 'direct' },
  { host: 'wdho',          regex: /^(www\.)?wdho\.ru$/i,                                    category: 'direct' },
  { host: 'qu.ax',         regex: /^(www\.)?qu\.ax$/i,                                      category: 'direct' },
  { host: 'files.dp.ua',   regex: /^(www\.)?files\.dp\.ua$/i,                               category: 'direct' },
  { host: 'racaty',        regex: /^(www\.)?racaty\.(net|io)$/i,                            category: 'direct' },
  { host: 'uploadhaven',   regex: /^(www\.)?uploadhaven\.com$/i,                            category: 'direct' },
  { host: 'zippyshare',    regex: /^(www\.)?zippyshare\.com$/i,                             category: 'direct' },
  { host: 'k2s',           regex: /^(www\.)?k2s\.cc$/i,                                     category: 'direct' },
  { host: 'rapidgator',    regex: /^(www\.)?rapidgator\.net$/i,                             category: 'direct' },
  { host: 'turbobit',      regex: /^(www\.)?turbobit\.net$/i,                               category: 'direct' },
  { host: 'nopy',          regex: /^(www\.)?nopy\.to$/i,                                    category: 'direct' },
  { host: 'sendspace',     regex: /^(www\.)?sendspace\.com$/i,                              category: 'direct' },
  { host: '1fichier',      regex: /^(www\.)?1fichier\.com$/i,                               category: 'direct' },
  { host: 'bunkr',         regex: /^(.*\.)?bunkr\.(ru|sk|si|la|fi|ws|cr|red|ph|pk|black)$/i, category: 'direct' },
  { host: 'cyberfile',     regex: /^(www\.)?cyberfile\.(me|is|su)$/i,                       category: 'direct' },
  { host: 'cyberdrop',     regex: /^(www\.)?cyberdrop\.me$/i,                               category: 'direct' },
  { host: 'dropbox',       regex: /^(www\.)?dropbox\.com$/i,                                category: 'direct' },
  { host: 'gdrive',        regex: /^(drive|docs)\.google\.com$/i,                           category: 'direct' },
  { host: 'pcloud',        regex: /^(my\.|www\.)?pcloud\.com$|^u\.pcloud\.link$/i,          category: 'direct' },
  // social / creator pages (linked from threads but not downloads)
  { host: 'patreon',       regex: /^(www\.)?patreon\.com$/i,                                category: 'social' },
  { host: 'subscribestar', regex: /^(www\.)?subscribestar\.(adult|com)$/i,                  category: 'social' },
  { host: 'twitter',       regex: /^(www\.)?(twitter|x)\.com$/i,                            category: 'social' },
  { host: 'discord',       regex: /^(www\.)?discord\.(gg|com)$/i,                           category: 'social' },
  { host: 'itch',          regex: /^(.+\.)?itch\.io$/i,                                     category: 'social' },
  { host: 'ko-fi',         regex: /^(www\.)?ko-fi\.com$/i,                                  category: 'social' },
  { host: 'youtube',       regex: /^(www\.)?(youtube\.com|youtu\.be)$/i,                    category: 'social' },
];

/**
 * Classify a URL by inspecting its hostname. F95Zone wraps download links in
 * its own redirector at `/masked/<host>/<thread>/<key>` — when we see that, we
 * read the real host from the path segment instead of the URL hostname.
 */
export function classifyHost(rawUrl: string): HostInfo | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }

  if (u.hostname.toLowerCase() === 'f95zone.to' && u.pathname.startsWith('/masked/')) {
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length >= 2) {
      const rawHost = segs[1];
      const match = PATTERNS.find((p) => p.regex.test(rawHost));
      if (match) return { host: match.host, category: match.category };
      // Unknown but clearly a download intent (F95 only masks downloads).
      return { host: rawHost.toLowerCase(), category: 'direct' };
    }
  }

  const m = PATTERNS.find((p) => p.regex.test(u.hostname));
  if (m) return { host: m.host, category: m.category };
  return null;
}

/**
 * F95's download pages (since October 2026): `/dl/<postId>/?u=…&k=…&r=…&t=…`.
 * The URL no longer names the host, and it expires a few hours after the
 * thread was opened.
 */
export function isF95DownloadPage(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.hostname.toLowerCase() === 'f95zone.to' && /^\/dl\/\d+\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Host of a link to F95's download page. The thread shows the host's
 * favicon (`…/ip3/<domain>.ico`) beside the label, so the domain comes from
 * there; the label ("MEGA", "GOFILE") covers links without one. Every such
 * link is a download, so an unknown host keeps its own name.
 */
export function classifyF95DownloadLink(faviconDomain: string | null, label: string): HostInfo {
  const domain = faviconDomain?.trim().toLowerCase().replace(/^www\./, '') || null;
  if (domain) {
    const match = PATTERNS.find((p) => p.regex.test(domain));
    if (match) return { host: match.host, category: 'direct' };
  }
  const byLabel = hostForLabel(label);
  if (byLabel) return { host: byLabel, category: 'direct' };
  return { host: domain ?? (normalizeLabel(label) || 'f95zone'), category: 'direct' };
}

/** Labels threads use for hosts whose id is spelled differently. */
const LABEL_ALIASES: Record<string, string> = {
  googledrive: 'gdrive',
  gdrive: 'gdrive',
  kraken: 'krakenfiles',
  fuckingfast: 'buzzheavier',
  bzzhr: 'buzzheavier',
  mxdrop: 'mixdrop',
  keep2share: 'k2s',
};

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hostForLabel(label: string): string | null {
  const key = normalizeLabel(label);
  if (!key) return null;
  if (LABEL_ALIASES[key]) return LABEL_ALIASES[key];
  const match = PATTERNS.find((p) => p.category === 'direct' && normalizeLabel(p.host) === key);
  return match ? match.host : null;
}
