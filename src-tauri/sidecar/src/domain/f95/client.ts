import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RPC_ERROR, RpcError } from '../../rpc';
import { log } from '../../logger';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE, USER_AGENT } from '../../shared/constants';
import {
  fetchAlertsList,
  fetchAlertsPopup,
  type F95Alert,
  type F95AlertsListResult,
  type F95AlertsPopupResult,
} from './alerts';

export type { F95Alert, F95AlertsListResult, F95AlertsPopupResult };

const BASE = F95_BASE;
const LOGIN_PAGE = `${BASE}/login/`;
const LOGIN_POST = `${BASE}/login/login`;
const ACCOUNT_PAGE = `${BASE}/account/`;
const LOGOUT_POST = `${BASE}/logout/`;
const UA = USER_AGENT;

export interface ActivityItem {
  avatarUrl: string | null;
  title: string;
  snippet: string | null;
  date: string | null;
  url: string | null;
}

export interface ProfileDto {
  username: string;
  avatarUrl: string | null;
  alerts: number;
  conversations: number;
  userId: string | null;
  profileUrl: string | null;
  userBanner: string | null;
  customTitle: string | null;
  joinedAt: string | null;
  lastSeen: string | null;
  messagesCount: number | null;
  reactionScore: number | null;
  trophyPoints: number | null;
  points: number | null;
  ratingsReceived: number | null;
  extraStats: Record<string, string>;
  activity: ActivityItem[];
}

export interface LoginResult {
  ok: true;
  redirected: boolean;
}

export interface InitOptions {
  sessionDir: string;
  sessionId?: string;
  userAgent?: string;
}

export class F95Client {
  private client: BrowserClient;
  private readonly _sessionId: string;
  private readonly _sessionDir: string;
  private readonly _userAgent: string;

  constructor(opts: InitOptions) {
    this._sessionId = opts.sessionId ?? 'default';
    this._sessionDir = opts.sessionDir;
    this._userAgent = opts.userAgent ?? UA;
    this.client = this.createHttpClient();
  }

  private createHttpClient(): BrowserClient {
    return new BrowserClient({
      session: this._sessionId,
      sessionDir: this._sessionDir,
      parseHtml: false,
      userAgent: this._userAgent,
      // 10s — the old 30s default made a single stalled connection
      // (slow Cloudflare, flaky network) effectively freeze the app
      // for half a minute. 10s is long enough that legitimate slow
      // requests succeed and short enough that users notice errors
      // quickly and can retry instead of staring at a spinner.
      timeout: 10000,
    });
  }

  get sessionId(): string {
    return this._sessionId;
  }

