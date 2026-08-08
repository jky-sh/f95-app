import { BrowserClient } from 'browser-rest-api';
import { RPC_ERROR, RpcError } from '../../rpc';
import { log } from '../../logger';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE } from '../../shared/constants';
import { parseRssXml, type RssFeed, type RssFeedItem } from './rss';
import {
  buildSearchVariants,
  mergeSamPages,
  rankSamPage,
} from './search';

export type { RssFeed, RssFeedItem };

const BASE = F95_BASE;

// The /sam/latest_alpha/ page is bootstrapped by assets/js/latest.min.js, which
// hits this relative URL with cmd=list|tags|options. Confirmed by reading the
// minified script; refine via __manual__/probe-sam.ts if it ever changes.
const SAM_DATA_URL = `${BASE}/sam/latest_alpha/latest_data.php`;

export type SamCategory = 'games' | 'mods' | 'comics' | 'animations' | 'assets';
// F95Zone tabs use these values directly. "title" sorts alphabetically; the
// JS passes whatever is in data-sort.
export type SamSort = 'date' | 'likes' | 'views' | 'rating' | 'title';

export type SamTagMode = 'and' | 'or';

export interface SamFilters {
  category?: SamCategory;
  /** Include-only prefix IDs (sent as `prefixes[]`). */
  prefixes?: number[];
  /** Exclude prefix IDs (sent as `noprefixes[]`). */
  noprefixes?: number[];
  tags?: number[];
  notags?: number[];
  tagtype?: SamTagMode;
  search?: string;
  page?: number;
  rows?: number;
  sort?: SamSort;
  order?: 'asc' | 'desc';
}

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
  /** Human-readable relative date as F95 returns it (e.g. "1 hr", "3 days"). */
  updatedAt: string | null;
  /** Unix timestamp in seconds (from F95's `ts` field), or null if absent. */
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

export interface SamOptionsResult {
  prefixGroups: SamPrefixGroup[];
  /** tag_id → display name (same map as `latestUpdates.tags` on the SAM page). */
  tagCatalog: Record<string, string>;
}

const SAM_PAGE_URL = `${BASE}/sam/latest_alpha/`;

/** Shared tag id → name map; F95's `cmd=tags` only returns ids. */
let tagCatalogCache = new Map<number, string>();

export class SamClient {
  constructor(private readonly http: BrowserClient) {}

  async list(filters: SamFilters): Promise<SamPage> {
    const rawSearch = filters.search?.trim() ?? '';
    if (!rawSearch) {
      return this.fetchList(filters);
    }

    const variants = buildSearchVariants(rawSearch);
    const pageNum = filters.page ?? 1;
    const rows = filters.rows ?? 15;

    // Page > 1: keep a stable normalized query so pagination stays consistent.
    if (pageNum > 1) {
      const page = await this.fetchList({ ...filters, search: variants[0] ?? rawSearch });
      return rankSamPage(page, rawSearch) as SamPage;
    }

    const collected: SamPage[] = [];
    for (const variant of variants) {
      const page = await this.fetchList({ ...filters, search: variant, page: 1 });
      if (page.items.length === 0 && page.totalRows === 0) continue;
      collected.push(page);

      // Good enough hit on the preferred variant — rank and return.
      if (collected.length === 1 && page.items.length >= Math.min(5, rows)) {
        log(`[sam] search hit with variant="${variant}" rows=${page.totalRows}`);
        return rankSamPage(page, rawSearch) as SamPage;
      }

      // After a few fallback variants, merge what we have.
      if (collected.length >= 3) break;
    }

    if (collected.length === 0) {
      return rankSamPage(
        await this.fetchList({ ...filters, search: variants[0] ?? rawSearch }),
        rawSearch,
      ) as SamPage;
    }

    if (collected.length === 1) {
      return rankSamPage(collected[0], rawSearch) as SamPage;
    }

    log(`[sam] search merged ${collected.length} variants for "${rawSearch}"`);
    return mergeSamPages(collected, rawSearch, rows) as SamPage;
  }

