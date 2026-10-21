import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * F95 serves every attachment three ways: the original on
 * `attachments.f95zone.to`, a 400 px version on `preview.f95zone.to` (what
 * SAM hands out as covers) and a 100 px one under `/thumb/`, too small to
 * show scaled up anywhere.
 */
const ORIGINAL_HOST = 'attachments.f95zone.to';
const PREVIEW_HOST = 'preview.f95zone.to';

/** Remove `/thumb/` imediatamente antes do nome do arquivo (URL em resolução cheia). */
export function toF95FullUrl(url: string): string {
  return url.replace(/\/thumb\/(?=[^/]+$)/, '/');
}

/** Path of an F95 attachment (without `/thumb/`) on either image host, else null. */
function attachmentPath(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host !== ORIGINAL_HOST && host !== PREVIEW_HOST) return null;
    return toF95FullUrl(u.pathname);
  } catch {
    return null;
  }
}

export function isF95AttachmentUrl(url: string): boolean {
  return attachmentPath(url) !== null;
}

/** The 400 px version of an F95 attachment; other URLs unchanged. */
export function toF95PreviewUrl(url: string): string {
  const path = attachmentPath(url);
  return path ? `https://${PREVIEW_HOST}${path}` : url;
}

/** The full-size original of an F95 attachment; other URLs unchanged. */
export function toF95OriginalUrl(url: string): string {
  const path = attachmentPath(url);
  return path ? `https://${ORIGINAL_HOST}${path}` : url;
}

/** URL para mostrar imediatamente enquanto o preview em cache não fica pronto. */
export function instantPreviewUrl(full: string): string | null {
  return isF95AttachmentUrl(full) ? toF95PreviewUrl(full) : null;
}

/**
 * Images on f95zone.to itself (avatars, profile covers, smilies). Since
 * 2026-10-19 Cloudflare challenges every request there without its
 * clearance cookie, so the webview can't load them directly; the app's
 * `f95img` protocol (`src-tauri/src/f95_image.rs`) loads them through the
 * sidecar, which has that cookie.
 */
const F95_SITE_IMAGE = /^https:\/\/(?:www\.)?f95zone\.to(\/(?:data|styles|assets)\/[^#\s]*)$/i;

let f95ImageBase: string | null | undefined;

/** Where to load an f95zone.to image from: the `f95img` protocol. Other URLs unchanged. */
export function f95ImageSrc(url: string): string {
  const path = F95_SITE_IMAGE.exec(url)?.[1];
  if (!path) return url;
  if (f95ImageBase === undefined) {
    try {
      // "http://f95img.localhost/" on Windows, "f95img://localhost/" elsewhere.
      f95ImageBase = convertFileSrc('', 'f95img');
    } catch {
      f95ImageBase = null; // outside Tauri
    }
  }
  return f95ImageBase ? f95ImageBase + path.slice(1) : url;
}

const IMAGE_KEYS = new Set(['avatarUrl', 'coverUrl']);

/**
 * A sidecar result with every `avatarUrl` / `coverUrl` (at any depth)
 * pointed at {@link f95ImageSrc}. Profiles cached by older versions hold the
 * plain URLs, so their loader passes through here too.
 */
export function withF95Images<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withF95Images) as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = IMAGE_KEYS.has(key) && typeof v === 'string' ? f95ImageSrc(v) : withF95Images(v);
  }
  return out as T;
}
