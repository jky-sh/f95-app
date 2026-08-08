import { useEffect, useMemo, useState } from 'react';
import { useOffline } from '../contexts/Offline';
import { checkForAppUpdateInteractive } from '../lib/appUpdater';
import { getChangelogEntries } from '../lib/changelog';
import { useT } from '../lib/i18n';

interface Props {
  open: boolean;
  version: string | null;
  onClose: () => void;
}

/**
 * Modal opened from the status-bar version label: changelog + manual update check.
 */
export function VersionInfoModal({ open, version, onClose }: Props) {
  const { t } = useT();
  const { isOffline } = useOffline();
  const [updateBusy, setUpdateBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const entries = useMemo(() => getChangelogEntries(), []);

  useEffect(() => {
    if (!open) return;
    setExpanded(false);
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

  const visible = expanded ? entries : entries.slice(0, 4);

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
          <h3 className="version-info-section-title">{t('settings.changelog.section')}</h3>
          <p className="version-info-hint">{t('settings.changelog.hint')}</p>
          <div className="settings-changelog version-info-changelog">
            {visible.map((entry) => (
              <article
                key={`${entry.version}-${entry.date ?? 'na'}`}
                className="settings-changelog-entry"
              >
                <header className="settings-changelog-head">
                  <h4 className="settings-changelog-version">
                    {entry.version === 'Unreleased'
                      ? t('settings.changelog.unreleased')
                      : `v${entry.version.replace(/^v/i, '')}`}
                  </h4>
                  {entry.date && (
                    <time className="settings-changelog-date" dateTime={entry.date}>
                      {entry.date}
                    </time>
                  )}
                </header>
                {entry.sections.map((section) => (
                  <div key={section.title} className="settings-changelog-section">
                    <h5 className="settings-changelog-section-title">{section.title}</h5>
                    <ul className="settings-changelog-list">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </article>
            ))}
          </div>
          {entries.length > 4 && (
            <button
              type="button"
              className="settings-toolbar-btn settings-toolbar-btn-ghost version-info-more"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? t('settings.changelog.showLess')
                : t('settings.changelog.showMore')}
            </button>
          )}
        </div>

        <footer className="app-dialog-footer version-info-footer">
          <button type="button" className="app-dialog-btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            type="button"
            className="app-dialog-btn app-dialog-btn-primary"
            disabled={updateBusy || isOffline}
            title={isOffline ? t('offline.actionBlocked') : undefined}
            onClick={() => {
              setUpdateBusy(true);
              void checkForAppUpdateInteractive(t).finally(() => setUpdateBusy(false));
            }}
          >
            {updateBusy
              ? t('settings.updates.checking')
              : t('settings.updates.checkNow')}
          </button>
        </footer>
      </div>
    </div>
  );
}