  private async fetchList(filters: SamFilters): Promise<SamPage> {
    const params = new URLSearchParams();
    params.set('cmd', 'list');
    params.set('cat', filters.category ?? 'games');
    params.set('page', String(filters.page ?? 1));
    params.set('rows', String(filters.rows ?? 15));
    params.set('sort', filters.sort ?? 'date');
    if (filters.order) params.set('order', filters.order);
    if (filters.search) params.set('search', filters.search);
    for (const p of filters.prefixes ?? []) params.append('prefixes[]', String(p));
    for (const p of filters.noprefixes ?? []) params.append('noprefixes[]', String(p));
    for (const t of filters.tags ?? []) params.append('tags[]', String(t));
    for (const t of filters.notags ?? []) params.append('notags[]', String(t));
    if (filters.tagtype) params.set('tagtype', filters.tagtype);

    const url = `${SAM_DATA_URL}?${params.toString()}`;
    log(`[sam] GET ${url}`);
    const res = await this.http.get(url, {
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on SAM endpoint',
    });
    if (res.status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `SAM list HTTP ${res.status} (body head: ${res.body.slice(0, 200)})`,
      );
    }
    return normalizeSamPage(res.body, filters, url);
  }

  /** Autocomplete tags for the filter sidebar (`cmd=tags`). */
  async searchTags(category: SamCategory, search: string): Promise<SamTag[]> {
    await this.ensureTagCatalog();

    const params = new URLSearchParams();
    params.set('cmd', 'tags');
    params.set('cat', category);
    const q = search.trim();
    if (q) params.set('search', q);
    const url = `${SAM_DATA_URL}?${params.toString()}`;
    log(`[sam] GET ${url}`);
    const res = await this.http.get(url, {
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on SAM endpoint',
    });
    if (res.status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `SAM tags HTTP ${res.status} (body head: ${res.body.slice(0, 200)})`,
      );
    }

    const remote = normalizeSamTags(res.body, tagCatalogCache);
    if (q) {
      // Merge local catalog matches so typos / partial names still surface.
      const local = searchCatalogTags(tagCatalogCache, q, 40);
      return mergeTagLists(remote, local).slice(0, 40);
    }
    return remote.length > 0 ? remote : searchCatalogTags(tagCatalogCache, '', 40);
  }

  private async ensureTagCatalog(): Promise<void> {
    if (tagCatalogCache.size >= 80) return;
    try {
      const fromPage = await this.bootstrapTagCatalog();
      mergeTagCatalog(fromPage);
    } catch (err) {
      log(`[sam] tag catalog ensure skipped: ${(err as Error).message}`);
    }
  }

  /** Latest updates RSS feed (`cmd=rss`). Public — no login required. */
  async fetchRss(category: SamCategory = 'games'): Promise<RssFeed> {
    const params = new URLSearchParams();
    params.set('cmd', 'rss');
    params.set('cat', category);
    const url = `${SAM_DATA_URL}?${params.toString()}`;
    log(`[sam] GET ${url}`);
    const res = await this.http.get(url, {
      headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on SAM RSS endpoint',
    });
    if (res.status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `SAM RSS HTTP ${res.status} (body head: ${res.body.slice(0, 200)})`,
      );
    }
    return parseRssXml(res.body);
  }

  /** Prefix groups + tag catalog for filters and card labels. */
  async options(category: SamCategory): Promise<SamOptionsResult> {
    const params = new URLSearchParams();
    params.set('cmd', 'options');
    params.set('cat', category);
    const url = `${SAM_DATA_URL}?${params.toString()}`;
    log(`[sam] GET ${url}`);
    const res = await this.http.get(url, {
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on SAM endpoint',
    });
    if (res.status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `SAM options HTTP ${res.status} (body head: ${res.body.slice(0, 200)})`,
      );
    }

    let prefixGroups = normalizeSamPrefixGroups(res.body, category);
    const fromOptions = parseTagCatalogFromJson(res.body);
    mergeTagCatalog(fromOptions);

    if (prefixGroups.length === 0) {
      try {
        prefixGroups = await this.bootstrapPrefixGroups(category);
        if (prefixGroups.length > 0) {
          log(`[sam] prefix groups bootstrapped from SAM page (${prefixGroups.length} groups)`);
        }
      } catch (err) {
        log(`[sam] prefix bootstrap skipped: ${(err as Error).message}`);
      }
    }

    if (tagCatalogCache.size < 200) {
      try {
        const fromPage = await this.bootstrapTagCatalog();
        mergeTagCatalog(fromPage);
        if (fromPage.size > 0) {
          log(`[sam] tag catalog size=${tagCatalogCache.size}`);
        }
      } catch (err) {
        log(`[sam] tag catalog bootstrap skipped: ${(err as Error).message}`);
      }
    }

    return {
      prefixGroups,
      tagCatalog: catalogToRecord(tagCatalogCache),
    };
  }

  /** Load `latestUpdates.prefixes` embedded in the SAM HTML (logged-in page). */
  private async bootstrapPrefixGroups(category: SamCategory): Promise<SamPrefixGroup[]> {
    log(`[sam] GET ${SAM_PAGE_URL} (prefix bootstrap)`);
    const res = await this.http.get(SAM_PAGE_URL, {
      headers: { accept: 'text/html', 'x-requested-with': 'XMLHttpRequest' },
    });
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on SAM endpoint',
    });
    if (res.status >= 400) {
      throw new RpcError(RPC_ERROR.INTERNAL, `SAM page HTTP ${res.status}`);
    }
    return extractPrefixGroupsFromHtml(res.body, category);
  }

  /** Load `latestUpdates.tags` embedded in the SAM HTML (logged-in page). */
  private async bootstrapTagCatalog(): Promise<Map<number, string>> {
    log(`[sam] GET ${SAM_PAGE_URL} (tag catalog bootstrap)`);
    const res = await this.http.get(SAM_PAGE_URL, {
      headers: { accept: 'text/html', 'x-requested-with': 'XMLHttpRequest' },
    });
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on SAM endpoint',
    });
    if (res.status >= 400) {
      throw new RpcError(RPC_ERROR.INTERNAL, `SAM page HTTP ${res.status}`);
    }
    return extractTagCatalogFromHtml(res.body);
  }
}

