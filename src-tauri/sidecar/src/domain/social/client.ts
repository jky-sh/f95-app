import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import { RPC_ERROR, RpcError } from '../../rpc';
import { log } from '../../logger';
import { F95_BASE } from '../../shared/constants';
import { absoluteUrl, cleanText, memberIdFromHref } from '../f95/html';
import { parseMemberSummary, usernameFromHref } from '../f95/member';

const BASE = F95_BASE;

/** Safety cap on `/account/following` pagination. */
const MAX_FOLLOWING_PAGES = 20;

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
      if (page >= parsed.lastPage) break;
    }
    return Array.from(users.values());
  }
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
