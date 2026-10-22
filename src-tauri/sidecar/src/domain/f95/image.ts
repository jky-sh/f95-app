import type { BrowserClient } from 'browser-rest-api';
import { RPC_ERROR, RpcError } from '../../rpc';
import { F95_BASE } from '../../shared/constants';

/**
 * Images F95 serves from its own domain: avatars, profile covers, smilies.
 * Since 2026-10-19 Cloudflare challenges every f95zone.to request without
 * the clearance cookie, so the app's WebView gets a 403 page instead of the
 * picture. The host loads them through here (the `f95img` protocol), with
 * the cookies and User-Agent the client passed the check with.
 * (`attachments.` and `preview.f95zone.to` aren't challenged and stay direct.)
 */
const IMAGE_PATH = /^\/(data|styles|assets)\//;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export interface F95Image {
  contentType: string;
  /** Base64 of the image bytes. */
  data: string;
}

/** The parts of browser-rest-api's client this module reads; it has no API for them. */
interface ClientInternals {
  ready: Promise<void>;
  jar?: { getCookieString(url: string): Promise<string> };
  buildHeaders?: () => Record<string, string>;
}

export function isF95ImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      /^(www\.)?f95zone\.to$/i.test(u.hostname) &&
      IMAGE_PATH.test(u.pathname)
    );
  } catch {
    return false;
  }
}

export async function fetchF95Image(http: BrowserClient, url: string): Promise<F95Image> {
  if (!isF95ImageUrl(url)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `not an F95 image URL: ${url}`);
  }
  const internals = http as unknown as ClientInternals;
  await internals.ready;
  const userAgent = internals.buildHeaders?.()['user-agent'];
  const cookie = (await internals.jar?.getCookieString(url)) ?? '';

  const res = await fetch(url, {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      referer: `${F95_BASE}/`,
      ...(userAgent ? { 'user-agent': userAgent } : {}),
      ...(cookie ? { cookie } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !contentType.startsWith('image/')) {
    await res.body?.cancel();
    const challenged = res.headers.get('cf-mitigated') === 'challenge' ? ', Cloudflare check' : '';
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      `F95 image: HTTP ${res.status} (${contentType || 'no content type'}${challenged})`,
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new RpcError(RPC_ERROR.INTERNAL, `F95 image too large (${bytes.length} bytes)`);
  }
  return { contentType, data: bytes.toString('base64') };
}