/** @internal Exported for unit tests. */
export function normalizeSamTags(body: string, catalog: Map<number, string>): SamTag[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const root = (parsed as Record<string, unknown>) ?? {};
  const msg = root.msg ?? parsed;
  const list = extractTagList(msg);
  const out: SamTag[] = [];
  const seen = new Set<number>();
  for (const raw of list) {
    const tag = toTag(raw, catalog);
    if (!tag || seen.has(tag.id)) continue;
    seen.add(tag.id);
    // Keep resolving names into the shared catalog for later autocomplete/pills.
    if (tag.name && !tag.name.startsWith('#')) {
      catalog.set(tag.id, tag.name);
    }
    out.push(tag);
  }
  return out.slice(0, 40);
}

function extractTagList(msg: unknown): unknown[] {
  if (Array.isArray(msg)) return msg;
  if (msg && typeof msg === 'object') {
    const m = msg as Record<string, unknown>;
    if (Array.isArray(m.data)) return m.data;
    if (Array.isArray(m.tags)) return m.tags;
    // Shape: { "123": "oral sex", "456": "romance" }
    if (m.tags && typeof m.tags === 'object' && !Array.isArray(m.tags)) {
      return Object.entries(m.tags as Record<string, unknown>).map(([id, name]) => ({
        id,
        name,
      }));
    }
    // Bare id→name map as the message itself.
    const entries = Object.entries(m);
    if (
      entries.length > 0 &&
      entries.every(([k, v]) => numberOrNull(k) !== null && (typeof v === 'string' || typeof v === 'number'))
    ) {
      return entries.map(([id, name]) => ({ id, name: String(name) }));
    }
  }
  return [];
}

