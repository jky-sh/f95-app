import type { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import { RPC_ERROR, RpcError } from '../../rpc';
import { F95_BASE } from '../../shared/constants';
import { isF95DownloadPage } from '../game/hosts';
import { absoluteUrl, cleanText } from './html';

export interface UnmaskResponse {
  status?: string;
  msg?: string;
}

export interface UnmaskResult {
  url: string;
  status: number;
  /**
   * F95 wants a person to pass its hCaptcha first: `url` is then the
   * download page (signed fresh) for the host to show them in the app.
   */
  check?: boolean;
}

/** /masked/<host>/<threadId>/<post>/... → the thread page, useful as Referer. */
export function inferRefererFromMasked(url: string): string | null {
  const m = url.match(/^https?:\/\/f95zone\.to\/masked\/[^/]+\/(\d+)\//);
  if (!m) return null;
  return `${F95_BASE}/threads/${m[1]}/`;
}

/** Parse F95 unmask JSON response body. Exported for unit tests. */
export function parseUnmaskResponse(body: string): UnmaskResponse | null {
  try {
    return JSON.parse(body) as UnmaskResponse;
  } catch {
    return null;
  }
}

/**
 * The real host URL behind one of F95's download links: the old
 * `/masked/` redirector or the `/dl/` download page that replaced it.
 */
export async function unmaskUrl(http: BrowserClient, url: string): Promise<UnmaskResult> {
  if (isF95DownloadPage(url)) return openDownloadPage(http, url);
  return unmaskMaskedUrl(http, url);
}

/**
 * F95's /masked/ URLs serve an interstitial whose masked.js POSTs xhr=1&download=1
 * to reveal the real download URL.
 */
async function unmaskMaskedUrl(http: BrowserClient, url: string): Promise<UnmaskResult> {
  const referer = inferRefererFromMasked(url) ?? `${F95_BASE}/`;
  const res = await http.post(url, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/javascript, */*; q=0.01',
      referer,
      origin: F95_BASE,
    },
    body: new URLSearchParams({ xhr: '1', download: '1' }).toString(),
  });

  const body = typeof res.body === 'string' ? res.body : '';
  const parsed = parseUnmaskResponse(body);

  if (parsed && typeof parsed.status === 'string') {
    if (parsed.status === 'ok' && typeof parsed.msg === 'string') {
      return { url: parsed.msg, status: res.status };
    }
    if (parsed.status === 'captcha') {
      throw captchaError();
    }
    if (parsed.status === 'error') {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `F95 returned an error: ${parsed.msg ?? 'unknown'}`,
      );
    }
  }

  if (/login\b|sign-?in|please\s+log/i.test(body.slice(0, 4000))) {
    throw sessionExpiredError();
  }
  const head = body.slice(0, 240).replace(/\s+/g, ' ').trim();
  throw new RpcError(
    RPC_ERROR.INTERNAL,
    `unmask POST returned non-JSON (status ${res.status}). Body head: ${head}`,
  );
}

// -- /dl/ download pages ------------------------------------------------------
//
// GET /dl/<post>/?u&k&r&t shows "Continue to <host>". Its page.js puts a
// code from `data-code` into the form a little over a second after the page
// opened, and the form POSTs back to the same URL. The answer is a short
// page whose `f95dl-go` element carries the host URL. `u` is the member,
// `k` the link (the same on every visit), `r` and `t` the time and the
// signature that make a link expire after a few hours.

/** page.js hands the code back after 2.1 s: F95 wants more than one full second. */
const DOWNLOAD_CODE_DELAY_MS = 2_100;

export type DownloadPage =
  | { kind: 'form'; action: string; fields: Record<string, string> }
  | { kind: 'expired'; message: string }
  | { kind: 'captcha' }
  | { kind: 'login' }
  | { kind: 'unknown'; message: string };

/** `data-code` is "c", then the code reversed, in base64 (page.js `decode`). */
export function decodeDownloadCode(hidden: string): string {
  const raw = Buffer.from(String(hidden).replace(/^c/, ''), 'base64').toString('latin1');
  return raw.split('').reverse().join('');
}

/** What a `/dl/` page (or the answer to its form) asks for. */
export function parseDownloadPage(html: string, pageUrl: string): DownloadPage {
  const $ = cheerio.load(html);
  if ($('html').attr('data-logged-in') === 'false') return { kind: 'login' };

  // The page can ask for an hCaptcha first ("Please confirm you're not a
  // bot"): a person has to pass it, and a form posted without it only
  // answers "The check wasn't passed".
  if (hasCaptcha($)) return { kind: 'captcha' };

  const $page = $('[data-xf-init~="f95dl-page"]').first();
  const $form = $page.find('form').has('.js-f95dlContinue').first();
  if ($page.length && $form.length) {
    const fields: Record<string, string> = {};
    $form.find('input[name]').each((_, el) => {
      const $input = $(el);
      fields[$input.attr('name')!] = $input.attr('value') ?? '';
    });
    const code = $page.attr('data-code');
    const codeName = $form.find('input.js-f95dlCode').attr('name');
    if (code && codeName) fields[codeName] = decodeDownloadCode(code);
    const action = new URL($form.attr('action') || pageUrl, pageUrl).toString();
    return { kind: 'form', action, fields };
  }

  const $message = $('.p-body-pageContent .blockMessage').first();
  const message = cleanText(($message.length ? $message : $('.blockMessage').first()).text());
  if (/expired/i.test(message)) return { kind: 'expired', message };
  return { kind: 'unknown', message };
}

/** The host URL on the page that answers the download form, else null. */
export function parseDownloadRedirect(html: string): string | null {
  const $ = cheerio.load(html);
  const candidates = [
    $('[data-xf-init~="f95dl-go"]').first().attr('data-url'),
    $('.f95dl-going-link a[href]').first().attr('href'),
  ];
  return candidates.find((c): c is string => !!c && /^https?:\/\//i.test(c)) ?? null;
}

/**
 * The same link, freshly signed, in the post's HTML (`/posts/<id>/`
 * lands on the thread page holding that post): matched by its `k`.
 */
export function findDownloadLink(html: string, postId: string, key: string): string | null {
  const $ = cheerio.load(html);
  const $post = $(`article[data-content="post-${postId}"], #js-post-${postId}`).first();
  const links = `a[href*="/dl/${postId}/"]`;
  let found: string | null = null;
  ($post.length ? $post.find(links) : $(links)).each((_, el) => {
    const href = absoluteUrl($(el).attr('href') ?? '');
    try {
      if (new URL(href).searchParams.get('k') === key) {
        found = href;
        return false;
      }
    } catch {
      // not a URL
    }
    return undefined;
  });
  return found;
}

function downloadLinkParts(url: string): { postId: string; key: string } | null {
  try {
    const u = new URL(url);
    const postId = u.pathname.match(/^\/dl\/(\d+)\/?$/)?.[1];
    const key = u.searchParams.get('k');
    return postId && key ? { postId, key } : null;
  } catch {
    return null;
  }
}

async function openDownloadPage(http: BrowserClient, url: string): Promise<UnmaskResult> {
  let pageUrl = url;
  let page = await getDownloadPage(http, pageUrl);
  if (page.page.kind === 'expired') {
    // Links expire a few hours after the thread was opened: a download
    // queued from an older page gets its link again from the post.
    pageUrl = await refreshDownloadLink(http, url);
    page = await getDownloadPage(http, pageUrl);
  }

  // Only a person can pass F95's hCaptcha: the host shows them the page.
  if (page.page.kind === 'captcha') return { url: pageUrl, status: page.status, check: true };
  const form = requireForm(page.page);
  const wait = page.openedAt + DOWNLOAD_CODE_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

  const res = await http.post(form.action, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: pageUrl,
      origin: F95_BASE,
    },
    body: new URLSearchParams(form.fields).toString(),
  });
  const body = typeof res.body === 'string' ? res.body : '';
  const target = parseDownloadRedirect(body);
  if (target) return { url: target, status: res.status };

  const after = parseDownloadPage(body, pageUrl);
  if (after.kind === 'captcha') return { url: pageUrl, status: res.status, check: true };
  throw after.kind === 'form'
    ? new RpcError(RPC_ERROR.INTERNAL, 'F95 showed the download page again instead of the host link')
    : downloadPageError(after);
}

async function getDownloadPage(
  http: BrowserClient,
  url: string,
): Promise<{ page: DownloadPage; openedAt: number; status: number }> {
  const parts = downloadLinkParts(url);
  const res = await http.get(url, {
    headers: { referer: parts ? `${F95_BASE}/posts/${parts.postId}/` : `${F95_BASE}/` },
  });
  const openedAt = Date.now();
  const body = typeof res.body === 'string' ? res.body : '';
  return { page: parseDownloadPage(body, res.url || url), openedAt, status: res.status };
}

async function refreshDownloadLink(http: BrowserClient, url: string): Promise<string> {
  const parts = downloadLinkParts(url);
  if (!parts) throw expiredError();
  const res = await http.get(`${F95_BASE}/posts/${parts.postId}/`);
  const body = typeof res.body === 'string' ? res.body : '';
  const fresh = findDownloadLink(body, parts.postId, parts.key);
  if (!fresh) throw expiredError();
  return fresh;
}

type DownloadForm = Extract<DownloadPage, { kind: 'form' }>;

function requireForm(page: DownloadPage): DownloadForm {
  if (page.kind === 'form') return page;
  throw downloadPageError(page);
}

function downloadPageError(page: Exclude<DownloadPage, DownloadForm>): RpcError {
  switch (page.kind) {
    case 'captcha':
      return captchaError();
    case 'login':
      return sessionExpiredError();
    case 'expired':
      return expiredError();
    default:
      return new RpcError(
        RPC_ERROR.INTERNAL,
        `F95 download page: ${page.message || 'no download form found'}`,
      );
  }
}

function hasCaptcha($: cheerio.CheerioAPI): boolean {
  return (
    $('[data-sitekey], .g-recaptcha, .h-captcha, .cf-turnstile, .f95dl-check-box').length > 0 ||
    $('[data-xf-init*="captcha"], [data-xf-init~="turnstile"]').length > 0
  );
}

/** A /masked/ link behind F95's reCAPTCHA: the host opens it in the browser. */
function captchaError(): RpcError {
  return new RpcError(
    RPC_ERROR.CLOUDFLARE_CHALLENGE,
    'F95 asks for a captcha before this download; open it in your browser',
    { variant: 'recaptcha' },
  );
}

function sessionExpiredError(): RpcError {
  return new RpcError(
    RPC_ERROR.NOT_INITIALIZED,
    'masked URL hit the login page; session expired — please re-login',
  );
}

function expiredError(): RpcError {
  return new RpcError(
    RPC_ERROR.INTERNAL,
    'F95 download link expired and the post no longer lists it; open the game page again',
  );
}
