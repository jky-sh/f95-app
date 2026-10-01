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
