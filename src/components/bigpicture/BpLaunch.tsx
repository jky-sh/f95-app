import { useEffect, useRef } from 'react';
import { MIN_OVERLAY_DURATION_MS, useRunningGames, type LaunchEntry } from '../../contexts/RunningGames';
import { useT } from '../../lib/i18n';
import { formatPlaytime } from '../../types/library';
import { BpGlyph } from './BpGlyph';
import { useProgressiveArt } from './BpParts';
import { playSound } from './bpSound';

/** How long "Ready" stays up once the game is running. */
const READY_HOLD_MS = 900;

/**
 * Big Picture's launch screen (the desktop's floating card stays hidden):
 * the game's art slowly pushing in, its title, and a progress rule that
 * fills and turns red once the game is up.
 */
export function BpLaunch({ entry }: { entry: LaunchEntry }) {
  const { t } = useT();
  const { cancelLaunch } = useRunningGames();
  const { game, startedAt, launchedAt } = entry;
  const ready = launchedAt !== undefined;
  const art = useProgressiveArt(game.thumbnailUrl);

  // Once, even when StrictMode mounts twice.
  const sounded = useRef(false);
  useEffect(() => {
    if (sounded.current) return;
    sounded.current = true;
    playSound('launch');
  }, []);

  useEffect(() => {
    if (!ready) return;
    playSound('ready');
    const shown = Date.now() - startedAt;
    const wait = Math.max(0, MIN_OVERLAY_DURATION_MS - shown) + READY_HOLD_MS;
    const timer = window.setTimeout(() => cancelLaunch(game.threadId), wait);
    return () => window.clearTimeout(timer);
  }, [ready, startedAt, game.threadId, cancelLaunch]);

  return (
    <div className="bp-layer bp-launch" data-bp-layer="" data-ready={ready || undefined} role="status">
      {art && <img className="bp-launch-art" src={art} alt="" draggable={false} />}
      <div className="bp-launch-shade" />
      <div className="bp-launch-body">
        <span className="bp-launch-state">{ready ? t('launching.ready') : t('launching.starting')}</span>
        <h1 className="bp-launch-title">{game.title}</h1>
        <div className="bp-launch-meta">
          <span>{formatPlaytime(game.totalPlaytimeSeconds)}</span>
          {game.currentVersion && <span>{game.currentVersion}</span>}
        </div>
        <div className="bp-launch-bar" aria-hidden>
          <span className="bp-launch-fill" />
        </div>
        <p className="bp-launch-hint">{ready ? t('bp.launch.enjoy') : t('bp.launch.wait')}</p>
      </div>
      {!ready && (
        <button type="button" className="bp-launch-cancel" onClick={() => cancelLaunch(game.threadId)}>
          <BpGlyph action="back" />
          <span>{t('bp.launch.hide')}</span>
        </button>
      )}
    </div>
  );
}
