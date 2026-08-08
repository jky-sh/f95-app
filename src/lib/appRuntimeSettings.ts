/**
 * Desktop runtime preferences: auto-update and system tray.
 */
import * as settings from './settings';

export interface AppRuntimeSettings {
  autoUpdateEnabled: boolean;
  trayIconEnabled: boolean;
}

const DEFAULTS: AppRuntimeSettings = {
  autoUpdateEnabled: true,
  trayIconEnabled: true,
};

const listeners = new Set<(s: AppRuntimeSettings) => void>();
let cached: AppRuntimeSettings | null = null;

function notify() {
  if (!cached) return;
  for (const fn of listeners) fn(cached);
}

export async function loadAppRuntimeSettings(): Promise<AppRuntimeSettings> {
  const [autoUpdateEnabled, trayIconEnabled] = await Promise.all([
    settings.getBool(settings.KEY_AUTO_UPDATE_ENABLED, DEFAULTS.autoUpdateEnabled),
    settings.getBool(settings.KEY_TRAY_ICON_ENABLED, DEFAULTS.trayIconEnabled),
  ]);
  cached = { autoUpdateEnabled, trayIconEnabled };
  return cached;
}

export function getAppRuntimeSettings(): AppRuntimeSettings {
  return cached ?? DEFAULTS;
}

export function subscribeAppRuntimeSettings(
  fn: (s: AppRuntimeSettings) => void,
): () => void {
  listeners.add(fn);
  fn(getAppRuntimeSettings());
  return () => {
    listeners.delete(fn);
  };
}

export async function saveAppRuntimeSettings(
  patch: Partial<AppRuntimeSettings>,
): Promise<AppRuntimeSettings> {
  const current = cached ?? (await loadAppRuntimeSettings());
  const next: AppRuntimeSettings = { ...current, ...patch };
  cached = next;
  await Promise.all([
    settings.setBool(settings.KEY_AUTO_UPDATE_ENABLED, next.autoUpdateEnabled),
    settings.setBool(settings.KEY_TRAY_ICON_ENABLED, next.trayIconEnabled),
  ]);
  notify();
  return next;
}