  /**
   * Exposes the underlying HTTP client so other modules (SamClient, GameClient)
   * can share the same authenticated session. Treat as read-only.
   */
  get http(): BrowserClient {
    return this.client;
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const pageRes = await this.client.get(LOGIN_PAGE);
    assertNotCloudflareChallenge(pageRes.body, pageRes.headers);
    if (pageRes.status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `failed to load login page: HTTP ${pageRes.status}`,
      );
    }
    const tokens = extractXfTokens(pageRes.body);
    if (!tokens.xfToken) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'could not extract _xfToken from login page',
      );
    }

    const res = await this.client.request(LOGIN_POST, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        referer: LOGIN_PAGE,
        origin: BASE,
      },
      body: new URLSearchParams({
        login: username,
        password,
        remember: '1',
        _xfToken: tokens.xfToken,
        _xfRedirect: tokens.xfRedirect ?? `${BASE}/`,
      }).toString(),
    });
    assertNotCloudflareChallenge(res.body, res.headers);

    if (res.status === 200 && hasLoginError(res.body)) {
      throw new RpcError(
        RPC_ERROR.INVALID_CREDENTIALS,
        extractLoginErrorMessage(res.body) ?? 'invalid credentials',
      );
    }
    if (res.url.includes('/login/two-step')) {
      throw new RpcError(
        RPC_ERROR.TWO_FACTOR_REQUIRED,
        'two-factor authentication required',
      );
    }
    if (![200, 301, 302, 303].includes(res.status)) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `unexpected login response: HTTP ${res.status}`,
      );
    }

    const probe = await this.client.get(ACCOUNT_PAGE);
    assertNotCloudflareChallenge(probe.body, probe.headers);
    if (probe.url.includes('/login/two-step')) {
      throw new RpcError(
        RPC_ERROR.TWO_FACTOR_REQUIRED,
        'two-factor authentication required',
      );
    }
    if (!isAccountPageLoggedIn(probe.body)) {
      throw new RpcError(
        RPC_ERROR.INVALID_CREDENTIALS,
        'login appeared to succeed but account page does not show a user',
      );
    }

    return { ok: true, redirected: res.status >= 300 && res.status < 400 };
  }

  async getProfile(): Promise<ProfileDto> {
    const accountRes = await this.client.get(ACCOUNT_PAGE);
    assertNotCloudflareChallenge(accountRes.body, accountRes.headers);
    if (accountRes.url.includes('/login')) {
      throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
    }
    const base = parseNavbar(accountRes.body);

    if (base.profileUrl) {
      try {
        const memberRes = await this.client.get(base.profileUrl);
        assertNotCloudflareChallenge(memberRes.body, memberRes.headers);
        if (memberRes.status === 200) {
          const header = parseMemberHeader(memberRes.body);
          // Override the navbar avatar with the larger member-page avatar when present.
          const avatarUrl = header.avatarUrl ?? base.avatarUrl;
          const activity = await this.fetchActivity(base.profileUrl);
          return { ...base, ...header, avatarUrl, activity };
        }
      } catch (err) {
        if (err instanceof RpcError && err.code === RPC_ERROR.CLOUDFLARE_CHALLENGE) {
          throw err;
        }
        log('member page fetch failed:', (err as Error).message);
      }
    }
    return {
      ...base,
      userBanner: null,
      customTitle: null,
      joinedAt: null,
      lastSeen: null,
      messagesCount: null,
      reactionScore: null,
      trophyPoints: null,
      points: null,
      ratingsReceived: null,
      extraStats: {},
      activity: [],
    };
  }

  /**
   * Public profile of an arbitrary member. Same member-header + recent
   * activity parsing as `getProfile`, but the username comes from the
   * member page itself (the navbar only knows the logged-in user).
   */
  async getMemberProfile(userId: string): Promise<MemberProfileDto> {
    const profileUrl = `${BASE}/members/${encodeURIComponent(userId)}/`;
    const res = await this.client.get(profileUrl);
    assertNotCloudflareChallenge(res.body, res.headers);
    if (res.url.includes('/login')) {
      throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
    }
    if (res.status !== 200) {
      throw new RpcError(RPC_ERROR.INTERNAL, `member page HTTP ${res.status}`);
    }
    const username = parseMemberUsername(res.body);
    if (!username) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'could not parse member profile (username not found)',
      );
    }
    const header = parseMemberHeader(res.body);
    const activity = await this.fetchActivity(profileUrl);
    return { userId, username, profileUrl, ...header, activity };
  }

  private async fetchActivity(profileUrl: string): Promise<ActivityItem[]> {
    const url = profileUrl.replace(/\/?$/, '/') + 'recent-content';
    try {
      const res = await this.client.get(url);
      assertNotCloudflareChallenge(res.body, res.headers);
      if (res.status !== 200) return [];
      return parseActivity(res.body);
    } catch (err) {
      if (err instanceof RpcError && err.code === RPC_ERROR.CLOUDFLARE_CHALLENGE) {
        throw err;
      }
      log('recent-activity fetch failed:', (err as Error).message);
      return [];
    }
  }

  async fetchAlertsPopup(): Promise<F95AlertsPopupResult> {
    return fetchAlertsPopup(this.client);
  }

  async fetchAlertsList(page = 1): Promise<F95AlertsListResult> {
    return fetchAlertsList(this.client, page);
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      const res = await this.client.get(ACCOUNT_PAGE);
      assertNotCloudflareChallenge(res.body, res.headers);
      if (res.url.includes('/login')) return false;
      return isAccountPageLoggedIn(res.body);
    } catch (err) {
      if (err instanceof RpcError && err.code === RPC_ERROR.CLOUDFLARE_CHALLENGE) {
        throw err;
      }
      log('isLoggedIn failed:', (err as Error).message);
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      const pageRes = await this.client.get(ACCOUNT_PAGE);
      const tokens = extractXfTokens(pageRes.body);
      if (tokens.xfToken) {
        await this.client.request(LOGOUT_POST, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            referer: ACCOUNT_PAGE,
            origin: BASE,
          },
          body: new URLSearchParams({ _xfToken: tokens.xfToken }).toString(),
        });
      }
    } catch (err) {
      log('logout network call failed (ignored):', (err as Error).message);
    }
    await this.resetLocalSession();
  }

  /** Drop persisted cookies/session so `isLoggedIn()` is false immediately. */
  private async resetLocalSession(): Promise<void> {
    await this.client.close();
    const filePath = path.join(this._sessionDir, `${this._sessionId}.json`);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        (err as { code?: string }).code !== 'ENOENT'
      ) {
        log('failed to delete session file:', (err as Error).message);
      }
    }
    this.client = this.createHttpClient();
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