function toTag(raw: unknown, catalog: Map<number, string>): SamTag | null {
  // cmd=tags frequently returns plain ids: [107, 162, ...]
  if (typeof raw === 'number' || typeof raw === 'string') {
    const id = numberOrNull(raw);
    if (id === null) return null;
    const name = catalog.get(id) ?? null;
    if (!name) return null;
    return { id, name };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = numberOrNull(r.id ?? r.tag_id ?? r.tagId);
  if (id === null) return null;
  const name =
    stringOrNull(r.name ?? r.tag ?? r.label ?? r.title) ?? catalog.get(id) ?? null;
  if (!name) return null;
  return { id, name };
}

function searchCatalogTags(
  catalog: Map<number, string>,
  query: string,
  limit: number,
): SamTag[] {
  const q = query.trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const scored: { tag: SamTag; score: number }[] = [];

  for (const [id, name] of catalog) {
    const lower = name.toLowerCase();
    let score = 0;
    if (!q) {
      score = 1;
    } else if (lower === q) {
      score = 100;
    } else if (lower.startsWith(q)) {
      score = 80;
    } else if (lower.includes(q)) {
      score = 50;
    } else if (tokens.length > 0 && tokens.every((t) => lower.includes(t))) {
      score = 40;
    } else {
      continue;
    }
    scored.push({ tag: { id, name }, score });
  }

  scored.sort((a, b) => b.score - a.score || a.tag.name.localeCompare(b.tag.name));
  return scored.slice(0, limit).map((s) => s.tag);
}

function mergeTagLists(primary: SamTag[], secondary: SamTag[]): SamTag[] {
  const out = new Map<number, SamTag>();
  for (const tag of primary) out.set(tag.id, tag);
  for (const tag of secondary) {
    if (!out.has(tag.id)) out.set(tag.id, tag);
  }
  return [...out.values()];
}

function mergeTagCatalog(source: Map<number, string>): void {
  for (const [id, name] of source) {
    tagCatalogCache.set(id, name);
  }
}

function catalogToRecord(catalog: Map<number, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, name] of catalog) {
    out[String(id)] = name;
  }
  return out;
}

function parseTagCatalogFromJson(body: string): Map<number, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Map();
  }
  const root = (parsed as Record<string, unknown>) ?? {};
  const msg = (root.msg ?? parsed) as Record<string, unknown>;
  return parseTagCatalogObject(msg.tags ?? root.tags);
}

function parseTagCatalogObject(value: unknown): Map<number, string> {
  const map = new Map<number, string>();
  if (!value || typeof value !== 'object') return map;

  if (Array.isArray(value)) {
    for (const raw of value) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const r = raw as Record<string, unknown>;
      const id = numberOrNull(r.id ?? r.tag_id ?? r.tagId);
      const name = stringOrNull(r.name ?? r.tag ?? r.label ?? r.title);
      if (id !== null && name) map.set(id, name);
    }
    return map;
  }

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const id = numberOrNull(key);
    const name =
      typeof val === 'string'
        ? val.trim()
        : val && typeof val === 'object' && !Array.isArray(val)
          ? stringOrNull((val as Record<string, unknown>).name ?? (val as Record<string, unknown>).tag)
          : null;
    if (id !== null && name) map.set(id, name);
  }
  return map;
}

