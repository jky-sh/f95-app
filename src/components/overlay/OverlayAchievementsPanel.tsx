import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useT } from '../../lib/i18n';
import * as library from '../../lib/library';
import * as steamAchievements from '../../lib/steamAchievements';
import type { SteamAchievement } from '../../types/achievements';

interface Props {
  threadId: string;
  enabled: boolean;
}

export function OverlayAchievementsPanel({ threadId, enabled }: Props) {
  const { t } = useT();
  const [appId, setAppId] = useState<string | null>(null);
  const [list, setList] = useState<SteamAchievement[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function load() {
      const game = await library.get(threadId);
      if (cancelled) return;
      const id = game?.steamAppid ?? null;
      setAppId(id);
      if (id) {
        const items = await steamAchievements.listForGame(threadId, id);
        if (!cancelled) setList(items);
      } else {
        setList([]);
      }
      if (!cancelled) setLoaded(true);
    }
    void load().catch(() => {
      if (!cancelled) setLoaded(true);
    });

    // Atualiza ao vivo quando o watcher registra novos unlocks.
    const unsubs: UnlistenFn[] = [];
    void listen<{ threadId: string }>(
      steamAchievements.ACHIEVEMENTS_UPDATED_EVENT,
      (e) => {
        if (!cancelled && e.payload.threadId === threadId) void load();
      },
    ).then((fn) => unsubs.push(fn));

    return () => {
      cancelled = true;
      for (const fn of unsubs) fn();
    };
  }, [threadId, enabled]);

  if (!enabled) {
    return (
      <div className="game-overlay-panel--disabled">{t('overlay.achievements.disabled')}</div>
    );
  }

  const unlocked = list.filter((a) => a.unlocked).length;

  return (
    <div className="game-overlay-panel-fill game-overlay-panel-fill--scroll">
      {list.length > 0 && (
        <p className="game-overlay-stats">
          {t('overlay.achievements.stats', {
            unlocked: String(unlocked),
            total: String(list.length),
          })}
        </p>
      )}
      {!loaded ? null : list.length === 0 ? (
        <p className="game-overlay-empty">
          {appId ? t('ach.empty') : t('overlay.achievements.empty')}
        </p>
      ) : (
        <div className="game-overlay-achievements-grid">
          {list.map((a) => {
            const masked = a.hidden && !a.unlocked;
            const icon = a.unlocked ? a.iconUrl : a.iconGrayUrl || a.iconUrl;
            return (
              <div
                key={a.apiName}
                className={`game-overlay-achievement-card${a.unlocked ? ' game-overlay-achievement-card--unlocked' : ''}`}
              >
                <div className="game-overlay-achievement-row">
                  {icon && (
                    <img
                      className={`game-overlay-achievement-icon${!a.unlocked && !a.iconGrayUrl ? ' game-overlay-achievement-icon--locked' : ''}`}
                      src={icon}
                      alt=""
                      loading="lazy"
                    />
                  )}
                  <div>
                    <p className="game-overlay-achievement-title">
                      {masked ? t('ach.hidden.title') : a.displayName}
                    </p>
                    <p className="game-overlay-achievement-desc">
                      {masked ? t('ach.hidden.desc') : a.description || ''}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
