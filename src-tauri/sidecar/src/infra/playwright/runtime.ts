import { spawn } from 'node:child_process';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { BrowserType, LaunchOptions } from 'playwright';
import { log } from '../../logger';

/**
 * Keeps Playwright's Chromium usable without anyone running
 * `playwright install`.
 *
 * Playwright only launches the exact Chromium revision its own build was
 * made with. The host points PLAYWRIGHT_BROWSERS_PATH at a per-user cache,
 * and release builds also ship that revision inside the install
 * (F95_BUNDLED_BROWSERS), which may be read-only (Program Files). The
 * shipped copy is used while it has what this Playwright expects; when
 * neither has it (an update moved to a new revision, an antivirus removed
 * chrome.exe, an install was cut short), Playwright's own installer
 * downloads it into the cache.
 *
 * Every launch goes through the full Chromium build: browser-rest-api
 * launches with only `{ headless: true }`, which asks for the separate
 * headless shell that isn't shipped.
 */

type Playwright = typeof import('playwright');

/** A launch waits this long for a download in progress: the RPC queue is serial. */
const LAUNCH_WAIT_MS = 45_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const GUARDED = Symbol.for('f95.chromiumLaunchGuard');

interface Install {
  promise: Promise<void>;
  /** Last percentage Playwright's installer printed. */
  percent: number | null;
}

let install: Install | null = null;

/** The writable browsers dir; set before playwright-core loads, which reads it once. */
export function browsersCacheDir(): string {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    // Standalone runs (tsx scripts): the app's local data dir.
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(base, 'com.f95.app', 'ms-playwright');
  }
  return process.env.PLAYWRIGHT_BROWSERS_PATH;
}

function browserDirs(): string[] {
  const bundled = process.env.F95_BUNDLED_BROWSERS;
  return bundled ? [bundled, browsersCacheDir()] : [browsersCacheDir()];
}

function playwrightCoreDir(): string {
  return path.dirname(require.resolve('playwright-core/package.json'));
}

/** `chromium-<revision>`, the folder this Playwright build installs Chromium into. */
export function expectedChromiumFolder(coreDir = playwrightCoreDir()): string | null {
  const { browsers } = JSON.parse(fs.readFileSync(path.join(coreDir, 'browsers.json'), 'utf8')) as {
    browsers: { name: string; revision: string }[];
  };
  const chromium = browsers.find((b) => b.name === 'chromium');
  return chromium ? `chromium-${chromium.revision}` : null;
}

function isInstalled(browsersDir: string, folder: string): boolean {
  return fs.existsSync(path.join(browsersDir, folder, 'INSTALLATION_COMPLETE'));
}

/**
 * Chromium's executable in the first browsers dir that has it, or null.
 * `chromium.executablePath()` is where this Playwright expects it inside the
 * cache, e.g. `<cache>\chromium-1223\chrome-win64\chrome.exe`.
 */
export function findChromium(expected: string): string | null {
  const relative = path.relative(browsersCacheDir(), expected);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return fs.existsSync(expected) ? expected : null;
  }
  const folder = relative.split(path.sep)[0];
  for (const dir of browserDirs()) {
    const executable = path.join(dir, relative);
    if (isInstalled(dir, folder) && fs.existsSync(executable)) return executable;
  }
  return null;
}

/** Downloads Chromium into the cache; callers share one download. */
function installChromium(reason: string): Install {
  if (install) return install;
  const cacheDir = browsersCacheDir();
  const cli = path.join(playwrightCoreDir(), 'cli.js');
  log(`chromium: ${reason}; downloading it into ${cacheDir}`);

  const current: Install = { percent: null, promise: Promise.resolve() };
  current.promise = new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium', '--no-shell'], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cacheDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let lastLine = '';
    const onOutput = (chunk: Buffer) => {
      // Without the color codes it prints even when piped.
      for (const raw of chunk.toString().replace(/\x1b\[[0-9;]*m/g, '').split(/\r\n|\r|\n/)) {
        const line = raw.trim();
        if (!line) continue;
        lastLine = line;
        const percent = /(\d{1,3})%/.exec(line);
        if (percent) current.percent = Number(percent[1]);
        else log('chromium install:', line);
      }
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        log('chromium: download finished');
        resolve();
      } else {
        reject(new Error(lastLine || `playwright install exited with ${code ?? signal}`));
      }
    });
  }).finally(() => {
    install = null;
  });
  install = current;
  return current;
}

/** Path of a usable Chromium executable, downloading it when it's missing. */
async function ensureChromium(chromium: BrowserType): Promise<string> {
  const expected = chromium.executablePath();
  const found = findChromium(expected);
  if (found) return found;

  const pending = installChromium(`${expected} is missing`);
  let timer: NodeJS.Timeout | undefined;
  const finished = await Promise.race([
    pending.promise.then(
      () => true,
      (err: Error) => {
        throw new Error(`Chromium is missing and could not be downloaded: ${err.message}`);
      },
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), LAUNCH_WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  if (!finished) {
    const percent = pending.percent === null ? '' : ` (${pending.percent}%)`;
    throw new Error(`Chromium is still downloading${percent}; try again in a moment`);
  }
  const installed = findChromium(expected);
  if (!installed) throw new Error(`Chromium was downloaded but ${expected} is missing`);
  return installed;
}

/**
 * Wraps `chromium.launch` so it always gets a Chromium that exists: the
 * shipped or cached full build, downloaded first when missing. Callers that
 * pick another browser (Chrome, Edge, an explicit path) are left alone.
 */
export function guardChromiumLaunch(pw: Pick<Playwright, 'chromium'>): void {
  const chromium = pw.chromium as BrowserType & { [GUARDED]?: true };
  if (chromium[GUARDED]) return;
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (options: LaunchOptions = {}) => {
    if (options.executablePath || (options.channel && options.channel !== 'chromium')) {
      return launch(options);
    }
    const executablePath = await ensureChromium(chromium);
    try {
      return await launch({ ...options, channel: undefined, executablePath });
    } catch (err) {
      // An antivirus can remove chrome.exe between the check and the launch.
      if (fs.existsSync(executablePath)) throw err;
      return launch({ ...options, channel: undefined, executablePath: await ensureChromium(chromium) });
    }
  };
  chromium[GUARDED] = true;
}

/** Playwright with the launch guard on. */
export function loadPlaywright(): Playwright {
  browsersCacheDir();
  const pw = require('playwright') as Playwright;
  guardChromiumLaunch(pw);
  return pw;
}

/**
 * Call at startup, before anything loads Playwright. browser-rest-api
 * requires `playwright` itself when it meets a challenge, so the guard goes
 * on whenever that module is first loaded, by anyone.
 */
export function installPlaywrightGuard(): void {
  browsersCacheDir();
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const load = loader._load;
  loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
    const exports = load.call(this, request, ...rest);
    if (request === 'playwright' || request === 'playwright-core') {
      guardChromiumLaunch(exports as Playwright);
    }
    return exports;
  };
}

/**
 * Starts the download in the background when no browsers dir has the
 * Chromium this Playwright build needs, so it's usually done before a
 * download host or a Cloudflare check asks for a browser.
 */
export function prefetchChromium(): void {
  try {
    const folder = expectedChromiumFolder();
    if (!folder || browserDirs().some((dir) => isInstalled(dir, folder))) return;
    installChromium(`${folder} is not installed`).promise.catch((err: Error) => {
      log('chromium: download failed:', err.message);
    });
  } catch (err) {
    log('chromium: could not check the browser install:', (err as Error).message);
  }
}