function extractTagCatalogFromHtml(html: string): Map<number, string> {
  const map = new Map<number, string>();

  const blockMatch = html.match(/latestUpdates\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (blockMatch) {
    try {
      const obj = JSON.parse(blockMatch[1]) as Record<string, unknown>;
      for (const [id, name] of parseTagCatalogObject(obj.tags)) {
        map.set(id, name);
      }
    } catch {
      // fall through to regex extraction
    }
  }

  if (map.size === 0) {
    const tagsMatch = html.match(/"tags"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/);
    if (tagsMatch) {
      try {
        for (const [id, name] of parseTagCatalogObject(JSON.parse(tagsMatch[1]))) {
          map.set(id, name);
        }
      } catch {
        // ignore malformed fragment
      }
    }
  }

  return map;
}

/** @internal Exported for unit tests. */
export function normalizeSamPrefixGroups(body: string, category: SamCategory): SamPrefixGroup[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const root = (parsed as Record<string, unknown>) ?? {};
  if (root.status === 'error') return [];

  const msgVal = root.msg ?? parsed;
  let prefixesRoot: unknown;
  if (msgVal && typeof msgVal === 'object' && !Array.isArray(msgVal)) {
    prefixesRoot = (msgVal as Record<string, unknown>).prefixes ?? root.prefixes;
  } else {
    prefixesRoot = root.prefixes;
  }

  return parsePrefixGroupsForCategory(prefixesRoot, category);
}

function extractPrefixGroupsFromHtml(html: string, category: SamCategory): SamPrefixGroup[] {
  const blockMatch = html.match(/latestUpdates\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!blockMatch) return [];
  try {
    const obj = JSON.parse(blockMatch[1]) as Record<string, unknown>;
    return parsePrefixGroupsForCategory(obj.prefixes, category);
  } catch {
    return [];
  }
}

/** Supports F95 shapes: `prefixes.games[]`, flat `prefixes[]` (cat in query), or object map. */
function parsePrefixGroupsForCategory(prefixesRoot: unknown, category: SamCategory): SamPrefixGroup[] {
  if (!prefixesRoot) return [];

  let catBlock: unknown;
  if (Array.isArray(prefixesRoot)) {
    catBlock = prefixesRoot;
  } else if (typeof prefixesRoot === 'object') {
    const pr = prefixesRoot as Record<string, unknown>;
    const keyed = pr[category];
    if (Array.isArray(keyed)) {
      catBlock = keyed;
    } else {
      const values = Object.values(pr).filter(
        (v) => v && typeof v === 'object' && !Array.isArray(v) && 'prefixes' in (v as object),
      );
      catBlock = values.length > 0 ? values : null;
    }
  }

  return parsePrefixGroupList(catBlock);
}

function parsePrefixGroupList(catBlock: unknown): SamPrefixGroup[] {
  if (!Array.isArray(catBlock)) return [];

  const groups: SamPrefixGroup[] = [];
  for (const g of catBlock) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) continue;
    const gr = g as Record<string, unknown>;
    const groupId = numberOrNull(gr.id ?? gr.group_id ?? gr.groupId) ?? 0;
    const groupName =
      stringOrNull(gr.name ?? gr.title ?? gr.label ?? gr.group) ?? 'Other';
    const rawPrefixes = normalizePrefixEntries(gr.prefixes);
    if (rawPrefixes.length > 0) {
      groups.push({ id: groupId, name: groupName, prefixes: rawPrefixes });
    }
  }
  return groups;
}

function normalizePrefixEntries(raw: unknown): SamPrefixEntry[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.values(raw as Record<string, unknown>)
      : [];

  const prefixes: SamPrefixEntry[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const pr = p as Record<string, unknown>;
    const id = numberOrNull(pr.id ?? pr.prefix_id ?? pr.prefixId);
    const name = stringOrNull(pr.name ?? pr.title ?? pr.label ?? pr.text);
    if (id === null || !name) continue;
    prefixes.push({
      id,
      name,
      cssClass: stringOrNull(pr.class ?? pr.cssClass),
    });
  }
  return prefixes;
}

