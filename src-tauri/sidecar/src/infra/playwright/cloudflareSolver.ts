import type { BrowserClient } from 'browser-rest-api';
import type { Browser, BrowserContext, Cookie, Page } from 'playwright';
import { log } from '../../logger';
import { RPC_ERROR, RpcError } from '../../rpc';
import { loadPlaywright } from './runtime';

/**
 * Passes Cloudflare's "Just a moment…" check for browser-rest-api.
 *
 * F95 can answer the app's HTTP requests with a managed challenge (403,
 * `cf-mitigated: challenge`). The library's own solver waits for
 * `networkidle` in a headless browser that still carries the automation
 * flags, which never clears, so sign-in hung for 60 s and failed. This one
 * opens the full Chromium headless without those flags, waits until the
 * check is gone and copies the cookies (cf_clearance among them) into the
 * client's jar, so the library's retry goes through. The clearance only
 * holds for the same User-Agent, which is why USER_AGENT follows the
 * bundled Chromium.
 *
 * When Cloudflare wants a person (a click), the check fails with the
 * `interactive` variant: the host shows it inside the app (WebView2) and
 * hands the result back through `importClearance`.
 */

const HEADLESS_WAIT_MS = 15_000;
const POLL_MS = 500;

const PAGE_CLEARED = `document.readyState !== 'loading'
  && document.title.trim() !== ''
  && !/just a moment/i.test(document.title)
  && !('_cf_chl_opt' in window)`;

/** The part of tough-cookie's CookieJar that browser-rest-api hands over. */
interface Jar {
  getCookies(url: string): Promise<JarCookie[]>;
  setCookie(cookie: string, url: string): Promise<unknown>;
}

interface JarCookie {
  key: string;
  value: string;
  domain?: string | null;
  path?: string | null;
  expires?: Date | 'Infinity' | null;
  secure?: boolean;
  httpOnly?: boolean;
}

/** What browser-rest-api's Orchestrator calls on its `browserEngine`. */
interface ChallengeEngine {
  solveChallenge(
    url: string,
    challenge: { type: string },
    jar: Jar,
    onChallenge: unknown,
    userAgent: string | undefined,
  ): Promise<void>;
  close(): Promise<void>;
}

/** The library internals this module reaches into; it has no API for them. */
interface ClientInternals {
  ready: Promise<void>;
  jar?: Jar;
  orchestrator?: { browserEngine: ChallengeEngine | null };
}

/** A cookie the host read from its own browser (WebView2). */
export interface ClearanceCookie {
  name: string;
  value: string;
  domain: string;
  path?: string | null;
  /** Unix seconds; none for a session cookie. */
  expires?: number | null;
  secure?: boolean;
  httpOnly?: boolean;
}

class CloudflareSolver implements ChallengeEngine {
  private pending: Promise<void> | null = null;

  constructor(private readonly client: BrowserClient) {}

