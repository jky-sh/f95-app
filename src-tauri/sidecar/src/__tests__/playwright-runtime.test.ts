import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expectedChromiumFolder,
  findChromium,
  guardChromiumLaunch,
  installPlaywrightGuard,
} from '../infra/playwright/runtime';

const EXE = path.join('chromium-1223', 'chrome-win64', 'chrome.exe');

function fakeInstall(dir: string, { complete = true } = {}): string {
  const exe = path.join(dir, EXE);
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  if (complete) fs.writeFileSync(path.join(dir, 'chromium-1223', 'INSTALLATION_COMPLETE'), '');
  return exe;
}

describe('playwright runtime', () => {
  const saved = {
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
    F95_BUNDLED_BROWSERS: process.env.F95_BUNDLED_BROWSERS,
  };
  let root: string;
  let cache: string;
  let bundled: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'f95-pw-'));
    cache = path.join(root, 'cache');
    bundled = path.join(root, 'bundled');
    process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
    process.env.F95_BUNDLED_BROWSERS = bundled;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('prefers the Chromium shipped with the app', () => {
    const shipped = fakeInstall(bundled);
    fakeInstall(cache);
    expect(findChromium(path.join(cache, EXE))).toBe(shipped);
  });

  it('falls back to the cache when the shipped copy is incomplete', () => {
    fakeInstall(bundled, { complete: false });
    const cached = fakeInstall(cache);
    expect(findChromium(path.join(cache, EXE))).toBe(cached);
  });

  it('falls back to the cache when the shipped executable is gone', () => {
    fs.rmSync(fakeInstall(bundled));
    const cached = fakeInstall(cache);
    expect(findChromium(path.join(cache, EXE))).toBe(cached);
  });

  it('finds nothing when no browsers dir has this revision', () => {
    expect(findChromium(path.join(cache, EXE))).toBeNull();
  });

  it('reads the Chromium folder from the installed playwright-core', () => {
    expect(expectedChromiumFolder()).toMatch(/^chromium-\d+$/);
  });

  it('launches the full Chromium build instead of the headless shell', async () => {
    const shipped = fakeInstall(bundled);
    const launch = vi.fn(async (options: unknown) => options);
    const chromium = { launch, executablePath: () => path.join(cache, EXE) };
    guardChromiumLaunch({ chromium } as never);

    await chromium.launch({ headless: true });
    expect(launch).toHaveBeenCalledWith({ headless: true, executablePath: shipped });
  });

  it('leaves launches that pick their own browser alone', async () => {
    const launch = vi.fn(async (options: unknown) => options);
    const chromium = { launch, executablePath: () => path.join(cache, EXE) };
    guardChromiumLaunch({ chromium } as never);

    await chromium.launch({ channel: 'msedge' });
    expect(launch).toHaveBeenCalledWith({ channel: 'msedge' });
  });

  it('wraps launch only once', async () => {
    fakeInstall(cache);
    const launch = vi.fn(async (options: unknown) => options);
    const chromium = { launch, executablePath: () => path.join(cache, EXE) };
    guardChromiumLaunch({ chromium } as never);
    guardChromiumLaunch({ chromium } as never);

    await chromium.launch({});
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('guards playwright when another module requires it', () => {
    installPlaywrightGuard();
    const pw = createRequire(__filename)('playwright');
    expect(pw.chromium[Symbol.for('f95.chromiumLaunchGuard')]).toBe(true);
  });
});
