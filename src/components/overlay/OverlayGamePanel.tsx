import { useCallback, useEffect, useState } from 'react';
import { announceUserStop } from '../../lib/gameStops';
import { useT } from '../../lib/i18n';
import * as ipc from '../../lib/ipc';
import * as library from '../../lib/library';
import * as sessions from '../../lib/sessions';
import * as steamAchievements from '../../lib/steamAchievements';
import { formatPlaytime, statusKey, type LibraryGame } from '../../types/library';
import { Icon } from '../ui/Icon';

/** How often the panel re-reads the session from the backend (the clock ticks every second). */
const REFRESH_MS = 15_000;

interface Props {
  threadId: string;
  /** Opens a link in the overlay's browser. */
  onOpenLink: (url: string) => void;
  onShowAchievements: () => void;
}

interface Snapshot {
  game: LibraryGame | null;
  sessions: number;
  /** Seconds the current session had run when this snapshot was taken; null when not running. */
  elapsed: number | null;
  takenAt: number;
  achievements: { unlocked: number; total: number } | null;
}

/**
 * The running game at a glance: this session's clock, total time played,
 * sessions and achievements, plus the actions you want mid-game (open its
 * folder or its F95 thread, stop it).
 */
export function OverlayGamePanel({ threadId, onOpenLink, onShowAchievements }: Props) {
  const { t } = useT();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);

  const load = useCallback(async () => {
    const [game, count, running] = await Promise.all([
      library.get(threadId),
      sessions.count(threadId).catch(() => 0),
      ipc.runningGames().catch(() => []),
    ]);
    let achievements: Snapshot['achievements'] = null;
    if (game?.steamAppid) {
      const list = await steamAchievements.listForGame(threadId, game.steamAppid).catch(() => []);
      if (list.length > 0) achievements = { unlocked: list.filter((a) => a.unlocked).length, total: list.length };
    }
    const run = running.find((r) => r.threadId === threadId);
    setSnap({ game, sessions: count, elapsed: run ? run.elapsedSeconds : null, takenAt: Date.now(), achievements });
  }, [threadId]);

  useEffect(() => {
    setSnap(null);
    setConfirmStop(false);
    void load();
    const refresh = window.setInterval(() => void load(), REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, [load]);

  // The confirmation expires, so a stray click later doesn't stop the game.
  useEffect(() => {
    if (!confirmStop) return;
    const timer = window.setTimeout(() => setConfirmStop(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmStop]);

  if (!snap) return <div className="game-overlay-panel-fill" aria-busy="true" />;
  const g = snap.game;
  if (!g) {
    return (
      <div className="game-overlay-panel-fill game-overlay-panel--disabled">{t('overlay.game.notInLibrary')}</div>
    );
  }

  const session = snap.elapsed != null ? snap.elapsed + Math.max(0, (now - snap.takenAt) / 1000) : null;
  const total = g.totalPlaytimeSeconds + (session ?? 0);
  const hasUpdate = g.installStatus === 'update_available' && !!g.availableVersion;

  async function stop() {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setStopping(true);
    try {
      await announceUserStop(threadId);
      await ipc.stopGame(threadId);
    } catch (err) {
      console.warn('[overlay] stop failed', err);
    } finally {
      setStopping(false);
      setConfirmStop(false);
    }
  }

  return (
    <div className="game-overlay-panel-fill game-overlay-panel-fill--scroll game-overlay-game">
      <div className="game-overlay-game-hero">
        {g.thumbnailUrl ? (
          <img className="game-overlay-game-art" src={g.thumbnailUrl} alt="" />
        ) : (
          <div className="game-overlay-game-art game-overlay-game-art--empty">{g.title.charAt(0)}</div>
        )}
        <div className="game-overlay-game-title-block">
          <p className="game-overlay-game-title" title={g.title}>
            {g.title}
          </p>
          <p className="game-overlay-game-sub">
            {g.currentVersion && <span className="game-overlay-chip">{g.currentVersion}</span>}
            <span>{t(statusKey(g.installStatus))}</span>
          </p>
        </div>
      </div>

      {hasUpdate && (
        <p className="game-overlay-game-notice">
          <Icon name="download" size={13} />
          {t('overlay.game.update', { version: g.availableVersion ?? '' })}
        </p>
      )}

      <div className="game-overlay-game-stats">
        <div className="game-overlay-game-stat game-overlay-game-stat--main">
          <span className="game-overlay-game-stat-label">{t('overlay.game.session')}</span>
          <span className="game-overlay-game-stat-value">{session != null ? formatClock(session) : '—'}</span>
        </div>
        <div className="game-overlay-game-stat">
          <span className="game-overlay-game-stat-label">{t('overlay.game.total')}</span>
          <span className="game-overlay-game-stat-value">{formatPlaytime(Math.floor(total))}</span>
        </div>
        <div className="game-overlay-game-stat">
          <span className="game-overlay-game-stat-label">{t('overlay.game.sessions')}</span>
          <span className="game-overlay-game-stat-value">{snap.sessions.toLocaleString()}</span>
        </div>
        {snap.achievements && (
          <button
            type="button"
            className="game-overlay-game-stat game-overlay-game-stat--link"
            onClick={onShowAchievements}
            title={t('overlay.game.showAchievements')}
          >
            <span className="game-overlay-game-stat-label">{t('overlay.tab.achievements')}</span>
            <span className="game-overlay-game-stat-value">
              {snap.achievements.unlocked} / {snap.achievements.total}
            </span>
            <span
              className="game-overlay-game-progress"
              style={{ width: `${(snap.achievements.unlocked / snap.achievements.total) * 100}%` }}
              aria-hidden
            />
          </button>
        )}
      </div>

      <div className="game-overlay-game-actions">
        {g.installPath && (
          <button type="button" className="game-overlay-action" onClick={() => void ipc.revealInExplorer(g.installPath!)}>
            <Icon name="folder" size={14} />
            {t('overlay.game.openFolder')}
          </button>
        )}
        <button type="button" className="game-overlay-action" onClick={() => onOpenLink(g.threadUrl)}>
          <Icon name="external" size={14} />
          {t('overlay.game.openThread')}
        </button>
        {snap.elapsed != null && (
          <button
            type="button"
            className={`game-overlay-action game-overlay-action--danger${confirmStop ? ' is-confirming' : ''}`}
            onClick={() => void stop()}
            disabled={stopping}
          >
            <Icon name="stop" size={12} />
            {confirmStop ? t('overlay.game.stopConfirm') : t('overlay.game.stop')}
          </button>
        )}
      </div>
    </div>
  );
}

/** 1:04:09, or 4:09 under an hour. */
function formatClock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
