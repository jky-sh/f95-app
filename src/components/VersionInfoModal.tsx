import { useEffect, useState } from 'react';
import { useOffline } from '../contexts/Offline';
import { installLabel, useAppUpdate } from '../lib/appUpdateState';
import { checkForAppUpdateInteractive, installAppUpdate } from '../lib/appUpdater';
import { useT } from '../lib/i18n';
import { AppChangelog } from './settings/AppChangelog';

interface Props {
  open: boolean;
  version: string | null;
  onClose: () => void;
}

/**
 * Modal opened from the status-bar version label: changelog, manual update
 * check, and Install when an update is waiting.
 */
export function VersionInfoModal({ open, version, onClose }: Props) {
  const { t } = useT();
  const { isOffline } = useOffline();
  const [updateBusy, setUpdateBusy] = useState(false);
  const appUpdate = useAppUpdate();
  const available = appUpdate.available;
  const busy = updateBusy || appUpdate.checking || appUpdate.install != null;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="app-dialog-overlay version-info-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="app-dialog version-info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="app-dialog-header">
          <div className="app-dialog-header-text">
            <h2 id="version-info-title" className="app-dialog-title">
              {t('statusbar.versionModal.title')}
            </h2>
            <p className="version-info-current">
              {version
                ? t('statusbar.versionModal.current', { version })
                : t('statusbar.versionModal.currentUnknown')}
            </p>
          </div>
          <button
            type="button"
            className="app-dialog-close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="version-info-body">
          {available && (
            <div className="version-info-update" role="status">
              <strong>{t('settings.updates.availableVersion', { version: available.version })}</strong>
              {t('settings.updates.willRestart')}
              {available.notes && <p>{available.notes.slice(0, 800)}</p>}
            </div>
          )}
          <h3 className="version-info-section-title">{t('settings.changelog.section')}</h3>
          <p className="version-info-hint">{t('settings.changelog.hint')}</p>
          <AppChangelog currentVersion={version} initialCount={4} className="version-info-changelog" />
        </div>

        <footer className="app-dialog-footer version-info-footer">
          <button type="button" className="app-dialog-btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            type="button"
            className={`app-dialog-btn${available ? '' : ' app-dialog-btn-primary'}`}
            disabled={busy || isOffline}
            title={isOffline ? t('offline.actionBlocked') : undefined}
            onClick={() => {
              setUpdateBusy(true);
              void checkForAppUpdateInteractive(t).finally(() => setUpdateBusy(false));
            }}
          >
            {updateBusy || appUpdate.checking
              ? t('settings.updates.checking')
              : t('settings.updates.checkNow')}
          </button>
          {available && (
            <button
              type="button"
              className="app-dialog-btn app-dialog-btn-primary"
              disabled={busy || isOffline}
              title={isOffline ? t('offline.actionBlocked') : t('settings.updates.willRestart')}
              onClick={() => {
                setUpdateBusy(true);
                void installAppUpdate(t).finally(() => setUpdateBusy(false));
              }}
            >
              {appUpdate.install
                ? installLabel(appUpdate.install, t)
                : t('settings.updates.installVersion', { version: available.version })}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
