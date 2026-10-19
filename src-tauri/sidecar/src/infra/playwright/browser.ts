import type { Browser } from 'playwright';
import { loadPlaywright } from './runtime';

let sharedBrowser: Browser | null = null;

export async function getPlaywrightBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    const { chromium } = loadPlaywright();
    sharedBrowser = await chromium.launch({
      channel: 'chromium',
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--log-level=3',
        '--disable-dev-shm-usage',
      ],
    });
  }
  return sharedBrowser;
}

export async function closePlaywrightBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

/** Headed Chromium for captcha / interactive host flows (separate from shared headless). */
export async function launchInteractiveBrowser(): Promise<Browser> {
  const { chromium } = loadPlaywright();
  return chromium.launch({
    channel: 'chromium',
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--log-level=3',
      '--disable-dev-shm-usage',
      '--disable-popup-blocking',
    ],
  });
}
