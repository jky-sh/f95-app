import { describe, expect, it } from 'vitest';
import { classifyHost } from '../domain/game/hosts';
import {
  inferRefererFromMasked,
  parseUnmaskResponse,
} from '../domain/f95/unmask';
import { isCloudflareInterstitial, assertNotCloudflareChallenge, isBotChallengePage } from '../shared/cloudflare';
import { RpcError } from '../rpc';
import { normalizeBuzzheavierUrl } from '../domain/resolvers/buzzheavier';
import { parseDatanodesUrl } from '../domain/resolvers/datanodes';
import { parseMixdropUrl } from '../domain/resolvers/mixdrop';
import { parseGofileUrl } from '../domain/resolvers/gofile';
import { parseWorkuploadUrl } from '../domain/resolvers/workupload';
import { cleanDownloadFileName } from '../shared/filename';

describe('cleanDownloadFileName', () => {
  it('strips trailing human size from WorkUpload-style names', () => {
    expect(cleanDownloadFileName('SkarpWorld_Collection.7z (520.47 MB)')).toBe(
      'SkarpWorld_Collection.7z',
    );
    expect(cleanDownloadFileName('game.zip (1.2 GB)')).toBe('game.zip');
    expect(cleanDownloadFileName('plain.7z')).toBe('plain.7z');
  });
});

describe('classifyHost', () => {
  it('classifies direct file hosts', () => {
    expect(classifyHost('https://pixeldrain.com/u/abc123')).toEqual({
      host: 'pixeldrain',
      category: 'direct',
    });
  });

  it('classifies F95 masked URLs by embedded host', () => {
    expect(
      classifyHost('https://f95zone.to/masked/pixeldrain.com/161330/5617588/aB1cD2/eF3gH4/iJ5kL6'),
    ).toEqual({ host: 'pixeldrain', category: 'direct' });
  });

  // F95 masks with the full domain: /masked/<domain>/<thread>/<post>/<k1>/<k2>/<k3>.
  const masked = (domain: string) =>
    `https://f95zone.to/masked/${domain}/161330/5617588/aB1cD2/eF3gH4/iJ5kL6`;

  it.each([
    ['vikingfile.com', 'vikingfile'],
    ['vik1ngfile.site', 'vikingfile'],
    ['vikingf1le.us.to', 'vikingfile'],
    ['terminal.lc', 'terminal'],
    ['akirabox.com', 'akirabox'],
    ['akirabox.to', 'akirabox'],
    ['bowfile.com', 'bowfile'],
    ['uploadnow.io', 'uploadnow'],
    ['uploadnow.co', 'uploadnow'],
    ['krakenfiles.com', 'krakenfiles'],
    ['wdho.ru', 'wdho'],
    ['qu.ax', 'qu.ax'],
    ['files.dp.ua', 'files.dp.ua'],
    ['bzzhr.to', 'buzzheavier'],
    ['bzzhr.co', 'buzzheavier'],
    ['buzzheavier.com', 'buzzheavier'],
    ['mixdrop.ag', 'mixdrop'],
    ['mixdrop.is', 'mixdrop'],
    ['mixdrop.ps', 'mixdrop'],
    ['mxdrop.to', 'mixdrop'],
    ['m1xdrop.net', 'mixdrop'],
    ['mixdrp.co', 'mixdrop'],
  ])('classifies masked %s as %s', (domain, host) => {
    expect(classifyHost(masked(domain))).toEqual({ host, category: 'direct' });
  });

  it.each([
    ['https://vikingfile.com/f/TPRSfLvcIu', 'vikingfile'],
    ['https://vik1ngfile.site/f/A0N4oHXRDy', 'vikingfile'],
    ['https://terminal.lc/r5y9d_6op-z_k7gw', 'terminal'],
    ['https://akirabox.com/LJlGnVb8AG15/file', 'akirabox'],
    ['https://akirabox.to/Z9dzBXkqmk1b/file', 'akirabox'],
    ['https://bowfile.com/4aOer', 'bowfile'],
    ['https://www.bowfile.com/99iW', 'bowfile'],
    ['https://uploadnow.io/f/1jbTQ1Y', 'uploadnow'],
    ['https://krakenfiles.com/view/abc123/file.html', 'krakenfiles'],
    ['https://wdho.ru/abc', 'wdho'],
    ['https://qu.ax/AbCd.zip', 'qu.ax'],
    ['https://files.dp.ua/abc', 'files.dp.ua'],
    ['https://bzzhr.to/abc12345', 'buzzheavier'],
    ['https://mixdrop.is/f/abc123', 'mixdrop'],
    ['https://mxdrop.top/f/abc123', 'mixdrop'],
  ])('classifies unmasked %s as %s', (url, host) => {
    expect(classifyHost(url)).toEqual({ host, category: 'direct' });
  });

  it('keeps an unknown masked domain as its own id', () => {
    expect(classifyHost(masked('example-host.net'))).toEqual({
      host: 'example-host.net',
      category: 'direct',
    });
  });

  it('drops unknown unmasked hosts', () => {
    expect(classifyHost('https://example-host.net/file/abc')).toBeNull();
  });

  it('classifies social hosts', () => {
    expect(classifyHost('https://www.patreon.com/creator')).toEqual({
      host: 'patreon',
      category: 'social',
    });
  });

  it('returns null for invalid URLs', () => {
    expect(classifyHost('not-a-url')).toBeNull();
  });
});