interface NavbarInfo {
  username: string;
  avatarUrl: string | null;
  alerts: number;
  conversations: number;
  userId: string | null;
  profileUrl: string | null;
}

function parseNavbar(html: string): NavbarInfo {
  const $ = cheerio.load(html);
  const userLink = $('.p-navgroup-link--user').first();

  const usernameRaw = userLink.find('.p-navgroup-linkText').text().trim();
  const username = usernameRaw || userLink.attr('aria-label')?.trim() || '';

  const avatarUrl = findAvatarSrc($, userLink.find('img').first());

  const alerts = readBadge($, '.p-navgroup-link--alerts');
  const conversations = readBadge($, '.p-navgroup-link--conversations');

  // The navbar user link goes to /account/ (settings), NOT to the public
  // profile. Resolve the real userId from <html data-user-id> or from the
  // avatar img class "avatar-u<id>-<size>" and build the members URL ourselves.
  const avatarImgClass = userLink.find('img').attr('class') ?? '';
  const userId =
    $('html').attr('data-user-id') ??
    userLink.attr('data-user-id') ??
    extractUserIdFromAvatarClass(avatarImgClass);

  const profileUrl = userId ? `${BASE}/members/${userId}/` : null;

  if (!username) {
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      'could not parse profile (username not found)',
    );
  }

  return {
    username,
    avatarUrl,
    alerts,
    conversations,
    userId: userId ?? null,
    profileUrl,
  };
}

interface MemberHeaderInfo {
  avatarUrl: string | null;
  userBanner: string | null;
  customTitle: string | null;
  joinedAt: string | null;
  lastSeen: string | null;
  messagesCount: number | null;
  reactionScore: number | null;
  trophyPoints: number | null;
  points: number | null;
  ratingsReceived: number | null;
  extraStats: Record<string, string>;
}

/** Public profile of any member — `getProfile` minus the navbar badges. */
export interface MemberProfileDto extends MemberHeaderInfo {
  userId: string;
  username: string;
  profileUrl: string;
  activity: ActivityItem[];
}

function parseMemberUsername(html: string): string | null {
  const $ = cheerio.load(html);
  const name =
    cleanText($('.memberHeader-name .username').first().text()) ||
    cleanText($('.memberHeader-name').first().text());
  return name || null;
}

