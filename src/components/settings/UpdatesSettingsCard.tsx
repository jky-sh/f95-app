import { useEffect, useState } from 'react';
import { useT } from '../../lib/i18n';
import {
  getAppRuntimeSettings,
  subscribeAppRuntimeSettings,
} from '../../lib/appRuntimeSettings';
import {
  GAME_UPDATE_INTERVALS,
  saveUpdatePrefs,
  useUpdatePrefs,
} from '../../lib/updateSettings';
import { UpdateCheckControl } from '../library/UpdateCheckControl';

/**
 * Settings → System: background checks for game updates and how new ones
 * are announced (the bell, system notifications).
 */
export function UpdatesSettingsCard() {
  const { t } = useT();
  const prefs = useUpdatePrefs();
  const [trayOn, setTrayOn] = useState(() => getAppRuntimeSettings().trayIconEnabled);

  useEffect(() => subscribeAppRuntimeSettings((s) => setTrayOn(s.trayIconEnabled)), []);

  return (
    <div id="settings-game-updates" className="settings-card">
      <h3 className="settings-card-title">{t('settings.gameUpdates.section')}</h3>
      <p className="settings-card-hint">{t('settings.gameUpdates.hint')}</p>
      <div className="settings-checklist">
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={prefs.gamesAuto}
            onChange={(e) => void saveUpdatePrefs({ gamesAuto: e.target.checked })}
          />
          <span>{t('settings.gameUpdates.auto')}</span>
        </label>
      </div>
      <div className="settings-offline-actions">
        <label className="settings-field-row">
          <span className="settings-field-label">{t('settings.gameUpdates.interval')}</span>
          <select
            className="ui-select"
            value={prefs.gamesIntervalMin}
            disabled={!prefs.gamesAuto}
            onChange={(e) => void saveUpdatePrefs({ gamesIntervalMin: Number(e.target.value) })}
          >
            {GAME_UPDATE_INTERVALS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {t(`settings.gameUpdates.interval.${minutes / 60}h`)}
              </option>
            ))}
          </select>
        </label>
        <UpdateCheckControl buttonClassName="settings-btn" />
      </div>
      <div className="settings-checklist" style={{ marginTop: 12 }}>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={prefs.gamesNotify}
            onChange={(e) => void saveUpdatePrefs({ gamesNotify: e.target.checked })}
          />
          <span>{t('settings.gameUpdates.notify')}</span>
        </label>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={prefs.osToast}
            onChange={(e) => void saveUpdatePrefs({ osToast: e.target.checked })}
          />
          <span>{t('settings.gameUpdates.osToast')}</span>
        </label>
      </div>
      <p
        className="settings-card-hint"
        style={{ marginTop: 8, color: trayOn ? undefined : 'var(--status-warning)' }}
      >
        {t('settings.gameUpdates.needsTray')}
      </p>
    </div>
  );
}
