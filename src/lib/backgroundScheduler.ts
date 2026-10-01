/**
 * One clock for the main window's background work. Every minute, and
 * whenever the window comes back to the front or the network returns, each
 * job runs if its interval has passed since it last finished. That time is
 * kept in app_settings, so sleep, a hidden window's slowed timers or a
 * restart only delay a job until the next look; they never skip it.
 */
import { subscribeAppRuntimeSettings } from './appRuntimeSettings';
import { runAppUpdateCheck } from './appUpdateState';
import { isAutoUpdateEnabled } from './appUpdater';
import { KEY_RSS_LAST_POLL_AT, pollRssLibraryUpdates } from './rssUpdates';
import * as settings from './settings';
import { KEY_UPDATES_CHECKED_AT, runUpdateCheck } from './updateChecker';
import { KEY_APP_UPDATE_CHECKED_AT, loadUpdatePrefs, onUpdatePrefsChange } from './updateSettings';

const MINUTE_MS = 60_000;
const TICK_MS = MINUTE_MS;
/** After a run that did not finish, wait this long before trying again. */
const RETRY_MS = 10 * MINUTE_MS;

interface Job {
  id: string;
  /** app_settings key the job writes when it finishes (ms). */
  lastRunKey: string;
  /** Null while the job is turned off. */
  interval: () => Promise<number | null>;
  /** Startup grace, so the first runs don't compete with the app loading. */
  firstDelayMs: number;
  /** Also run once shortly after startup, however recent the last run is. */
  runAtStart?: boolean;
  run: () => Promise<unknown>;
}

const JOBS: Job[] = [
  {
    // The RSS feed: the quick way to hear of an update (about a day of entries).
    id: 'rss',
    lastRunKey: KEY_RSS_LAST_POLL_AT,
    firstDelayMs: 30_000,
    interval: async () => ((await loadUpdatePrefs()).gamesAuto ? 15 * MINUTE_MS : null),
    run: () => pollRssLibraryUpdates(),
  },
  {
    // SAM's latest updates since the last sweep: covers what the feed missed.
    id: 'catalog',
    lastRunKey: KEY_UPDATES_CHECKED_AT,
    firstDelayMs: 90_000,
    interval: async () => {
      const prefs = await loadUpdatePrefs();
      return prefs.gamesAuto ? prefs.gamesIntervalMin * MINUTE_MS : null;
    },
    run: () => runUpdateCheck({ background: true }),
  },
  {
    id: 'app',
    lastRunKey: KEY_APP_UPDATE_CHECKED_AT,
    firstDelayMs: 5_000,
    runAtStart: true,
    interval: async () => ((await isAutoUpdateEnabled()) ? 6 * 60 * MINUTE_MS : null),
    run: () => runAppUpdateCheck({ background: true }),
  },
];

let startedAt = 0;
let online = true;
let active = false;
let ticking = false;
let tickAgain = false;
const running = new Set<string>();
/** When each job last started in this session (a failed run is retried later). */
const lastAttempt = new Map<string, number>();

async function isDue(job: Job, now: number): Promise<boolean> {
  if (running.has(job.id) || now - startedAt < job.firstDelayMs) return false;
  const attempted = lastAttempt.get(job.id);
  if (attempted !== undefined && now - attempted < RETRY_MS) return false;
  const interval = await job.interval().catch(() => null);
  if (interval == null) return false;
  if (job.runAtStart && attempted === undefined) return true;
  const last = Number(await settings.get(job.lastRunKey).catch(() => null));
  return !(Number.isFinite(last) && last > 0 && now - last < interval);
}

async function tick(): Promise<void> {
  if (!active || !online) return;
  if (ticking) {
    tickAgain = true;
    return;
  }
  ticking = true;
  try {
    do {
      tickAgain = false;
      const now = Date.now();
      for (const job of JOBS) {
        if (!(await isDue(job, now)) || !active || !online) continue;
        running.add(job.id);
        lastAttempt.set(job.id, now);
        void job
          .run()
          .catch((err) => console.warn(`[scheduler] ${job.id} failed`, err))
          .finally(() => running.delete(job.id));
      }
    } while (tickAgain);
  } finally {
    ticking = false;
  }
}

function poke(): void {
  void tick();
}

/** Start the clock (main window only). Returns the stop function. */
export function startBackgroundScheduler(): () => void {
  active = true;
  startedAt = Date.now();
  const timers = [...new Set(JOBS.map((j) => j.firstDelayMs))].map((delay) =>
    window.setTimeout(poke, delay + 50),
  );
  const every = window.setInterval(poke, TICK_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') poke();
  };
  window.addEventListener('focus', poke);
  document.addEventListener('visibilitychange', onVisible);
  // A toggle or a new interval takes effect now, not at the next tick.
  const stopPrefs = onUpdatePrefsChange(poke);
  const stopRuntime = subscribeAppRuntimeSettings(poke);
  return () => {
    active = false;
    timers.forEach((t) => window.clearTimeout(t));
    window.clearInterval(every);
    window.removeEventListener('focus', poke);
    document.removeEventListener('visibilitychange', onVisible);
    stopPrefs();
    stopRuntime();
  };
}

/** Offline pauses every job; coming back online looks at once. */
export function setSchedulerOnline(next: boolean): void {
  const cameBack = next && !online;
  online = next;
  if (cameBack) poke();
}
