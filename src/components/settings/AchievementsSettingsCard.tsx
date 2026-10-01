import { useEffect, useState } from 'react';
import * as settings from '../../lib/settings';
import { useT } from '../../lib/i18n';

/**
 * Card "Conquistas (Steam)" na seção Sistema das configurações: toggle de
 * notificação de unlock e Steam Web API key opcional (melhora idioma/flags
 * de conquistas ocultas via GetSchemaForGame; sem key o app usa os endpoints
 * públicos da Steam).
 */
export function AchievementsSettingsCard() {
  const { t } = useT();
  const [notify, setNotify] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [savedTick, setSavedTick] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      settings.getBool(settings.KEY_ACHIEVEMENTS_NOTIFY, true),
      settings.get(settings.KEY_STEAM_API_KEY),
    ]).then(([notifyValue, key]) => {
      if (cancelled) return;
      setNotify(notifyValue);
      setApiKey(key ?? '');
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onToggleNotify(value: boolean) {
    setNotify(value);
    await settings.setBool(settings.KEY_ACHIEVEMENTS_NOTIFY, value);
  }

  async function onSaveKey() {
    await settings.set(settings.KEY_STEAM_API_KEY, apiKey.trim() || null);
    setSavedTick(true);
    window.setTimeout(() => setSavedTick(false), 2000);
  }

  if (!loaded) return null;

  return (
    <div className="settings-card">
      <h3 className="settings-card-title">{t('settings.achievements.section')}</h3>
      <p className="settings-card-hint">{t('settings.achievements.hint')}</p>
      <div className="settings-checklist">
        <label className="settings-check-row">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => void onToggleNotify(e.target.checked)}
          />
          <span>{t('settings.achievements.notify')}</span>
        </label>
      </div>
      <div className="settings-offline-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <input
          type="password"
          className="game-detail-tag-input"
          style={{ flex: 1, minWidth: 220 }}
          placeholder={t('settings.achievements.apiKey')}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSaveKey();
          }}
          autoComplete="off"
        />
        <button type="button" className="settings-btn" onClick={() => void onSaveKey()}>
          {savedTick ? t('settings.achievements.saved') : t('settings.achievements.save')}
        </button>
      </div>
      <p className="settings-card-hint" style={{ marginTop: 8 }}>
        {t('settings.achievements.apiKeyHint')}
      </p>
    </div>
  );
}
