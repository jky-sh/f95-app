import * as cheerio from 'cheerio';
import { RPC_ERROR, RpcError } from '../../rpc';
import { isCloudflareInterstitial } from '../../shared/cloudflare';
import { USER_AGENT } from '../../shared/constants';
import { getPlaywrightBrowser } from '../../infra/playwright/browser';

const CANONICAL = 'https://buzzheavier.com';
const UA = USER_AGENT;

/** Normalize mirror URLs to buzzheavier.com/{fileId}. */
export function normalizeBuzzheavierUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `invalid BuzzHeavier URL: ${raw}`);
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  // bzzhr.to is the domain F95 links use today.
  const ok =
    host === 'buzzheavier.com' ||
    host === 'bzzhr.co' ||
    host === 'bzzhr.to' ||
    host === 'fuckingfast.net' ||
    host === 'fuckingfast.co';
  if (!ok) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `not a BuzzHeavier URL: ${raw}`);
  }
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'BuzzHeavier URL missing file id');
  }
  const id = parts[0].replace(/\/download$/, '');
  if (!/^[a-zA-Z0-9]{8,32}$/.test(id)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `invalid BuzzHeavier file id: ${id}`);
  }
  return `${CANONICAL}/${id}`;
}

function pageIsNotFound(status: number | null, html: string): boolean {
  if (status === 404) return true;
  const lower = html.slice(0, 12_000).toLowerCase();
  return (
    lower.includes('/notfound') ||
    lower.includes('try recovering this file') ||
    lower.includes('returned to the void') ||
    lower.includes("this one's ran out") ||
    lower.includes('<title>not found</title>')
  );
}
function parseSizeBytes(text: string): number | null {
  const m = text.match(/Size\s*-\s*([\d.,]+)\s*(B|KB|MB|GB|TB)/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toUpperCase();
  const mult: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return Math.round(n * (mult[unit] ?? 1));
}

function resolveDownloadUrl(hxGet: string): string {
  if (hxGet.startsWith('http')) {
    return hxGet.includes('/download') ? hxGet : `${hxGet.replace(/\/$/, '')}/download`;
  }
  const path = hxGet.startsWith('/') ? hxGet : `/${hxGet}`;
  return `${CANONICAL}${path}`;
}

function bearerHeader(accountId?: string | null): Record<string, string> {
  const id = accountId?.trim();
  if (!id) return {};
  return { authorization: `Bearer ${id}` };
}

/**
 * BuzzHeavier blocks plain HTTP clients (undici/reqwest TLS fingerprint).
 * Playwright loads the page (passes CF), then navigating to the signed
 * `/download?t=…` URL triggers a browser download whose URL is the CDN link.
 */
export async function resolveBuzzheavier(
  _http: unknown,
  url: string,
  accountId?: string | null,
): Promise<{ directUrl: string; fileName: string; fileSize: number | null }> {
  const pageUrl = normalizeBuzzheavierUrl(url);
  const baseUrl = pageUrl.replace(/\/download$/, '');

  const pw = await getPlaywrightBrowser();
  const context = await pw.newContext({
    userAgent: UA,
    acceptDownloads: true,
    extraHTTPHeaders: bearerHeader(accountId),
  });
  const page = await context.newPage();

  try {
    const nav = await page.goto(baseUrl, { waitUntil: 'load', timeout: 60_000 });
    const status = nav?.status() ?? null;
    const html = await page.content();

    if (pageIsNotFound(status, html)) {
      throw new RpcError(RPC_ERROR.INTERNAL, 'BuzzHeavier: arquivo não encontrado ou expirado');
    }
    if (isCloudflareInterstitial(html)) {
      throw new RpcError(
        RPC_ERROR.CLOUDFLARE_CHALLENGE,
        'BuzzHeavier: Cloudflare não foi resolvido — tente abrir no navegador',
      );
    }
    if (status !== null && status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `BuzzHeavier: página retornou HTTP ${status}`,
      );
    }

    const $ = cheerio.load(html);

    if ($('#tbody tr').length > 0) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'BuzzHeavier: links de pasta ainda não são suportados — use um arquivo individual',
      );
    }

    let hxGet = $('a.link-button.gay-button[hx-get*="/download"]').first().attr('hx-get')?.trim();
    if (!hxGet) {
      hxGet = $('a.link-button.gay-button').first().attr('hx-get')?.trim();
    }
    if (!hxGet) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'BuzzHeavier: botão de download não encontrado na página',
      );
    }
    if (hxGet.includes('/notfound')) {
      throw new RpcError(RPC_ERROR.INTERNAL, 'BuzzHeavier: arquivo não encontrado ou expirado');
    }

    const downloadUrl = resolveDownloadUrl(hxGet);
    const fileName =
      $('.text-2xl').first().text().trim() ||
      $('title').text().split('|')[0]?.trim() ||
      'buzzheavier-download.bin';
    const fileSize = parseSizeBytes(html) ?? parseSizeBytes($('body').text());

    const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });
    await page.goto(downloadUrl, { timeout: 45_000 }).catch(() => undefined);
    const download = await downloadPromise;
    const directUrl = download.url();
    if (!directUrl || directUrl.replace(/\/$/, '') === baseUrl.replace(/\/$/, '')) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'BuzzHeavier: link direto CDN não retornado',
      );
    }

    await download.cancel().catch(() => undefined);
    return { directUrl, fileName, fileSize };
  } catch (err) {
    if (err instanceof RpcError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|timed out/i.test(msg)) {
      throw new RpcError(
        RPC_ERROR.CLOUDFLARE_CHALLENGE,
        'BuzzHeavier: tempo esgotado ao resolver Cloudflare — tente novamente',
      );
    }
    throw new RpcError(RPC_ERROR.INTERNAL, `BuzzHeavier: ${msg}`);
  } finally {
    await context.close().catch(() => undefined);
  }
}
