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
import { findAvatarSrc } from './html';
import {
  parseActivityRows,
  parseMemberHeader,
  parseMemberUsername,
  type ActivityItem,
  type MemberHeaderInfo,
} from './member';

export type { F95Alert, F95AlertsListResult, F95AlertsPopupResult };
export type { ActivityItem };

const BASE = F95_BASE;
const LOGIN_PAGE = `${BASE}/login/`;
const LOGIN_POST = `${BASE}/login/login`;
const ACCOUNT_PAGE = `${BASE}/account/`;
const LOGOUT_POST = `${BASE}/logout/`;
const UA = USER_AGENT;

export interface ProfileDto extends MemberHeaderInfo {
  username: string;
  alerts: number;
  conversations: number;
  userId: string | null;
  profileUrl: string | null;
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
    // Member page unavailable: every header field empty, navbar data kept.
    return { ...parseMemberHeader(''), ...base, activity: [] };
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

  /**
   * "Latest activity" feed (replies, reactions, new threads…). Best-effort:
   * the profile still renders without it.
   */
  private async fetchActivity(profileUrl: string): Promise<ActivityItem[]> {
    const url = profileUrl.replace(/\/?$/, '/') + 'latest-activity';
    try {
      const res = await this.client.get(url);
      assertNotCloudflareChallenge(res.body, res.headers);
      if (res.status !== 200) return [];
      return parseActivityRows(res.body);
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

export interface MemberProfileDto extends MemberHeaderInfo {
  userId: string;
  username: string;
  profileUrl: string;
  activity: ActivityItem[];
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

function readBadge(
  $: cheerio.CheerioAPI,
  selector: string,
): number {
  const txt = $(selector).find('.p-navgroup-linkText').text().trim();
  if (!txt) return 0;
  const n = parseInt(txt.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function extractUserIdFromAvatarClass(cls: string): string | null {
  const m = cls.match(/avatar-u(\d+)-/);
  return m ? m[1] : null;
}
