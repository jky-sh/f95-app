import { useEffect, useRef } from 'react';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as ipc from '../lib/ipc';
import * as library from '../lib/library';
import * as notifications from '../lib/notifications';
import * as settings from '../lib/settings';
import * as steamAchievements from '../lib/steamAchievements';
import { useNotifications } from '../contexts/Notifications';
import { tStandalone, useT } from '../lib/i18n';
import type { AchievementSyncPayload } from '../types/achievements';

/**
 * Ponte invisível entre o watcher de achievements (Rust) e o app.
 *
 * No boot: configura o watcher com os jogos vinculados e aquece o cache de
 * schema. Depois, a cada `achievement:sync`: persiste os unlocks no SQLite,
 * mostra o toast estilo Hydra sobre o jogo (ou cai para o sininho quando o
 * jogo não está visível) e avisa todas as janelas via
 * `achievements:updated` para a UI recarregar.
 */
export function AchievementsBridge() {
  const { locale } = useT();
  const { refresh: refreshNotifications } = useNotifications();
  const refreshRef = useRef(refreshNotifications);
  refreshRef.current = refreshNotifications;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  // Serializa o processamento dos syncs para não duplicar toasts quando dois
  // eventos chegam colados (scan inicial + tick).
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;

    // Boot: registra o conjunto observado e aquece o cache de schema.
    void (async () => {
      try {
        await steamAchievements.syncWatcher();
      } catch (err) {
        console.warn('[achievements] configuração do watcher falhou', err);
      }
      try {
        const games = await library.listWithSteamAppid();
        for (const game of games) {
          if (cancelled) return;
          await steamAchievements
            .ensureSchema(game.steamAppid!, localeRef.current)
            .catch((err) =>
              console.warn(
                `[achievements] schema de ${game.steamAppid} indisponível`,
                err,
              ),
            );
        }
      } catch (err) {
        console.warn('[achievements] aquecimento de schema falhou', err);
      }
    })();

    const unsubs: UnlistenFn[] = [];
    void listen<AchievementSyncPayload>('achievement:sync', (e) => {
      if (cancelled) return;
      const payload = e.payload;
      queueRef.current = queueRef.current
        .then(() => handleSync(payload))
        .catch((err) => console.warn('[achievements] sync falhou', err));
    }).then((fn) => unsubs.push(fn));

    async function handleSync(payload: AchievementSyncPayload) {
      const fresh = await steamAchievements.recordUnlocks(
        payload.threadId,
        payload.achievements,
      );
      if (fresh.length === 0) return;

      await emit(steamAchievements.ACHIEVEMENTS_UPDATED_EVENT, {
        threadId: payload.threadId,
      });

      // Baseline (primeira passada) sincroniza em silêncio: pode conter
      // conquistas antigas desbloqueadas antes do vínculo.
      if (payload.initial) return;

      const notify = await settings.getBool(settings.KEY_ACHIEVEMENTS_NOTIFY, true);
      if (!notify) return;

      const game = await library.get(payload.threadId);
      if (!game) return;

      const all = await steamAchievements.listForGame(
        payload.threadId,
        payload.appId,
      );
      const byName = new Map(all.map((a) => [a.apiName.toUpperCase(), a] as const));
      const freshDefs = fresh.map((apiName) => {
        const def = byName.get(apiName.toUpperCase());
        return {
          apiName,
          title: def?.displayName ?? apiName,
          description: def?.description ?? null,
          iconUrl: def?.iconUrl || null,
        };
      });
      const stats = {
        unlocked: all.filter((a) => a.unlocked).length,
        total: all.length,
      };

      // Toast estilo Hydra sobre a janela do jogo (máx. 5 em sequência).
      let toasted = false;
      try {
        toasted = await ipc.achievementToast({
          threadId: payload.threadId,
          items: freshDefs.slice(0, 5).map((d) => ({
            title: d.title,
            description: d.description,
            iconUrl: d.iconUrl,
          })),
          unlockedCount: stats.unlocked,
          totalCount: stats.total,
        });
      } catch (err) {
        console.warn('[achievements] toast falhou', err);
      }

      // Sempre registra no sininho (histórico), toast ou não.
      for (const def of freshDefs) {
        await notifications.upsert({
          id: `ach:${payload.threadId}:${def.apiName}`,
          source: 'achievement',
          threadId: payload.threadId,
          title: tStandalone('ach.notification.title', { game: game.title }),
          body: def.title,
          url: `/library/game/${payload.threadId}`,
          thumbnailUrl: def.iconUrl,
        });
      }
      await refreshRef.current().catch(() => {});
      if (!toasted) {
        console.info(
          `[achievements] ${fresh.length} conquista(s) registradas no sininho (jogo sem janela visível)`,
        );
      }
    }

    return () => {
      cancelled = true;
      for (const fn of unsubs) fn();
    };
  }, []);

  return null;
}