  async solveChallenge(
    url: string,
    challenge: { type: string },
    jar: Jar,
    _onChallenge: unknown,
    userAgent: string | undefined,
  ): Promise<void> {
    // reCAPTCHA needs a token nobody here has; the retry returns the page as is.
    if (challenge.type !== 'cloudflare') return;
    // Requests running side by side share one check.
    this.pending ??= this.solve(url, jar, userAgent).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async close(): Promise<void> {}

  private async solve(url: string, jar: Jar, userAgent: string | undefined): Promise<void> {
    const started = Date.now();
    // QA: go straight to the in-app check.
    if (!process.env.F95_CLOUDFLARE_SKIP_HEADLESS && (await passHeadless(url, jar, userAgent))) {
      // The new clearance belongs to this User-Agent, not to one a
      // WebView2 check left in the session.
      this.client.removeHeader('user-agent');
      log(`cloudflare: check passed headless in ${Date.now() - started} ms`);
      return;
    }
    log('cloudflare: check needs a person');
    throw new RpcError(
      RPC_ERROR.CLOUDFLARE_CHALLENGE,
      'Cloudflare wants a person to finish its check',
      { variant: 'interactive', url },
    );
  }
}

/** True once the page behind the check loaded in a headless Chromium. */
async function passHeadless(url: string, jar: Jar, userAgent: string | undefined): Promise<boolean> {
  let browser: Browser | null = null;
  try {
    browser = await loadPlaywright().chromium.launch({
      headless: true,
      // Cloudflare fails browsers that say they're automated.
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    });
    // No `locale`: a language that disagrees with the system's makes
    // Cloudflare keep the check up.
    const context = await browser.newContext({ userAgent });
    await context.addCookies(await cookiesFromJar(jar, url));
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    if (!(await waitForCheckToClear(page, HEADLESS_WAIT_MS))) return false;
    await copyCookiesToJar(context, jar);
    return true;
  } catch (err) {
    log('cloudflare: headless attempt failed:', (err as Error).message);
    return false;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/**
 * True once the page behind the check loaded: it has a title, and it's
 * neither Cloudflare's "Just a moment..." interstitial nor any page running
 * its challenge script (`_cf_chl_opt`). While the challenge reloads, the
 * title is empty and evaluating throws, so neither counts.
 */
async function waitForCheckToClear(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cleared = await page.evaluate<boolean>(PAGE_CLEARED).catch(() => false);
    if (cleared) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

async function cookiesFromJar(jar: Jar, url: string) {
  return (await jar.getCookies(url))
    .filter((c) => c.domain)
    .map((c) => ({
      name: c.key,
      value: c.value,
      domain: c.domain as string,
      path: c.path ?? '/',
      secure: c.secure,
      httpOnly: c.httpOnly,
      expires: c.expires instanceof Date ? Math.floor(c.expires.getTime() / 1000) : undefined,
    }));
}

async function copyCookiesToJar(context: BrowserContext, jar: Jar): Promise<void> {
  for (const c of await context.cookies()) {
    await setJarCookie(jar, {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires > 0 ? c.expires : null,
      secure: c.secure,
      httpOnly: c.httpOnly,
    });
  }
}

async function setJarCookie(jar: Jar, c: ClearanceCookie): Promise<void> {
  const domain = c.domain.replace(/^\./, '');
  const path = c.path || '/';
  const parts = [`${c.name}=${c.value}`, `Domain=${domain}`, `Path=${path}`];
  if (c.expires) parts.push(`Expires=${new Date(c.expires * 1000).toUTCString()}`);
  if (c.httpOnly) parts.push('HttpOnly');
  if (c.secure) parts.push('Secure');
  try {
    await jar.setCookie(parts.join('; '), `${c.secure ? 'https' : 'http'}://${domain}${path}`);
  } catch {
    // A cookie the jar refuses for its URL doesn't matter for the check.
  }
}

/**
 * Makes `client` pass Cloudflare checks with CloudflareSolver instead of
 * browser-rest-api's own engine. The library has no option for it, so this
 * sets the Orchestrator's private `browserEngine`, which it only creates
 * when empty. The Orchestrator itself exists once the client's async init
 * is done; this callback runs before any request's, which awaits the same
 * promise later.
 */
export function useCloudflareSolver(client: BrowserClient): void {
  const internals = client as unknown as ClientInternals;
  internals.ready.then(
    () => {
      if (internals.orchestrator) internals.orchestrator.browserEngine = new CloudflareSolver(client);
      else log('cloudflare: browser-rest-api has no orchestrator; its own solver stays');
    },
    // The request that awaits `ready` reports the failure.
    () => undefined,
  );
}

/**
 * Takes a check the user passed in the host's browser: its cookies go into
 * the jar, and requests switch to that browser's User-Agent, which the
 * clearance is bound to. The session keeps both until a headless check
 * replaces them.
 */
export async function importClearance(
  client: BrowserClient,
  cookies: ClearanceCookie[],
  userAgent: string,
): Promise<void> {
  const internals = client as unknown as ClientInternals;
  await internals.ready;
  if (!internals.jar) throw new Error('browser-rest-api has no cookie jar');
  for (const cookie of cookies) await setJarCookie(internals.jar, cookie);
  client.setHeader('user-agent', userAgent);
  log(`cloudflare: imported ${cookies.length} cookie(s) from the in-app check`);
}