function parseMemberHeader(html: string): MemberHeaderInfo {
  const $ = cheerio.load(html);

  // The big avatar lives at .memberHeader-avatar > .avatarWrapper > a.avatar--l.
  // The <a>'s href is the original-size image; the inner <img> is the large
  // (l) size. Prefer the <a>'s href, fall back to the <img>.
  const avatarA = $('.memberHeader-avatar a.avatar, .memberHeader a.avatar--l').first();
  const aHref = avatarA.attr('href');
  let avatarUrl: string | null = null;
  if (aHref && isLikelyImageUrl(aHref)) {
    avatarUrl = absoluteUrl(aHref);
  } else {
    avatarUrl = findAvatarSrc($, $('.memberHeader-avatar img').first());
  }

  // f95zone uses .userTitle (not .userBanner) for the rank badge ("New Member").
  // Both fields end up holding the same string for users with no custom title,
  // which the UI handles by not double-rendering.
  const titleText =
    cleanText($('.memberHeader-blurb .userTitle').first().text()) ||
    cleanText($('.memberHeader .userTitle').first().text()) ||
    null;
  const userBanner = titleText;
  const customTitle = titleText;

  const stats = collectPairs($, '.memberHeader-stats dl.pairs');

  const messagesCount = pickStat(stats, ['messages', 'mensagens']);
  const reactionScore = pickStat(stats, ['reaction score', 'pontos de reação']);
  const points = pickStat(stats, ['points', 'pontos']);
  const trophyPoints = pickStat(stats, ['trophy points', 'troféus', 'trofeus']);
  const ratingsReceived = pickStat(stats, [
    'ratings received',
    'ratings',
    'avaliações recebidas',
  ]);

  const inlinePairs = collectPairs($, 'dl.pairs--inline');
  const joinedAtRaw = inlinePairs['Joined'] ?? inlinePairs['Inscrito em'] ?? null;
  const lastSeenRaw =
    inlinePairs['Last seen'] ??
    inlinePairs['Visto pela última vez'] ??
    inlinePairs['Última visita'] ??
    null;

  // Trim "· Viewing member profile X" noise from the last-seen text.
  const joinedAt = stripMemberProfileNoise(joinedAtRaw);
  const lastSeen = stripMemberProfileNoise(lastSeenRaw);

  const known = new Set([
    'messages', 'mensagens',
    'reaction score', 'pontos de reação',
    'points', 'pontos',
    'trophy points', 'troféus', 'trofeus',
    'ratings received', 'ratings', 'avaliações recebidas',
    'joined', 'inscrito em',
    'last seen', 'visto pela última vez', 'última visita',
  ]);
  const extraStats: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...stats, ...inlinePairs })) {
    if (!known.has(k.toLowerCase())) extraStats[k] = v;
  }

  return {
    avatarUrl,
    userBanner,
    customTitle,
    joinedAt,
    lastSeen,
    messagesCount,
    reactionScore,
    trophyPoints,
    points,
    ratingsReceived,
    extraStats,
  };
}

function collectPairs(
  $: cheerio.CheerioAPI,
  selector: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  $(selector).each((_, el) => {
    const $el = $(el);
    const label = cleanText($el.find('dt').first().text());
    const value = cleanText($el.find('dd').first().text());
    if (label && value) out[label] = value;
  });
  return out;
}

function stripMemberProfileNoise(s: string | null): string | null {
  if (!s) return s;
  // "A moment ago · Viewing member profile X" → "A moment ago"
  // "Jul 27, 2018 at 2:58 PM" passes through unchanged.
  const idx = s.indexOf(' · ');
  if (idx >= 0) return s.slice(0, idx).trim();
  return s.trim();
}

function isLikelyImageUrl(url: string): boolean {
  return /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url);
}

