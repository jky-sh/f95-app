import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as steamAchievements from '../../lib/steamAchievements';
import { useT } from '../../lib/i18n';
import { MemberSection, MemberStatsRow } from './MemberProfileParts';
import type {
  OverallAchievementStats,
  UnlockedAchievementView,
} from '../../lib/steamAchievements';

/**
 * Seção "Conquistas" do perfil do usuário: estatísticas gerais + últimos
 * desbloqueios, com link para a página completa (/achievements). Some quando
 * nenhum jogo vinculado tem conquistas.
 */
export function ProfileAchievements() {
  const { t } = useT();
  const navigate = useNavigate();
  const [stats, setStats] = useState<OverallAchievementStats | null>(null);
  const [recent, setRecent] = useState<UnlockedAchievementView[]>([]);

  const load = useCallback(async () => {
    const [overall, unlocks] = await Promise.all([
      steamAchievements.getOverallStats(),
      steamAchievements.listRecentUnlocks(6),
    ]);
    setStats(overall);
    setRecent(unlocks);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().catch((err) => console.warn('[profile] achievements failed', err));
    const unsubs: UnlistenFn[] = [];
    void listen(steamAchievements.ACHIEVEMENTS_UPDATED_EVENT, () => {
      if (!cancelled) void load().catch(() => {});
    }).then((fn) => unsubs.push(fn));
    return () => {
      cancelled = true;
      for (const fn of unsubs) fn();
    };
  }, [load]);

  if (!stats || stats.gamesTracked === 0) return null;

  return (
    <MemberSection title={t('profile.ach.section')}>
      <div className="ach-profile-body">
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

        {recent.length > 0 && (
          <ul className="ach-feed">
            {recent.map((u) => (
              <li key={`${u.threadId}:${u.apiName}`} className="ach-feed-row">
                {u.iconUrl ? (
                  <img className="ach-feed-icon" src={u.iconUrl} alt="" loading="lazy" />
                ) : (
                  <div className="ach-feed-icon ach-feed-icon--placeholder">?</div>
                )}
                <div className="ach-feed-text">
                  <span className="ach-feed-name">{u.displayName}</span>
                  <span className="ach-feed-game">{u.gameTitle}</span>
                </div>
                {u.unlockTime && (
                  <span className="ach-feed-when">
                    {new Date(u.unlockTime).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="ach-profile-actions">
          <button
            type="button"
            className="game-detail-tag-add"
            onClick={() => navigate('/achievements')}
          >
            {t('profile.ach.viewAll')}
          </button>
        </div>
      </div>
    </MemberSection>
  );
}