describe('unmask', () => {
  it('parses ok response', () => {
    expect(parseUnmaskResponse('{"status":"ok","msg":"https://example.com/file.zip"}')).toEqual({
      status: 'ok',
      msg: 'https://example.com/file.zip',
    });
  });

  it('returns null for non-JSON', () => {
    expect(parseUnmaskResponse('<html>login</html>')).toBeNull();
  });

  it('infers referer from masked URL', () => {
    expect(
      inferRefererFromMasked('https://f95zone.to/masked/mega.nz/12345/67890/aB1cD2/eF3gH4/iJ5kL6'),
    ).toBe('https://f95zone.to/threads/12345/');
  });

  it('returns null when thread id missing', () => {
    expect(inferRefererFromMasked('https://pixeldrain.com/u/abc')).toBeNull();
  });
});

describe('cloudflare', () => {
  it('detects interstitial HTML', () => {
    const html =
      '<title>Just a moment...</title> challenges.cloudflare.com challenge';
    expect(isCloudflareInterstitial(html)).toBe(true);
  });

  it('throws on CF challenge header', () => {
    expect(() =>
      assertNotCloudflareChallenge('', { 'cf-mitigated': 'challenge' }),
    ).toThrow(RpcError);
  });

  it('detects WorkUpload bot check page', () => {
    const html =
      '<title>workupload - Are you a human?</title> Checking that you are not a robot';
    expect(isBotChallengePage(html)).toBe(true);
  });
});

describe('buzzheavier', () => {
  it('normalizes mirror URLs', () => {
    expect(normalizeBuzzheavierUrl('https://bzzhr.co/abc12345')).toBe(
      'https://buzzheavier.com/abc12345',
    );
  });

  it('accepts the current bzzhr.to domain', () => {
    expect(normalizeBuzzheavierUrl('https://bzzhr.to/abc12345')).toBe(
      'https://buzzheavier.com/abc12345',
    );
    expect(normalizeBuzzheavierUrl('https://www.bzzhr.to/abc12345')).toBe(
      'https://buzzheavier.com/abc12345',
    );
  });

  it('rejects other domains', () => {
    expect(() => normalizeBuzzheavierUrl('https://example.com/abc12345')).toThrow(RpcError);
  });
});

describe('datanodes', () => {
  it('parses file code from URL', () => {
    const parsed = parseDatanodesUrl('https://datanodes.to/abc1234567/MyFile.zip');
    expect(parsed.code).toBe('abc1234567');
    expect(parsed.fileName).toBe('MyFile.zip');
  });
});

describe('mixdrop', () => {
  it('parses /f/ and /e/ URLs', () => {
    const f = parseMixdropUrl('https://mixdrop.co/f/abc123');
    expect(f.fileref).toBe('abc123');
    expect(f.pageUrl).toBe('https://mixdrop.ag/f/abc123');
    const e = parseMixdropUrl('https://mixdrop.sx/e/xyz789');
    expect(e.fileref).toBe('xyz789');
    expect(e.pageUrl).toBe('https://mixdrop.ag/f/xyz789');
  });

  it.each(['mixdrop.is', 'mixdrop.ps', 'mxdrop.top', 'mxdrop.to', 'm1xdrop.com', 'mixdrp.to'])(
    'accepts the %s mirror',
    (domain) => {
      expect(parseMixdropUrl(`https://${domain}/f/abc123`).fileref).toBe('abc123');
    },
  );

  it('rejects the miixdrop ad host', () => {
    expect(() => parseMixdropUrl('https://miixdrop.net/f/abc123')).toThrow(RpcError);
  });
});

describe('gofile', () => {
  it('parses content id from /d/ URL', () => {
    const parsed = parseGofileUrl('https://gofile.io/d/r9nRWl');
    expect(parsed.contentId).toBe('r9nRWl');
    expect(parsed.pageUrl).toBe('https://gofile.io/d/r9nRWl');
  });

  it('parses content id from /download/ URL', () => {
    const parsed = parseGofileUrl('https://www.gofile.io/download/abc123');
    expect(parsed.contentId).toBe('abc123');
  });
});

describe('workupload', () => {
  it('parses file id from URL', () => {
    const parsed = parseWorkuploadUrl('https://workupload.com/file/abc123/MyGame.zip');
    expect(parsed.fileId).toBe('abc123');
    expect(parsed.fileName).toBe('MyGame.zip');
    expect(parsed.pageUrl).toBe('https://workupload.com/file/abc123/MyGame.zip');
  });

  it('parses id-only URL', () => {
    const parsed = parseWorkuploadUrl('https://www.workupload.com/file/xyz789');
    expect(parsed.fileId).toBe('xyz789');
    expect(parsed.fileName).toBeNull();
  });
});
