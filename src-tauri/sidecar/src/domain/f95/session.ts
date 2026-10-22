import type { BrowserClient } from 'browser-rest-api';
import { F95_BASE } from '../../shared/constants';
import type { ClearanceCookie } from '../../infra/playwright/cloudflareSolver';

/** The parts of browser-rest-api's client this module reads; it has no API for them. */
interface ClientInternals {
  ready: Promise<void>;
  jar?: { getCookies(url: string): Promise<JarCookie[]> };
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

/**
 * The client's F95 sign-in cookies (`xf_*`), for a webview of the app that
 * shows an F95 page as the same member: the download page whose hCaptcha
 * a person has to pass. Cloudflare's cookies stay out, since they only hold
 * for this client's User-Agent.
 */
export async function f95SessionCookies(http: BrowserClient): Promise<ClearanceCookie[]> {
  const internals = http as unknown as ClientInternals;
  await internals.ready;
  const cookies = (await internals.jar?.getCookies(`${F95_BASE}/`)) ?? [];
  return cookies
    .filter((c) => c.key.startsWith('xf_'))
    .map((c) => ({
      name: c.key,
      value: c.value,
      domain: (c.domain ?? 'f95zone.to').replace(/^\./, ''),
      path: c.path || '/',
      expires: c.expires instanceof Date ? Math.floor(c.expires.getTime() / 1000) : null,
      secure: c.secure ?? true,
      httpOnly: c.httpOnly ?? false,
    }));
}
