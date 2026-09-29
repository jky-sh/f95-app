import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import { RPC_ERROR, RpcError } from '../../rpc';
import { log } from '../../logger';
import { F95_BASE } from '../../shared/constants';
import { absoluteUrl, cleanText, memberIdFromHref } from '../f95/html';
import {
  parseMemberCard,
  parseMemberHeader,
  parseMemberSummary,
  usernameFromHref,
  type MemberCardDto,
} from '../f95/member';
import {
  ensureCsrf,
  fetchMemberPage,
  forgetCsrf,
  memberUrl,
  rememberCsrf,
} from '../f95/pages';

const BASE = F95_BASE;

/** Safety cap on `/account/following` pagination. */
const MAX_FOLLOWING_PAGES = 20;

/**
 * Member cards per call and parallel tooltip requests. The sidecar runs
 * one RPC at a time, so callers batch to keep other requests flowing.
 */
const MAX_CARDS_PER_CALL = 24;
const CARD_CONCURRENCY = 4;

/** XF rejects JSON requests with a stale CSRF token with HTTP 400. */
class StaleCsrfError extends Error {}

export interface FollowedUser {
  userId: string;
  username: string;
  avatarUrl: string | null;
  profileUrl: string;
  customTitle: string | null;
  location: string | null;
  isStaff: boolean;
  isModerator: boolean;
  messagesCount: number | null;
  reactionScore: number | null;
  points: number | null;
}

export class SocialClient {
  constructor(private readonly http: BrowserClient) {}

  /**
   * Scrape `/account/following` (every page) for the members this account
   * follows. Returns `[]` when the user follows nobody. If F95 changes the
   * layout, run __manual__/probe-following.ts again to update the selectors.
   */
  async getFollowing(): Promise<FollowedUser[]> {
    const users = new Map<string, FollowedUser>();
    for (let page = 1; page <= MAX_FOLLOWING_PAGES; page++) {
      const url = `${BASE}/account/following${page > 1 ? `?page=${page}` : ''}`;
      log(`[social] GET ${url}`);
      const res = await this.http.get(url);
      if (res.status >= 400) {
        throw new RpcError(RPC_ERROR.INTERNAL, `following fetch HTTP ${res.status}`);
      }
      const parsed = parseFollowingPage(res.body);
      for (const u of parsed.users) {
        if (!users.has(u.userId)) users.set(u.userId, u);
      }
      rememberCsrf(res.body);
      if (page >= parsed.lastPage) break;
    }
    return Array.from(users.values());
  }

  /**
   * Compact cards (last seen, banners, stats) from member tooltips, for the
   * friends list. Members whose tooltip fails are left out.
   */
  async getMemberCards(userIds: string[]): Promise<MemberCardDto[]> {
    const ids = [...new Set(userIds)].slice(0, MAX_CARDS_PER_CALL);
    let token = await ensureCsrf(this.http);
    try {
      return await this.fetchCards(ids, token);
    } catch (err) {
      if (!(err instanceof StaleCsrfError)) throw err;
      forgetCsrf();
      token = await ensureCsrf(this.http);
      return this.fetchCards(ids, token);
    }
  }

  /**
   * Follow or unfollow a member and return the resulting state. Reads the
   * current state first so a double click never toggles twice.
   */
  async setMemberFollow(userId: string, follow: boolean): Promise<{ following: boolean }> {
    const current = parseMemberHeader(await fetchMemberPage(this.http, userId)).followState;
    if (current === null) {
      throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'this member cannot be followed');
    }
    if ((current === 'following') === follow) return { following: follow };

    const token = await ensureCsrf(this.http);
    const res = await this.http.post(memberUrl(userId, 'follow'), {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ _xfToken: token, _xfResponseType: 'json' }).toString(),
    });
    const reply = parseJson(res.body) as { status?: string; errors?: unknown } | null;
    if (res.status >= 400 || reply?.status === 'error') {
      const errors = Array.isArray(reply?.errors) ? reply.errors.join(' ') : '';
      throw new RpcError(RPC_ERROR.INTERNAL, errors || `follow HTTP ${res.status}`);
    }

    // Confirm from a fresh tooltip; trust the request if that read fails.
    const [card] = await this.fetchCards([userId], token).catch(() => []);
    return { following: card?.followState ? card.followState === 'following' : follow };
  }

  private async fetchCards(ids: string[], token: string): Promise<MemberCardDto[]> {
    const cards = await mapWithLimit(ids, CARD_CONCURRENCY, (id) =>
      this.fetchCard(id, token).catch((err: unknown) => {
        // A stale token or a Cloudflare wall affects every card: surface it.
        if (err instanceof StaleCsrfError) throw err;
        if (err instanceof RpcError && err.code === RPC_ERROR.CLOUDFLARE_CHALLENGE) throw err;
        log(`[social] tooltip ${id} failed:`, (err as Error).message);
        return null;
      }),
    );
    return cards.filter((c): c is MemberCardDto => c !== null);
  }

  private async fetchCard(userId: string, token: string): Promise<MemberCardDto | null> {
    const res = await this.http.get(memberUrl(userId, 'tooltip'), {
      query: { _xfResponseType: 'json', _xfWithData: 1, _xfToken: token },
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    if (res.status === 400) throw new StaleCsrfError('csrf token rejected');
    if (res.status !== 200) {
      log(`[social] tooltip ${userId} HTTP ${res.status}`);
      return null;
    }
    const content = (parseJson(res.body) as { html?: { content?: string } } | null)?.html?.content;
    return content ? parseMemberCard(content, userId) : null;
  }
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** One page of `/account/following`: XF's member list rows plus its pager. */
export function parseFollowingPage(html: string): { users: FollowedUser[]; lastPage: number } {
  const $ = cheerio.load(html);
  const $content = $('.p-body-pageContent').first();
  const $scope: cheerio.Cheerio<any> = $content.length ? $content : $.root();

  // Each followed member renders as `li.block-row > .contentRow`; fall back
  // to bare block rows if a theme drops the contentRow wrapper.
  let rows = $scope.find('.contentRow').toArray().filter((el) => $(el).parents('.contentRow').length === 0);
  if (rows.length === 0) rows = $scope.find('.block-row').toArray();

  const users: FollowedUser[] = [];
  for (const el of rows) {
    const $row = $(el);
    const $name = $row.find('a.username').first();
    const href =
      $name.attr('href') ??
      $row
        .find('a[href*="/members/"]')
        .filter((_i, a) => !!memberIdFromHref($(a).attr('href') ?? ''))
        .first()
        .attr('href') ??
      '';
    const userId = $name.attr('data-user-id') ?? memberIdFromHref(href);
    if (!userId || users.some((u) => u.userId === userId)) continue;

    const summary = parseMemberSummary($, $row);
    users.push({
      userId,
      username: cleanText($name.text()) || usernameFromHref(href) || `User ${userId}`,
      avatarUrl: summary.avatarUrl,
      profileUrl: href ? absoluteUrl(href) : `${BASE}/members/${userId}/`,
      customTitle: summary.customTitle,
      location: summary.location,
      isStaff: summary.isStaff,
      isModerator: summary.isModerator,
      messagesCount: summary.messagesCount,
      reactionScore: summary.reactionScore,
      points: summary.points,
    });
  }

  let lastPage = 1;
  $('.pageNav-page').each((_, el) => {
    const n = parseInt(cleanText($(el).text()), 10);
    if (Number.isFinite(n) && n > lastPage) lastPage = n;
  });
  return { users, lastPage };
}
