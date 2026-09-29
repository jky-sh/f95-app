import type { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import { RPC_ERROR, RpcError } from '../../rpc';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE } from '../../shared/constants';
import { cleanText } from './html';

/**
 * XenForo's CSRF token (`<html data-csrf>`), cached from every member page
 * we load. JSON endpoints (member tooltips) and POSTs (follow) need it.
 */
let csrfToken: string | null = null;

export function rememberCsrf(html: string): void {
  const m = html.match(/<html[^>]*\sdata-csrf="([^"]+)"/i);
  if (m) csrfToken = m[1];
}

export function forgetCsrf(): void {
  csrfToken = null;
}

/** Cached token, or one read from the account page when none is cached. */
export async function ensureCsrf(http: BrowserClient): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await http.get(`${F95_BASE}/account/`);
  assertNotCloudflareChallenge(res.body, res.headers);
  rememberCsrf(res.body);
  if (!csrfToken) throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  return csrfToken;
}

export function memberUrl(userId: string, tab = ''): string {
  return `${F95_BASE}/members/${encodeURIComponent(userId)}/${tab}`;
}

/**
 * GET a member page or tab and return its HTML. F95 answers logged-out
 * visitors and private profiles with 403 on the same URL, so tell those
 * apart instead of surfacing a bare status code.
 */
export async function fetchMemberPage(
  http: BrowserClient,
  userId: string,
  tab = '',
): Promise<string> {
  const res = await http.get(memberUrl(userId, tab));
  assertNotCloudflareChallenge(res.body, res.headers);
  const $ = cheerio.load(res.body);
  const loggedIn = $('.p-navgroup-link--user').length > 0;
  if (res.url.includes('/login') || !loggedIn) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status !== 200) {
    const reason = cleanText($('.p-body-pageContent .blockMessage').first().text());
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      reason || `member ${tab || 'page'} HTTP ${res.status}`,
    );
  }
  rememberCsrf(res.body);
  return res.body;
}