function pickStat(
  pairs: Record<string, string>,
  labels: string[],
): number | null {
  for (const want of labels) {
    for (const [k, v] of Object.entries(pairs)) {
      if (k.toLowerCase() === want.toLowerCase()) {
        const n = parseInt(v.replace(/[^\d-]/g, ''), 10);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

function parseActivity(html: string): ActivityItem[] {
  const $ = cheerio.load(html);
  const items: ActivityItem[] = [];

  // f95zone's recent-content page lists entries as bare .contentRow divs.
  // We pick those and skip anything nested inside another row to avoid dupes.
  const rows = $('.contentRow').toArray();
  for (const el of rows) {
    if ($(el).parents('.contentRow').length > 0) continue;
    const $el = $(el);

    const avatarImg = $el.find('.contentRow-figure img').first();
    const avatarUrl = findAvatarSrc($, avatarImg);

    const titleEl = $el.find('.contentRow-title').first();
    const title = cleanText(titleEl.text());
    if (!title) continue;

    const snippet =
      cleanText($el.find('.contentRow-snippet').first().text()) ||
      cleanText($el.find('blockquote').first().text()) ||
      null;

    const dateEl = $el.find('.contentRow-minor time').first();
    const date =
      cleanText(dateEl.attr('data-date-string') ?? '') ||
      cleanText(dateEl.attr('title') ?? '') ||
      cleanText(dateEl.text()) ||
      cleanText($el.find('.contentRow-minor').first().text()) ||
      null;

    const linkEl = titleEl.find('a').last();
    const href = linkEl.attr('href') ?? null;
    const url = href ? absoluteUrl(href) : null;

    items.push({ avatarUrl, title, snippet, date, url });
  }
  return items;
}

function extractXfTokens(html: string): {
  xfToken: string | null;
  xfRedirect: string | null;
} {
  const $ = cheerio.load(html);
  const xfToken =
    $('input[name="_xfToken"]').first().attr('value') ??
    $('html').attr('data-csrf') ??
    null;
  const xfRedirect = $('input[name="_xfRedirect"]').first().attr('value') ?? null;
  return { xfToken, xfRedirect };
}

function hasLoginError(html: string): boolean {
  const $ = cheerio.load(html);
  return (
    $('.blockMessage--error').length > 0 ||
    $('.formRow--input .blockMessage--error').length > 0 ||
    /Incorrect password\.|The requested user/.test(html)
  );
}

function extractLoginErrorMessage(html: string): string | null {
  const $ = cheerio.load(html);
  const text = $('.blockMessage--error').first().text().trim();
  return text.length > 0 ? text : null;
}

function isAccountPageLoggedIn(html: string): boolean {
  const $ = cheerio.load(html);
  return $('.p-navgroup-link--user').length > 0;
}

function findAvatarSrc(
  $: cheerio.CheerioAPI,
  img: cheerio.Cheerio<any>,
): string | null {
  if (img.length === 0) return null;
  // XF lazy-loads avatars; the real URL lives in data-src while src may be a
  // 1x1 placeholder. Prefer data-src when present.
  const candidates = [
    img.attr('data-src'),
    img.attr('src'),
    img.attr('data-original'),
  ];
  for (const c of candidates) {
    if (c && !isPlaceholder(c)) return absoluteUrl(c);
  }
  // fall back to the first candidate even if it looks like a placeholder
  for (const c of candidates) {
    if (c) return absoluteUrl(c);
  }
  return null;
}

function isPlaceholder(src: string): boolean {
  return (
    src.startsWith('data:image/gif') ||
    src.includes('blank.gif') ||
    src.endsWith('/blank.png')
  );
}

function cleanText(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

function readBadge(
  $: cheerio.CheerioAPI,
  selector: string,
): number {
  const txt = $(selector).find('.p-navgroup-linkText').text().trim();
  if (!txt) return 0;
  const n = parseInt(txt.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function extractUserIdFromHref(href: string): string | null {
  const m = href.match(/members\/[^/]*?(\d+)\/?$/);
  return m ? m[1] : null;
}

function extractUserIdFromAvatarClass(cls: string): string | null {
  const m = cls.match(/avatar-u(\d+)-/);
  return m ? m[1] : null;
}

function absoluteUrl(src: string): string {
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${BASE}${src}`;
  return `${BASE}/${src}`;
}
