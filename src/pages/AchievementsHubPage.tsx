import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as steamAchievements from '../lib/steamAchievements';
import { useT } from '../lib/i18n';
import {
  MemberSection,
  MemberStatsRow,
} from '../components/profile/MemberProfileParts';
import type {
  GameAchievementProgress,
  OverallAchievementStats,
  UnlockedAchievementView,
} from '../lib/steamAchievements';

/**
 * Página de conquistas do usuário (/achievements): visão geral entre todos
 * os jogos — estatísticas, progresso por jogo e desbloqueios recentes.
 * Atualiza ao vivo conforme o watcher registra novos unlocks.
 */
export function AchievementsHubPage() {
  const { t } = useT();
  const [stats, setStats] = useState<OverallAchievementStats | null>(null);
  const [progress, setProgress] = useState<GameAchievementProgress[]>([]);
  const [recent, setRecent] = useState<UnlockedAchievementView[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [overall, perGame, unlocks] = await Promise.all([
      steamAchievements.getOverallStats(),
      steamAchievements.listGameProgress(),
      steamAchievements.listRecentUnlocks(20),
    ]);
    setStats(overall);
    setProgress(perGame);
    setRecent(unlocks);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().catch((err) => {
      console.warn('[achievements-hub] load failed', err);
      if (!cancelled) setLoaded(true);
    });
    const unsubs: UnlistenFn[] = [];
    void listen(steamAchievements.ACHIEVEMENTS_UPDATED_EVENT, () => {
      if (!cancelled) void load().catch(() => {});
    }).then((fn) => unsubs.push(fn));
    return () => {
      cancelled = true;
      for (const fn of unsubs) fn();
    };
  }, [load]);

  const overallPct =
    stats && stats.totalAvailable > 0
      ? Math.round((stats.totalUnlocked / stats.totalAvailable) * 100)
      : 0;

  return (
    <div className="ach-hub-page">
      <header className="ach-hub-header">
        <h1 className="ach-hub-title">{t('achhub.title')}</h1>
        {stats && stats.totalAvailable > 0 && (
          <div className="ach-hub-overall">
            <div className="game-ach-bar" role="progressbar" aria-valuenow={overallPct}>
              <div className="game-ach-bar-fill" style={{ width: `${overallPct}%` }} />
            </div>
            <span className="ach-hub-overall-label">
              {t('achhub.completion', { pct: String(overallPct) })}
            </span>
          </div>
        )}
      </header>

      {!loaded ? (
        <p className="game-detail-empty-hint">{t('ach.loading')}</p>
      ) : !stats || stats.gamesTracked === 0 ? (
        <p className="game-detail-empty-hint">{t('achhub.empty')}</p>
      ) : (
        <>
          <MemberStatsRow
            stats={[
              {
                label: t('achhub.stat.unlocked'),
                value: `${stats.totalUnlocked} / ${stats.totalAvailable}`,
              },
              { label: t('achhub.stat.games'), value: stats.gamesTracked },
              { label: t('achhub.stat.perfect'), value: stats.perfectGames },
              {
                label: t('achhub.stat.rarest'),
                value: stats.rarest
                  ? `${stats.rarest.displayName} (${(stats.rarest.globalPercent ?? 0).toFixed(1)}%)`
                  : '—',
              },
            ]}
          />

          <MemberSection title={t('achhub.section.progress')}>
            <ul className="ach-hub-games">
              {progress.map((p) => {
                const pct = p.total > 0 ? Math.round((p.unlocked / p.total) * 100) : 0;
                return (
                  <li key={p.threadId}>
                    <Link to={`/library/game/${p.threadId}`} className="ach-hub-game-row">
                      {p.thumbnailUrl ? (
                        <img
                          className="ach-hub-game-thumb"
                          src={p.thumbnailUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <div className="ach-hub-game-thumb ach-hub-game-thumb--empty" />
                      )}
                      <div className="ach-hub-game-main">
                        <span className="ach-hub-game-title">{p.title}</span>
                        <div className="game-ach-bar" role="progressbar" aria-valuenow={pct}>
                          <div
                            className="game-ach-bar-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="ach-hub-game-meta">
                        <span className="ach-hub-game-count">
                          {p.unlocked} / {p.total}
                        </span>
                        {p.total > 0 && p.unlocked === p.total && (
                          <span className="ach-hub-perfect" title={t('achhub.stat.perfect')}>
                            100%
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </MemberSection>

          {recent.length > 0 && (
            <MemberSection title={t('achhub.section.recent')}>
              <ul className="ach-feed ach-feed--page">
                {recent.map((u) => (
                  <li key={`${u.threadId}:${u.apiName}`} className="ach-feed-row">
                    {u.iconUrl ? (
                      <img
                        className="ach-feed-icon"
                        src={u.iconUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="ach-feed-icon ach-feed-icon--placeholder">?</div>
                    )}
                    <div className="ach-feed-text">
                      <span className="ach-feed-name">{u.displayName}</span>
                      <span className="ach-feed-desc">{u.description || u.gameTitle}</span>
                    </div>
                    <div className="ach-feed-meta">
                      <Link to={`/library/game/${u.threadId}`} className="ach-feed-game-link">
                        {u.gameTitle}
                      </Link>
                      <span className="ach-feed-when">
                        {u.unlockTime
                          ? new Date(u.unlockTime).toLocaleString()
                          : new Date(u.syncedAt + 'Z').toLocaleString()}
                      </span>
                      {u.globalPercent != null && (
                        <span
                          className={`game-ach-rarity${u.globalPercent < 10 ? ' game-ach-rarity--rare' : ''}`}
                        >
                          {u.globalPercent.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </MemberSection>
          )}
        </>
      )}
    </div>
  );
}
