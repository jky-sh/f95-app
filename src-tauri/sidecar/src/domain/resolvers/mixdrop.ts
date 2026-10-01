import type { BrowserContext, Page } from 'playwright';
import * as cheerio from 'cheerio';
import { RPC_ERROR, RpcError } from '../../rpc';
import { cleanDownloadFileName } from '../../shared/filename';
import { USER_AGENT } from '../../shared/constants';
import { getPlaywrightBrowser, launchInteractiveBrowser } from '../../infra/playwright/browser';
import { MIXDROP_HOST_RE } from '../game/hosts';

const API_BASE = 'https://api.mixdrop.ag';
const PAGE_BASE = 'https://mixdrop.ag';
const UA = USER_AGENT;
/** Invisible reCAPTCHA v2 site key (MixDrop / JDownloader). */
const RECAPTCHA_SITE_KEY = '6LetXaoUAAAAAB6axgg4WLG9oZ_6QLTsFXZj-5sd';

const HOST_RE = MIXDROP_HOST_RE;
const FAKE_HOST = /miixdrop|mii[x]+drop/i;

/** Prefer mirrors that do not 302 to the ad hijack host miixdrop.net. */
const PAGE_MIRROR_CANDIDATES = [
  'https://mixdrop.is',
  // Where most mirrors redirect to now.
  'https://mxdrop.top',
  'https://mixdrop.ch',
  'https://www.mixdrop.ch',
  'https://mixdrop.ag',
  'https://mixdrop.sx',
  'https://mixdrop.bz',
  'https://mixdrop.ps',
  'https://mixdrop.si',
];

export interface ParsedMixdropUrl {
  fileref: string;
  pageUrl: string;
}

export interface MixdropResolveResult {
  directUrl: string;
  fileName: string;
  fileSize: number | null;
  extraHeaders: Array<{ name: string; value: string }>;
}

interface FileInfoEntry {
  title?: string;
  size?: string | number;
  status?: string;
  deleted?: boolean;
}

/** Parse /f/{ref} or /e/{ref} on any MixDrop mirror domain. */
export function parseMixdropUrl(raw: string): ParsedMixdropUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `invalid MixDrop URL: ${raw}`);
  }
  if (!HOST_RE.test(u.hostname)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `not a MixDrop URL: ${raw}`);
  }
  const segs = u.pathname.split('/').filter(Boolean);
  const idx = segs.findIndex((s) => s === 'f' || s === 'e');
  const fileref = idx >= 0 ? segs[idx + 1] : segs[segs.length - 1];
  if (!fileref || !/^[a-z0-9]{4,32}$/i.test(fileref)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'MixDrop URL missing file ref');
  }
  return {
    fileref,
    pageUrl: `${PAGE_BASE}/f/${fileref}`,
  };
}

