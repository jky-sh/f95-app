import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { dialog } from '../../lib/dialog';
import * as ipc from '../../lib/ipc';
import * as library from '../../lib/library';
import * as steamAchievements from '../../lib/steamAchievements';
import { useT } from '../../lib/i18n';
import { GameDetailSection } from './GameDetailLayout';
import type { GameDetail } from '../../types/game';
import type { LibraryGame } from '../../types/library';
import type { SteamAchievement } from '../../types/achievements';

interface Props {
  game: LibraryGame;
  storeDetail: GameDetail | null;
  /** Chamado após vincular/desvincular para a página recarregar o jogo. */
  onChanged: () => void;
}

/**
 * Seção "Conquistas" da página do jogo na biblioteca.
 *
 * Sem appid vinculado: UI de vínculo (detecção automática pela pasta do
 * jogo/links do thread, busca por nome na Steam ou appid manual). Com
 * vínculo: lista estilo Steam (ícone, raridade global, data de unlock) que
 * se atualiza ao vivo via `achievements:updated`.
 */
export function GameAchievementsSection({ game, storeDetail, onChanged }: Props) {
  const { t, locale } = useT();
  const linked = !!game.steamAppid;

  /* ── estado do modo vinculado ── */
  const [list, setList] = useState<SteamAchievement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* ── estado do modo de vínculo ── */
  const [draft, setDraft] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [results, setResults] = useState<ipc.SteamSearchResult[] | null>(null);
  const [autoDetecting, setAutoDetecting] = useState(
    !linked && game.steamAppid === null,
  );
  // Autodetecção roda no máximo 2× por mount: uma imediata (pasta do jogo)
  // e uma quando os metadados do thread chegam (link Steam no post).
  const autoRanRef = useRef({ withoutDetail: false, withDetail: false });

  const reload = useCallback(async () => {
    if (!game.steamAppid) return;
    setLoadError(null);
    // Cache primeiro: renderiza imediatamente o que houver no SQLite; a rede
    // nunca segura a página.
    const cached = await steamAchievements
      .listForGame(game.threadId, game.steamAppid)
      .catch(() => [] as SteamAchievement[]);
    if (cached.length > 0) setList(cached);
    // Refresh (TTL/idioma) em background; re-renderiza só quando terminar.
    try {
      await steamAchievements.ensureSchema(game.steamAppid, locale);
      const fresh = await steamAchievements.listForGame(
        game.threadId,
        game.steamAppid,
      );
      setList(fresh);
    } catch (err) {
      if (cached.length === 0) {
        setLoadError(formatError(err));
        setList([]);
      } else {
        console.warn('[achievements] refresh falhou, exibindo cache', err);
      }
    }
  }, [game.threadId, game.steamAppid, locale]);

  useEffect(() => {
    if (!linked) {
      setList(null);
      return;
    }
    let cancelled = false;
    void reload();
    // Um scan imediato pega unlocks feitos com o app fechado.
    void ipc.achievementsScanNow().catch(() => {});
    const unsubs: UnlistenFn[] = [];
    void listen<{ threadId: string }>(
      steamAchievements.ACHIEVEMENTS_UPDATED_EVENT,
      (e) => {
        if (!cancelled && e.payload.threadId === game.threadId) void reload();
      },
    ).then((fn) => unsubs.push(fn));
    return () => {
      cancelled = true;
      for (const fn of unsubs) fn();
    };
  }, [linked, game.threadId, reload]);

  /* Autodetecção silenciosa: só quando o jogo NUNCA foi vinculado
   * (steamAppid === null; '' significa que o usuário desvinculou). */
  useEffect(() => {
    if (linked || game.steamAppid !== null) {
      setAutoDetecting(false);
      return;
    }
    const ran = autoRanRef.current;
    if (storeDetail ? ran.withDetail : ran.withoutDetail) return;
    if (storeDetail) {
      ran.withDetail = true;
      ran.withoutDetail = true;
    } else {
      ran.withoutDetail = true;
    }

    let cancelled = false;
    setAutoDetecting(true);
    void (async () => {
      try {
        const det = await steamAchievements.autoDetectAppid({
          title: game.title,
          installPath: game.installPath,
          exePath: game.exePath,
          storeDetail,
        });
        if (cancelled || !det) return;
        // Match por nome é a fonte mais fraca: só auto-vincula se o jogo
        // encontrado realmente tem conquistas.
        if (det.source === 'name') {
          await steamAchievements.ensureSchema(det.appId, locale);
          const stats = await steamAchievements.getStats(game.threadId, det.appId);
          if (cancelled || stats.total === 0) return;
        }
        if (!cancelled) await applyLink(det.appId);
      } catch {
        /* silêncio — cai para a UI manual */
      } finally {
        if (!cancelled) setAutoDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, game.steamAppid, game.threadId, storeDetail]);

  async function applyLink(appId: string) {
    setLinkBusy(true);
    setLinkError(null);
    try {
      await steamAchievements.ensureSchema(appId, locale);
      await library.setSteamAppid(game.threadId, appId);
      await steamAchievements.syncWatcher();
      setResults(null);
      setDraft('');
      onChanged();
    } catch (err) {
      setLinkError(formatError(err));
    } finally {
      setLinkBusy(false);
    }
  }

  async function onLinkManual() {
    const appId = steamAchievements.parseAppidInput(draft);
    if (!appId) {
      setLinkError(t('ach.link.invalid'));
      return;
    }
    await applyLink(appId);
  }

  async function onDetect() {
    setLinkBusy(true);
    setLinkError(null);
    try {
      const det = await steamAchievements.autoDetectAppid({
        title: game.title,
        installPath: game.installPath,
        exePath: game.exePath,
        storeDetail,
      });
      if (det) {
        await applyLink(det.appId);
      } else {
        setLinkError(t('ach.link.notFound'));
      }
    } catch (err) {
      setLinkError(formatError(err));
    } finally {
      setLinkBusy(false);
    }
  }

  async function onSearch() {
    setLinkBusy(true);
    setLinkError(null);
    try {
      const term =
        draft.trim() || game.title.replace(/\[[^\]]*\]/g, '').trim();
      const found = await ipc.steamSearchGames(term);
      setResults(found);
      if (found.length === 0) setLinkError(t('ach.link.noResults'));
    } catch (err) {
      setLinkError(formatError(err));
    } finally {
      setLinkBusy(false);
    }
  }

  async function onUnlink() {
    const ok = await dialog.confirm(t('ach.unlink.confirm'), {
      title: t('ach.unlink'),
      kind: 'warning',
    });
    if (!ok) return;
    await steamAchievements.unlink(game.threadId);
    onChanged();
  }

  async function onToggleSaveScan(enabled: boolean) {
    await library.setAchSaveScan(game.threadId, enabled);
    await steamAchievements.syncWatcher();
    await ipc.achievementsScanNow().catch(() => {});
    onChanged();
  }

  async function onResync() {
    if (!game.steamAppid) return;
    setBusy(true);
    try {
      await steamAchievements.ensureSchema(game.steamAppid, locale, { force: true });
      await ipc.achievementsScanNow().catch(() => {});
      await reload();
    } catch (err) {
      setLoadError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!linked) {
    if (autoDetecting) {
      return (
        <GameDetailSection title={t('ach.section.title')}>
          <p className="game-detail-empty-hint">{t('ach.autoDetecting')}</p>
        </GameDetailSection>
      );
    }
    return (
      <GameDetailSection title={t('ach.section.title')}>
        <div className="game-ach-link">
          <p className="game-detail-empty-hint">{t('ach.link.hint')}</p>
          <div className="game-ach-link-row">
            <input
              type="text"
              className="game-detail-tag-input"
              placeholder={t('ach.link.placeholder')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onLinkManual();
              }}
              disabled={linkBusy}
            />
            <button
              type="button"
              className="game-detail-tag-add"
              onClick={() => void onLinkManual()}
              disabled={linkBusy || !draft.trim()}
            >
              {t('ach.link.link')}
            </button>
            <button
              type="button"
              className="game-detail-tag-add"
              onClick={() => void onDetect()}
              disabled={linkBusy}
              title={t('ach.link.detectTitle')}
            >
              {t('ach.link.detect')}
            </button>
            <button
              type="button"
              className="game-detail-tag-add"
              onClick={() => void onSearch()}
              disabled={linkBusy}
            >
              {t('ach.link.search')}
            </button>
          </div>
          {linkBusy && (
            <p className="game-detail-empty-hint">{t('ach.link.working')}</p>
          )}
          {linkError && <p className="game-ach-error">{linkError}</p>}
          {results && results.length > 0 && (
            <ul className="game-ach-results">
              {results.slice(0, 8).map((r) => (
                <li key={r.appId}>
                  <button
                    type="button"
                    className="game-ach-result-btn"
                    onClick={() => void applyLink(r.appId)}
                    disabled={linkBusy}
                  >
                    <span className="game-ach-result-name">{r.name}</span>
                    <span className="game-ach-result-id">{r.appId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </GameDetailSection>
    );
  }

  const unlocked = list?.filter((a) => a.unlocked).length ?? 0;
  const total = list?.length ?? 0;
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  return (
    <GameDetailSection title={t('ach.section.title')}>
      <div className="game-ach-header">
        <div className="game-ach-progress">
          <span className="game-ach-progress-text">
            {t('ach.progress', {
              unlocked: String(unlocked),
              total: String(total),
            })}
          </span>
          <div className="game-ach-bar" role="progressbar" aria-valuenow={pct}>
            <div className="game-ach-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="game-ach-actions">
          <button
            type="button"
            className="game-detail-tag-add"
            onClick={() => void onResync()}
            disabled={busy}
            title={t('ach.resync.title')}
          >
            {busy ? t('ach.resync.working') : t('ach.resync')}
          </button>
          <button
            type="button"
            className="game-detail-tag-add"
            onClick={() => void onUnlink()}
            title={t('ach.unlink.title', { appid: game.steamAppid ?? '' })}
          >
            {t('ach.unlink')}
          </button>
        </div>
      </div>

      {list === null ? (
        <p className="game-detail-empty-hint">{t('ach.loading')}</p>
      ) : total === 0 ? (
        loadError ? (
          <div className="game-ach-link">
            <p className="game-ach-error">{loadError}</p>
            <div>
              <button
                type="button"
                className="game-detail-tag-add"
                onClick={() => void onResync()}
                disabled={busy}
              >
                {busy ? t('ach.resync.working') : t('ach.retry')}
              </button>
            </div>
          </div>
        ) : (
          <p className="game-detail-empty-hint">{t('ach.empty')}</p>
        )
      ) : (
        <ul className="game-ach-list">
          {list.map((a) => (
            <AchievementRow key={a.apiName} achievement={a} />
          ))}
        </ul>
      )}
      {total > 0 && loadError && <p className="game-ach-error">{loadError}</p>}

      {total > 0 && (
        <div className="game-ach-savescan">
          <label className="game-ach-savescan-row">
            <input
              type="checkbox"
              checked={game.achSaveScan}
              onChange={(e) => void onToggleSaveScan(e.target.checked)}
            />
            <span>{t('ach.savescan.toggle')}</span>
          </label>
          <p className="game-ach-savescan-hint">
            {game.achSaveScan || unlocked > 0
              ? t('ach.savescan.hint')
              : t('ach.savescan.suggest')}
          </p>
        </div>
      )}
    </GameDetailSection>
  );
}

export function AchievementRow({ achievement: a }: { achievement: SteamAchievement }) {
  const { t } = useT();
  const masked = a.hidden && !a.unlocked;
  const icon = a.unlocked ? a.iconUrl : a.iconGrayUrl || a.iconUrl;
  return (
    <li className={`game-ach-row${a.unlocked ? ' game-ach-row--unlocked' : ''}`}>
      {icon ? (
        <img
          className={`game-ach-icon${!a.unlocked && !a.iconGrayUrl ? ' game-ach-icon--locked' : ''}`}
          src={icon}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="game-ach-icon game-ach-icon--placeholder" aria-hidden>
          ?
        </div>
      )}
      <div className="game-ach-text">
        <span className="game-ach-name">
          {masked ? t('ach.hidden.title') : a.displayName}
        </span>
        <span className="game-ach-desc">
          {masked ? t('ach.hidden.desc') : a.description || '—'}
        </span>
      </div>
      <div className="game-ach-meta">
        {a.unlocked && a.unlockTime ? (
          <span className="game-ach-when">
            {t('ach.unlockedAt', {
              when: new Date(a.unlockTime).toLocaleDateString(),
            })}
          </span>
        ) : a.unlocked ? (
          <span className="game-ach-when">{t('ach.unlockedNoDate')}</span>
        ) : null}
        {a.globalPercent != null && (
          <span
            className={`game-ach-rarity${a.globalPercent < 10 ? ' game-ach-rarity--rare' : ''}`}
            title={t('ach.globalPercent.title')}
          >
            {a.globalPercent.toFixed(1)}%
          </span>
        )}
      </div>
    </li>
  );
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}
