import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserClient } from 'browser-rest-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importClearance, useCloudflareSolver } from '../infra/playwright/cloudflareSolver';
import { RPC_ERROR } from '../rpc';

/** browser-rest-api internals the solver depends on; a library update that moves them fails here. */
interface Internals {
  ready: Promise<void>;
  jar: { getCookies(url: string): Promise<{ key: string; value: string }[]> };
  orchestrator: {
    browserEngine: {
      solveChallenge(url: string, challenge: { type: string }, jar: unknown, cb: unknown, ua: string): Promise<void>;
    } | null;
  };
  buildHeaders(): Record<string, string>;
}

describe('cloudflare solver', () => {
  let dir: string;
  let client: BrowserClient;
  let internals: Internals;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f95-cf-'));
    client = new BrowserClient({ session: 'test', sessionDir: dir, userAgent: 'UA-chromium' });
    internals = client as unknown as Internals;
    useCloudflareSolver(client);
    await internals.ready;
  });

  afterEach(async () => {
    delete process.env.F95_CLOUDFLARE_SKIP_HEADLESS;
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the library engine once the client is ready', () => {
    expect(typeof internals.orchestrator.browserEngine?.solveChallenge).toBe('function');
  });

  it('asks for a person when the headless check does not pass', async () => {
    process.env.F95_CLOUDFLARE_SKIP_HEADLESS = '1';
    const url = 'https://f95zone.to/login/';
    await expect(
      internals.orchestrator.browserEngine!.solveChallenge(url, { type: 'cloudflare' }, internals.jar, undefined, 'UA'),
    ).rejects.toMatchObject({
      code: RPC_ERROR.CLOUDFLARE_CHALLENGE,
      data: { variant: 'interactive', url },
    });
  });

  it('leaves reCAPTCHA pages to the plain retry', async () => {
    await expect(
      internals.orchestrator.browserEngine!.solveChallenge(
        'https://f95zone.to/',
        { type: 'recaptcha-v3' },
        internals.jar,
        undefined,
        'UA',
      ),
    ).resolves.toBeUndefined();
  });

  it('imports the clearance and switches to its User-Agent', async () => {
    await importClearance(
      client,
      [
        {
          name: 'cf_clearance',
          value: 'abc',
          domain: '.f95zone.to',
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 3600,
          secure: true,
          httpOnly: true,
        },
      ],
      'UA-webview2',
    );
    const cookies = await internals.jar.getCookies('https://f95zone.to/login/');
    expect(cookies.map((c) => `${c.key}=${c.value}`)).toContain('cf_clearance=abc');
    expect(internals.buildHeaders()['user-agent']).toBe('UA-webview2');
  });
});