async function pickPageBase(fileref: string): Promise<string> {
  for (const base of PAGE_MIRROR_CANDIDATES) {
    try {
      const url = `${base}/f/${fileref}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        redirect: 'manual',
      });
      const loc = res.headers.get('location') ?? '';
      if (FAKE_HOST.test(loc)) continue;
      if (res.status >= 300 && res.status < 400 && loc) continue;
      if (res.status === 200 || res.status === 204) return base;
    } catch {
      /* try next mirror */
    }
  }
  return PAGE_BASE;
}

/** Resolve fileref + a mirror that is not hijacked by miixdrop.net. */
export async function resolveMixdropParsed(raw: string): Promise<ParsedMixdropUrl> {
  const base = parseMixdropUrl(raw);
  const pageBase = await pickPageBase(base.fileref);
  return { fileref: base.fileref, pageUrl: `${pageBase}/f/${base.fileref}` };
}

function pageOrigin(pageUrl: string): string {
  try {
    return new URL(pageUrl).origin;
  } catch {
    return PAGE_BASE;
  }
}

/** https://mixdrop.ag/api — fileinfo2 for title/size (optional account credentials). */
export async function fetchMixdropFileInfo(
  fileref: string,
  email: string,
  apiKey: string,
): Promise<{ fileName: string | null; fileSize: number | null; status: string | null }> {
  const q = new URLSearchParams();
  q.set('email', email);
  q.set('key', apiKey);
  q.append('ref[]', fileref);
  const res = await fetch(`${API_BASE}/fileinfo2?${q.toString()}`, {
    headers: { accept: 'application/json' },
  });
  const text = await res.text();
  let data: { success?: boolean; result?: Record<string, FileInfoEntry> };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    return { fileName: null, fileSize: null, status: null };
  }
  if (!data.success || !data.result) {
    return { fileName: null, fileSize: null, status: null };
  }
  const entry = data.result[fileref] ?? Object.values(data.result)[0];
  if (!entry || entry.deleted) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'MixDrop: arquivo não encontrado ou removido');
  }
  const status = entry.status?.trim() ?? null;
  if (status && /notfound|deleted/i.test(status)) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'MixDrop: arquivo não encontrado ou removido');
  }
  let fileSize: number | null = null;
  const rawSize = entry.size;
  if (typeof rawSize === 'number' && Number.isFinite(rawSize)) {
    fileSize = rawSize;
  } else if (typeof rawSize === 'string') {
    const n = parseInt(rawSize, 10);
    if (Number.isFinite(n)) fileSize = n;
  }
  const title = entry.title?.trim();
  return {
    fileName: title ? cleanDownloadFileName(title) : null,
    fileSize,
    status,
  };
}

function extractFileNameFromHtml(html: string, fileref: string): string | null {
  const $ = cheerio.load(html);
  const iconRow = $('img[src*="icon-file"]').first().parent();
  const text = iconRow.text().replace(/\s+/g, ' ').trim();
  if (text) {
    const withoutSize = text.replace(/\s*\([\d.,]+\s*(B|KB|MB|GB|TB)\)\s*$/i, '').trim();
    if (withoutSize && withoutSize.length > 0 && !/^mixdrop/i.test(withoutSize)) {
      return cleanDownloadFileName(withoutSize);
    }
  }
  const h1 = $('h1').first().text().trim();
  if (h1 && h1.length > 0) return cleanDownloadFileName(h1);
  const title = $('title').text().split('|')[0]?.trim();
  if (title && title.length > 0 && !/^mixdrop/i.test(title)) {
    return cleanDownloadFileName(title);
  }
  return `${fileref}.bin`;
}

function pageIsNotFound(status: number | null, html: string): boolean {
  if (status === 404) return true;
  const lower = html.slice(0, 12_000).toLowerCase();
  return lower.includes('illustration-notfound') || lower.includes('file not found');
}

function captchaError(): RpcError {
  return new RpcError(
    RPC_ERROR.CLOUDFLARE_CHALLENGE,
    'MixDrop exige verificação reCAPTCHA — abra o link no navegador para baixar',
  );
}

function readCsrfFromHtml(html: string): string {
  const $ = cheerio.load(html);
  return $('meta[name="csrf"]').attr('content')?.trim() ?? '';
}

async function readCsrf(page: Page): Promise<string> {
  const fromMeta = await page.locator('meta[name="csrf"]').getAttribute('content');
  return fromMeta?.trim() ?? readCsrfFromHtml(await page.content());
}

function sessionHeaders(cookieHeader: string): Record<string, string> {
  return {
    Cookie: cookieHeader,
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
}

async function fetchMixdropPage(
  pageUrl: string,
  cookieHeader: string,
): Promise<{ html: string; status: number }> {
  const res = await fetch(pageUrl, {
    headers: sessionHeaders(cookieHeader),
    redirect: 'follow',
  });
  return { html: await res.text(), status: res.status };
}

async function obtainRecaptchaToken(page: Page): Promise<string | null> {
  const existing = await page
    .locator('textarea[name="g-recaptcha-response"]')
    .inputValue()
    .catch(() => '');
  if (existing && existing.length > 20) return existing;

  return page
    .evaluate(
      `(() => new Promise((resolve) => {
        const siteKey = ${JSON.stringify(RECAPTCHA_SITE_KEY)};
        const ta = document.querySelector('textarea[name="g-recaptcha-response"]');
        if (ta && ta.value && ta.value.length > 20) { resolve(ta.value); return; }
        const g = window.grecaptcha;
        if (!g) { resolve(null); return; }
        g.ready(() => {
          g.execute(siteKey, { action: 'download' })
            .then((t) => resolve(t || null))
            .catch(() => resolve(null));
        });
        setTimeout(() => resolve(null), 28000);
      }))()`,
    )
    .catch(() => null) as Promise<string | null>;
}

async function postGenticket(
  pageUrl: string,
  csrf: string,
  cookieHeader: string,
  recaptchaToken?: string | null,
): Promise<string | null> {
  const body = new URLSearchParams({ a: 'genticket', csrf });
  if (recaptchaToken) body.set('token', recaptchaToken);
  const res = await fetch(pageUrl, {
    method: 'POST',
    headers: {
      ...sessionHeaders(cookieHeader),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/plain, */*',
    },
    body: body.toString(),
  });
  const text = await res.text();
  let result: { url?: string; msg?: string };
  try {
    result = JSON.parse(text) as typeof result;
  } catch {
    return null;
  }
  const url = result.url?.trim();
  if (url && url.startsWith('http')) return url;
  const msg = result.msg ?? text;
  if (/captcha|recaptcha/i.test(msg)) return null;
  if (/not found/i.test(msg)) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'MixDrop: arquivo não encontrado');
  }
  return null;
}

async function tryGenticket(
  page: Page,
  csrf: string,
  parsed: ParsedMixdropUrl,
): Promise<string | null> {
  const pageUrl = genticketPostUrl(page.url(), parsed);
  const cookies = await page.context().cookies([pageUrl, parsed.pageUrl]);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const recaptchaToken = await obtainRecaptchaToken(page);
  if (cookieHeader) {
    return postGenticket(pageUrl, csrf, cookieHeader, recaptchaToken);
  }
  const result = await page
    .evaluate(
      async ({ csrfToken, postUrl, token }) => {
        const body = new URLSearchParams({ a: 'genticket', csrf: csrfToken });
        if (token) body.set('token', token);
        const res = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            accept: 'application/json, text/plain, */*',
          },
          body: body.toString(),
          credentials: 'include',
        });
        const text = await res.text();
        try {
          return JSON.parse(text) as { url?: string; msg?: string };
        } catch {
          return { msg: text.slice(0, 200) };
        }
      },
      { csrfToken: csrf, postUrl: pageUrl, token: recaptchaToken ?? '' },
    )
    .catch(() => ({ msg: 'fetch failed' } as { url?: string; msg?: string }));
  const url = result.url?.trim();
  if (url && url.startsWith('http')) return url;
  const msg = result.msg ?? '';
  if (/captcha|recaptcha/i.test(msg)) return null;
  if (/not found/i.test(msg)) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'MixDrop: arquivo não encontrado');
  }
  return null;
}

async function tryDownloadClick(page: Page): Promise<string | null> {
  const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });
  const selectors = [
    'a.download-btn',
    'a:has-text("Download")',
    'button:has-text("Download")',
    '.download-button',
    'a[href*="?download"]',
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      await loc.click({ timeout: 8_000 }).catch(() => undefined);
      break;
    }
  }
  try {
    const download = await downloadPromise;
    const directUrl = download.url();
    await download.cancel().catch(() => undefined);
    if (directUrl && directUrl.startsWith('http')) return directUrl;
  } catch {
    /* no download event */
  }
  return null;
}

function cookiesFromHeader(cookieHeader: string, pageUrl: string): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  url: string;
}> {
  let host = 'mixdrop.is';
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    /* keep default */
  }
  const out: Array<{ name: string; value: string; domain: string; path: string; url: string }> = [];
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    out.push({
      name,
      value,
      domain: host.startsWith('.') ? host : `.${host}`,
      path: '/',
      url: pageUrl,
    });
  }
  return out;
}

/**
 * Resolve after the user completed verification in the in-app captcha webview.
 * Reuses exported cookies in a headed Playwright session (genticket needs reCAPTCHA token).
 */
export async function resolveMixdropWithCookies(
  url: string,
  cookieHeader: string,
  apiEmail?: string | null,
  apiKey?: string | null,
): Promise<MixdropResolveResult> {
  const trimmed = cookieHeader.trim();
  if (!trimmed) {
    throw captchaError();
  }
  const parsed = await resolveMixdropParsed(url);
  let fileName: string | null = null;
  let fileSize: number | null = null;

  if (apiEmail?.trim() && apiKey?.trim()) {
    const info = await fetchMixdropFileInfo(parsed.fileref, apiEmail.trim(), apiKey.trim());
    fileName = info.fileName;
    fileSize = info.fileSize;
  }

  const browser = await launchInteractiveBrowser();
  const context = await browser.newContext({
    userAgent: UA,
    acceptDownloads: true,
    viewport: { width: 520, height: 640 },
    locale: 'en-US',
  });
  try {
    const jar = cookiesFromHeader(trimmed, parsed.pageUrl);
    if (jar.length > 0) {
      await context.addCookies(jar);
    }
    attachMixdropContext(context, parsed.fileref);
    const page = await context.newPage();
    attachMixdropPage(page);
    await page.addInitScript(FINGERPRINT_BYPASS_INIT);
    await page.addInitScript(LOCATION_GUARD_INIT);
    await page.addInitScript(AD_SUPPRESS_INIT);

    await page.goto(parsed.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await ensureCanonicalMixdropPage(page, parsed);
    await waitForMixdropReady(page);

    if (!fileName) {
      fileName = extractFileNameFromHtml(await page.content(), parsed.fileref);
    }

    await dismissFakeCaptchas(page);
    await clickRealDownload(page);

    const csrfRef = { value: await readCsrf(page) };
    const directUrl = await waitForDirectUrl(page, csrfRef, parsed, 90_000);
    if (!directUrl) {
      throw captchaError();
    }

    const mergedCookies = await context.cookies();
    const cookieOut =
      mergedCookies.length > 0
        ? mergedCookies.map((c) => `${c.name}=${c.value}`).join('; ')
        : trimmed;

    return {
      directUrl,
      fileName: fileName ?? `${parsed.fileref}.bin`,
      fileSize,
      extraHeaders: [
        { name: 'Cookie', value: cookieOut },
        { name: 'Referer', value: page.url() || parsed.pageUrl },
        { name: 'User-Agent', value: UA },
      ],
    };
  } catch (err) {
    if (err instanceof RpcError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/captcha|recaptcha|timeout/i.test(msg)) throw captchaError();
    throw new RpcError(RPC_ERROR.INTERNAL, `MixDrop: ${msg}`);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

/**
 * MixDrop serves /f/{ref} pages that POST `a=genticket` (often with invisible
 * reCAPTCHA) to obtain a CDN URL. Playwright reuses the session cookies.
 */
export async function resolveMixdrop(
  url: string,
  apiEmail?: string | null,
  apiKey?: string | null,
): Promise<MixdropResolveResult> {
  const parsed = await resolveMixdropParsed(url);
  let fileName: string | null = null;
  let fileSize: number | null = null;

  if (apiEmail?.trim() && apiKey?.trim()) {
    const info = await fetchMixdropFileInfo(parsed.fileref, apiEmail.trim(), apiKey.trim());
    fileName = info.fileName;
    fileSize = info.fileSize;
  }

  return resolveMixdropPlaywright(parsed, fileName, fileSize, {
    headed: true,
    timeoutMs: INTERACTIVE_TIMEOUT_MS,
    minimalUi: true,
  });
}

async function resolveMixdropPlaywright(
  parsed: ParsedMixdropUrl,
  fileName: string | null,
  fileSize: number | null,
  opts: { headed: boolean; timeoutMs: number; minimalUi: boolean },
): Promise<MixdropResolveResult> {
  const browser = opts.headed
    ? await launchInteractiveBrowser()
    : await getPlaywrightBrowser();
  const context = await browser.newContext({
      userAgent: UA,
      acceptDownloads: true,
      viewport: opts.minimalUi ? { width: 520, height: 640 } : { width: 1366, height: 768 },
    locale: 'en-US',
  });
  try {
    attachMixdropContext(context, parsed.fileref);
    const page = await context.newPage();
    attachMixdropPage(page);

    await page.addInitScript(FINGERPRINT_BYPASS_INIT);
    await page.addInitScript(LOCATION_GUARD_INIT);
    await page.addInitScript(AD_SUPPRESS_INIT);
    const html = await loadMixdropDownloadPage(page, parsed);

    if (!fileName) {
      fileName = extractFileNameFromHtml(html, parsed.fileref);
    }

    if (opts.minimalUi) {
      await page.addStyleTag({ content: MINIMAL_UI_CSS }).catch(() => undefined);
    }
    await page.waitForTimeout(600);
    await dismissFakeCaptchas(page);
    await clickRealDownload(page);

    const csrfRef = { value: await readCsrf(page) };
    const directUrl = await waitForDirectUrl(page, csrfRef, parsed, opts.timeoutMs);
    if (!directUrl) {
      throw captchaError();
    }

    const headers: Array<{ name: string; value: string }> = [
      { name: 'Referer', value: page.url() },
      { name: 'User-Agent', value: UA },
    ];
    const cookies = await context.cookies();
    const relevant = cookies.filter((c) => /mixdrop/i.test(c.domain));
    if (relevant.length > 0) {
      headers.unshift({
        name: 'Cookie',
        value: relevant.map((c) => `${c.name}=${c.value}`).join('; '),
      });
    }

    return {
      directUrl,
      fileName: fileName ?? `${parsed.fileref}.bin`,
      fileSize,
      extraHeaders: headers,
    };
  } catch (err) {
    if (err instanceof RpcError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/captcha|recaptcha|timeout/i.test(msg)) throw captchaError();
    throw new RpcError(RPC_ERROR.INTERNAL, `MixDrop: ${msg}`);
  } finally {
    await context.close().catch(() => undefined);
    if (opts.headed) {
      await browser.close().catch(() => undefined);
    }
  }
}

const BLOCKED_REQUEST =
  /miixdrop|mii[x]+drop|doubleclick|googlesyndication|popads|propeller|adnxs|taboola|outbrain|exoclick|clickadu/i;
const FAKE_DIALOG_TEXT = /miixdrop|mii[x]+drop|robô|robot|não é um robô|not a robot/i;

function isFakeMixdropHost(url: string): boolean {
  try {
    return FAKE_HOST.test(new URL(url).hostname);
  } catch {
    return FAKE_HOST.test(url);
  }
}

function rewriteFakeMixdropUrl(url: string, fileref: string): string {
  if (!isFakeMixdropHost(url)) return url;
  try {
    const u = new URL(url);
    const path = u.pathname.includes('/f/') ? u.pathname : `/f/${fileref}`;
    return `${PAGE_BASE}${path.startsWith('/') ? path : `/${path}`}${u.search}`;
  } catch {
    return `${PAGE_BASE}/f/${fileref}`;
  }
}

/** genticket must POST to mixdrop.ag — never the ad hijack host in page.url(). */
function genticketPostUrl(pageUrl: string, parsed: ParsedMixdropUrl): string {
  if (isFakeMixdropHost(pageUrl)) return parsed.pageUrl;
  try {
    const u = new URL(pageUrl);
    if (HOST_RE.test(u.hostname)) return pageUrl;
  } catch {
    /* fall through */
  }
  return parsed.pageUrl;
}
const HEADLESS_WAIT_MS = 90_000;
const INTERACTIVE_TIMEOUT_MS = 5 * 60 * 1000;
const INTERACTIVE_POLL_MS = 1500;

/** Some mirrors gate with FingerprintJS; headless gets fp=-7 and never reaches the download page. */
const FINGERPRINT_BYPASS_INIT = `
(() => {
  const fakeId = Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const stub = {
    load: () => Promise.resolve({
      get: () => Promise.resolve({ visitorId: fakeId, confidence: { score: 0.99 } }),
    }),
  };
  Object.defineProperty(window, 'FingerprintJS', { configurable: true, get: () => stub, set: () => {} });
})();
`;

const LOCATION_GUARD_INIT = `
(() => {
  const BAD = /miixdrop|mii[x]+drop/i;
  function fix(url) {
    try {
      const u = new URL(String(url), location.href);
      if (!BAD.test(u.hostname)) return null;
      const path = u.pathname || location.pathname;
      return 'https://mixdrop.ag' + (path.startsWith('/') ? path : '/' + path) + u.search;
    } catch { return null; }
  }
  const loc = window.location;
  for (const fn of ['assign', 'replace']) {
    const orig = loc[fn].bind(loc);
    loc[fn] = (url) => { const f = fix(url); return orig(f || url); };
  }
  const desc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
  if (desc && desc.set) {
    const set = desc.set;
    Object.defineProperty(loc, 'href', {
      ...desc,
      set(v) { const f = fix(v); return set.call(this, f || v); },
    });
  }
})();
`;

function attachMixdropContext(context: BrowserContext, fileref: string): void {
  context.route('**/*', (route) => {
    const reqUrl = route.request().url();
    if (FAKE_HOST.test(reqUrl)) {
      if (route.request().resourceType() === 'document') {
        return route.continue({ url: rewriteFakeMixdropUrl(reqUrl, fileref) });
      }
      return route.abort();
    }
    if (BLOCKED_REQUEST.test(reqUrl)) return route.abort();
    return route.continue();
  });
}

async function ensureCanonicalMixdropPage(page: Page, parsed: ParsedMixdropUrl): Promise<void> {
  const current = page.url();
  if (isFakeMixdropHost(current)) {
    await page.goto(parsed.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
}

function attachMixdropPage(page: Page): void {
  page.on('dialog', (d) => {
    const msg = d.message();
    if (FAKE_DIALOG_TEXT.test(msg)) void d.accept();
    else void d.dismiss();
  });
}

const DISMISS_FAKE_CAPTCHA_SCRIPT = `
(() => {
  const FAKE = /miixdrop|mii[x]+drop|confirme que você|confirm that you are not a robot|não é um robô|you are not a robot/i;
  for (const el of document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')) {
    if (!(el instanceof HTMLElement)) continue;
    const label = (el.textContent || '').trim();
    if (!/^(OK|SIM|YES)$/i.test(label)) continue;
    let p = el.parentElement;
    for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
      const text = (p.innerText || p.textContent || '').slice(0, 600);
      if (FAKE.test(text)) { el.click(); return; }
    }
  }
})();
`;

/** Clicks OK on fake ad overlays (miixdrop.net) before scrub removes them. */
async function dismissFakeCaptchas(page: Page): Promise<void> {
  await page.evaluate(DISMISS_FAKE_CAPTCHA_SCRIPT).catch(() => undefined);
}

const AD_SUPPRESS_INIT = `
(() => {
  const FAKE = /miixdrop|mii[x]+drop|confirme que você|confirm that you are not a robot|não é um robô|you are not a robot/i;
  const REAL = /google\\.com\\/recaptcha|gstatic\\.com\\/recaptcha|recaptcha/i;
  function isBlockedUrl(url) {
    return /miixdrop|mii[x]+drop/i.test(url);
  }
  const origOpen = window.open;
  window.open = (...args) => {
    const target = String(args[0] ?? '');
    if (isBlockedUrl(target)) return null;
    return origOpen.apply(window, args);
  };
  function clickFakeOk() {
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      if (!(el instanceof HTMLElement)) continue;
      const label = (el.textContent || '').trim();
      if (!/^OK$/i.test(label)) continue;
      let p = el.parentElement;
      for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
        const text = (p.innerText || p.textContent || '').slice(0, 600);
        if (FAKE.test(text)) { el.click(); return; }
      }
    }
  }
  function scrub() {
    clickFakeOk();
    for (const el of document.querySelectorAll('div, section, aside, iframe, dialog')) {
      if (!(el instanceof HTMLElement)) continue;
      const text = (el.innerText || el.textContent || '').slice(0, 500);
      const src = el.getAttribute('src') || '';
      if (REAL.test(text) || REAL.test(src)) continue;
      if (FAKE.test(text) || isBlockedUrl(src)) el.remove();
    }
  }
  scrub();
  setInterval(scrub, 400);
  new MutationObserver(scrub).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

const MINIMAL_UI_CSS = `
  header, nav, footer, .menu, .navbar, .share, .social, .footer,
  [class*="banner"], [class*="advert"], [id*="advert"], [class*="ads"],
  iframe:not([src*="recaptcha"]) {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
  body { background: #141414 !important; margin: 0 !important; }
  .download-btn, a.download-btn, a[href*="download"], [class*="download"], h1, h2 {
    visibility: visible !important;
    display: revert !important;
  }
`;

async function clickRealDownload(page: Page): Promise<void> {
  for (const sel of [
    'a.download-btn',
    'a.btn-download',
    'a[href*="?download"]',
    'button:has-text("DOWNLOAD")',
    'a:has-text("DOWNLOAD")',
  ]) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      await loc.click({ timeout: 6_000 }).catch(() => undefined);
      return;
    }
  }
}

