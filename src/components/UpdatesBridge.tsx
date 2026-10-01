import { useEffect } from 'react';
import { useOffline } from '../contexts/Offline';
import { useNavCounts } from '../hooks/useNavCounts';
import { appUpdateOffer, useAppUpdate } from '../lib/appUpdateState';
import { setSchedulerOnline, startBackgroundScheduler } from '../lib/backgroundScheduler';
import { useT } from '../lib/i18n';
import { setTrayStatus } from '../lib/tray';

/** Runs the background update checks while the main window is open. Mounted once. */
export function BackgroundScheduler() {
  const { isOffline } = useOffline();
  useEffect(() => startBackgroundScheduler(), []);
  useEffect(() => setSchedulerOnline(!isOffline), [isOffline]);
  return null;
}

/** Keeps the tray tooltip saying what is waiting: game updates, a new app version. */
export function UpdateStatusBridge() {
  const { t } = useT();
  const { updates } = useNavCounts();
  const offer = appUpdateOffer(useAppUpdate());
  const appVersion = offer?.version ?? null;
  useEffect(() => {
    setTrayStatus({ gameUpdates: updates, appUpdate: appVersion }, t);
  }, [updates, appVersion, t]);
  return null;
}