function normalizeSamPage(
  body: string,
  filters: SamFilters,
  endpoint: string,
): SamPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      `SAM endpoint did not return JSON; head: ${body.slice(0, 200)}`,
    );
  }

  // Known wrappers across F95Zone variants:
  //   { status: 'ok', msg: [ ...cards ] }
  //   { status: 'ok', msg: { data: [...], count, pages, page } }
  //   { data: [...], total, page, pages }
  //   [ ...cards ]  (plain array — older mirrors)
  const root = (parsed as Record<string, unknown>) ?? {};
  const status = root.status as string | undefined;
  if (status && status !== 'ok') {
    const msg = typeof root.msg === 'string' ? (root.msg as string) : status;
    throw new RpcError(RPC_ERROR.INTERNAL, `SAM error: ${msg}`);
  }

  const msgVal = root.msg ?? parsed;
  let rawList: unknown[] = [];
  let totalRows: number | null = null;
  let totalPages: number | null = null;
  let pageNum: number | null = null;

  if (Array.isArray(msgVal)) {
    rawList = msgVal;
  } else if (msgVal && typeof msgVal === 'object') {
    const m = msgVal as Record<string, unknown>;
    if (Array.isArray(m.data)) rawList = m.data;
    else if (Array.isArray(m.items)) rawList = m.items;
    else if (Array.isArray(m.results)) rawList = m.results;
    totalRows = pickNumber(m.count ?? m.total ?? root.total ?? root.count);
    totalPages = pickNumber(m.pages ?? m.total_pages ?? (m.pagination as any)?.total_pages);
    pageNum = pickNumber(m.page ?? m.current_page ?? (m.pagination as any)?.current_page);
  }

  const items = rawList
    .map((it) => toCard(it))
    .filter((c): c is SamGameCard => c !== null);

  const page = pageNum ?? filters.page ?? 1;
  const total = totalRows ?? items.length;
  const pages = totalPages ?? Math.max(1, Math.ceil(total / (filters.rows ?? 15)));

  return { page, totalPages: pages, totalRows: total, items, endpoint };
}

function toCard(raw: unknown): SamGameCard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = r.thread_id ?? r.threadId ?? r.id;
  if (id === undefined || id === null) return null;

  const screensRaw = Array.isArray(r.screens) ? (r.screens as unknown[]) : [];
  const screens = screensRaw
    .map((s) => absoluteUrl(stringOrNull(s)))
    .filter((s): s is string => s !== null);

  return {
    threadId: String(id),
    title: String(r.title ?? r.name ?? '').trim() || `Thread ${id}`,
    version: stringOrNull(r.version),
    thumbnailUrl: absoluteUrl(stringOrNull(r.cover ?? r.thumb ?? r.thumbnail ?? r.image)),
    screens,
    threadUrl: `${BASE}/threads/${id}/`,
    prefixIds: arrayOfIds(r.prefixes ?? r.prefix_ids ?? r.prefixIds),
    tagIds: arrayOfIds(r.tags ?? r.tag_ids ?? r.tagIds),
    rating: numberOrNull(r.rating),
    views: numberOrNull(r.views),
    likes: numberOrNull(r.likes ?? r.reactions),
    updatedAt: stringOrNull(r.date ?? r.updated ?? r.last_update ?? r.updated_at),
    updatedTs: numberOrNull(r.ts ?? r.timestamp ?? r.updated_ts),
    creator: stringOrNull(r.creator ?? r.author ?? r.username),
    watched: Boolean(r.watched),
    ignored: Boolean(r.ignored),
    isNew: Boolean(r.new),
  };
}

function arrayOfIds(value: unknown): number[] {
  if (value === null || value === undefined) return [];

  if (typeof value === 'string') {
    const out: number[] = [];
    for (const part of value.split(/[,;\s]+/)) {
      const n = numberOrNull(part);
      if (n !== null) out.push(n);
    }
    return out;
  }

  if (!Array.isArray(value)) {
    const single = idFromValue(value);
    return single === null ? [] : [single];
  }

  const out: number[] = [];
  for (const v of value) {
    const n = idFromValue(v);
    if (n !== null) out.push(n);
  }
  return out;
}

function idFromValue(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !Array.isArray(v)) {
    const r = v as Record<string, unknown>;
    return numberOrNull(r.id ?? r.prefix_id ?? r.prefixId ?? r.tag_id ?? r.tagId);
  }
  return numberOrNull(v);
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function pickNumber(v: unknown): number | null {
  return numberOrNull(v);
}

function absoluteUrl(src: string | null): string | null {
  if (!src) return null;
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${BASE}${src}`;
  return `${BASE}/${src}`;
}