async function waitForDirectUrl(
  page: Page,
  csrfRef: { value: string },
  parsed: ParsedMixdropUrl,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await ensureCanonicalMixdropPage(page, parsed);
    await dismissFakeCaptchas(page);
    csrfRef.value = (await readCsrf(page)) || csrfRef.value;
    const ticket = await tryGenticket(page, csrfRef.value, parsed);
    if (ticket) return ticket;
    const clicked = await tryDownloadClick(page);
    if (clicked) return clicked;
    await page.waitForTimeout(INTERACTIVE_POLL_MS);
  }
  return null;
}

async function waitForMixdropReady(page: Page): Promise<void> {
  await page
    .waitForURL(/fp=(?!-7)|[?&]download/i, { timeout: 60_000 })
    .catch(() => undefined);
  await page.locator('meta[name="csrf"]').waitFor({ timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}

async function loadMixdropDownloadPage(page: Page, parsed: ParsedMixdropUrl): Promise<string> {
  await page.goto(parsed.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await ensureCanonicalMixdropPage(page, parsed);
  await waitForMixdropReady(page);
  let html = await page.content();
  if (pageIsNotFound(null, html)) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'MixDrop: arquivo não encontrado');
  }
  const origin = pageOrigin(parsed.pageUrl);
  const continueMatch = html.match(/\/f\/[a-z0-9]+\?download/i);
  if (continueMatch) {
    const continueUrl = continueMatch[0].startsWith('http')
      ? continueMatch[0]
      : `${origin}${continueMatch[0].startsWith('/') ? '' : '/'}${continueMatch[0]}`;
    await page.goto(continueUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
    await ensureCanonicalMixdropPage(page, parsed);
    await waitForMixdropReady(page);
    html = await page.content();
  }
  return html;
}

/**
 * Small headed Chromium window: blocks fake ad captchas, strips page chrome,
 * waits for the real Google reCAPTCHA / genticket flow.
 */
export async function resolveMixdropInteractive(
  url: string,
  apiEmail?: string | null,
  apiKey?: string | null,
): Promise<MixdropResolveResult> {
  return resolveMixdrop(url, apiEmail, apiKey);
}
