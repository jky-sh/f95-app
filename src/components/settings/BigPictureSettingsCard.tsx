import { useT } from '../../lib/i18n';
import {
  openBigPictureFrom,
  saveBigPicturePrefs,
  useBigPicturePrefs,
} from '../../lib/bigPicture';
import { Icon } from '../ui/Icon';
import { ControllerShortcutNotes } from '../bigpicture/BpControllerShortcuts';

/** Settings → Appearance: open Big Picture and choose how it starts. */
export function BigPictureSettingsCard() {
  const { t } = useT();
  const prefs = useBigPicturePrefs();
  return (
    <div className="settings-card">
      <h3 className="settings-card-title">{t('bp.open')}</h3>
      <p className="settings-card-hint">{t('settings.bigPicture.hint')}</p>
      <div className="settings-checklist">
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={prefs.intro}
            onChange={(e) => void saveBigPicturePrefs({ intro: e.target.checked })}
          />
          <span>{t('bp.settings.intro')}</span>
        </label>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={prefs.sounds}
            onChange={(e) => void saveBigPicturePrefs({ sounds: e.target.checked })}
          />
          <span>{t('bp.settings.sounds')}</span>
        </label>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={prefs.fullscreen}
            onChange={(e) => void saveBigPicturePrefs({ fullscreen: e.target.checked })}
          />
          <span>{t('bp.settings.fullscreen.hint')}</span>
        </label>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={prefs.onStartup}
            onChange={(e) => void saveBigPicturePrefs({ onStartup: e.target.checked })}
          />
          <span>{t('bp.settings.startup.hint')}</span>
        </label>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={prefs.controllerGuide}
            onChange={(e) => void saveBigPicturePrefs({ controllerGuide: e.target.checked })}
          />
          <span>{t('bp.settings.controllerGuide.hint')}</span>
        </label>
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={prefs.controllerChord}
            onChange={(e) => void saveBigPicturePrefs({ controllerChord: e.target.checked })}
          />
          <span>{t('bp.settings.controllerChord.hint')}</span>
        </label>
      </div>
      <ControllerShortcutNotes className="settings-card-hint" style={{ margin: '12px 0 0' }} />
      <div className="settings-bigpicture-actions">
        <button
          type="button"
          className="ui-btn ui-btn--primary"
          onClick={(e) => openBigPictureFrom(e.currentTarget)}
        >
          <Icon name="bigPicture" size={16} />
          {t('settings.bigPicture.open')}
        </button>
      </div>
    </div>
  );
}
