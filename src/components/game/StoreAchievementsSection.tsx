import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as library from '../../lib/library';
import * as steamAchievements from '../../lib/steamAchievements';
import { useT } from '../../lib/i18n';
import { GameDetailSection } from './GameDetailLayout';
import { AchievementRow } from './GameAchievementsSection';
import type { GameDetail } from '../../types/game';
import type { SteamAchievement } from '../../types/achievements';

/**
 * Seção "Conquistas" da página do jogo NA LOJA.
 *
 * Resolve o jogo na Steam sozinha: usa o vínculo da biblioteca quando
 * existe; senão autodetecta (pasta do jogo → link Steam no thread → busca
 * por nome) e, se o jogo já estiver na biblioteca, persiste o vínculo. Sem
 * match, a seção simplesmente não aparece.
 */
export function StoreAchievementsSection({ detail }: { detail: GameDetail }) {
  const { t, locale } = useT();
  const [list, setList] = useState<SteamAchievement[] | null>(null);
  const [resolvedAppId, setResolvedAppId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const libGame = await library.get(detail.threadId).catch(() => null);
      // '' = o usuário desvinculou de propósito; respeita e não mostra nada.
      if (libGame?.steamAppid === '') return;

      let appId = libGame?.steamAppid ?? null;
      let detection: steamAchievements.AppidDetection | null = null;
      if (!appId) {
        detection = await steamAchievements.autoDetectAppid({
          title: detail.title,
          installPath: libGame?.installPath,
          exePath: libGame?.exePath,
          storeDetail: detail,
        });
        appId = detection?.appId ?? null;
      }
      if (!appId || cancelled) return;

      // Cache primeiro (render imediato); refresh da Steam em background.
      const cached = await steamAchievements
        .listForGame(detail.threadId, appId)
        .catch(() => []);
      if (!cancelled && cached.length > 0) {
        setResolvedAppId(appId);
        setList(cached);
      }
      await steamAchievements.ensureSchema(appId, locale).catch(() => {});
      const items = await steamAchievements.listForGame(detail.threadId, appId);
      if (cancelled) return;

      // Persiste o vínculo autodetectado quando o jogo já está na biblioteca
      // (match por nome só com evidência: o jogo encontrado tem conquistas).
      if (
        detection &&
        libGame &&
        (detection.source !== 'name' || items.length > 0)
      ) {
        await library.setSteamAppid(detail.threadId, appId);
        await steamAchievements.syncWatcher().catch(() => {});
      }

      setResolvedAppId(appId);
      setList(items);
    }

    void resolve().catch(() => {});

    const unsubs: UnlistenFn[] = [];
    void listen<{ threadId: string }>(
      steamAchievements.ACHIEVEMENTS_UPDATED_EVENT,
      (e) => {
        if (!cancelled && e.payload.threadId === detail.threadId) void resolve();
      },
    ).then((fn) => unsubs.push(fn));

    return () => {
      cancelled = true;
      for (const fn of unsubs) fn();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.threadId, locale]);

  if (!resolvedAppId || !list || list.length === 0) return null;

  const unlocked = list.filter((a) => a.unlocked).length;
  const pct = Math.round((unlocked / list.length) * 100);

  return (
    <GameDetailSection title={t('ach.section.title')}>
      <div className="game-ach-header">
        <div className="game-ach-progress">
          <span className="game-ach-progress-text">
            {t('ach.progress', {
              unlocked: String(unlocked),
              total: String(list.length),
            })}
          </span>
          <div className="game-ach-bar" role="progressbar" aria-valuenow={pct}>
            <div className="game-ach-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <ul className="game-ach-list">
        {list.map((a) => (
          <AchievementRow key={a.apiName} achievement={a} />
        ))}
      </ul>
    </GameDetailSection>
  );
}
