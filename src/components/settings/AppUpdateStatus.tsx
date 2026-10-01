import { useState } from 'react';
import { useOffline } from '../../contexts/Offline';
import { useNow } from '../../hooks/useNow';
import { installLabel, skipAppUpdate, useAppUpdate } from '../../lib/appUpdateState';
import { installAppUpdate } from '../../lib/appUpdater';
import { useT } from '../../lib/i18n';
import { formatWhen } from '../../lib/memberPresence';

/**
 * Settings → About, app updates card: when the app last checked, and the
 * update it found with Install and "Skip this version".
 */
export function AppUpdateStatus() {
  const { t, locale } = useT();
  const { isOffline } = useOffline();
  const now = useNow();
  const update = useAppUpdate();
  const [busy, setBusy] = useState(false);
  const { available, install } = update;

  return (
    <>
      <p className="settings-offline-last" style={{ marginTop: 12 }}>
        {update.checking
          ? t('settings.updates.checking')
          : update.checkedAt
            ? t('settings.updates.lastChecked', { when: formatWhen(update.checkedAt, locale, now) })
            : t('settings.updates.neverChecked')}
      </p>
      {available && (
        <>
          <p className="settings-card-hint" style={{ marginTop: 8 }}>
            <strong>{t('settings.updates.availableVersion', { version: available.version })}</strong>{' '}
            {update.skipped === available.version
              ? t('settings.updates.skipped')
              : t('settings.updates.willRestart')}
          </p>
          <div className="settings-offline-actions">
            <button
              type="button"
              className="settings-btn settings-btn-primary"
              disabled={busy || isOffline || install != null}
              title={isOffline ? t('offline.actionBlocked') : undefined}
              onClick={() => {
                setBusy(true);
                void installAppUpdate(t).finally(() => setBusy(false));
              }}
            >
              {install
                ? installLabel(install, t)
                : t('settings.updates.installVersion', { version: available.version })}
            </button>
            {update.skipped !== available.version && (
              <button
                type="button"
                className="settings-btn"
                disabled={install != null}
                onClick={() => void skipAppUpdate(available.version)}
              >
                {t('settings.updates.skip')}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
