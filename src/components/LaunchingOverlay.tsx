import { useEffect } from 'react';
import {
  useRunningGames,
  MIN_OVERLAY_DURATION_MS,
  type LaunchEntry,
} from '../contexts/RunningGames';
import { useT } from '../lib/i18n';
import { useBigPictureState } from '../lib/bigPicture';
import { Spinner } from './ui/Spinner';
import { formatPlaytime } from '../types/library';

/**
 * Hydra-style floating "now launching" card. Renders only while there are
 * games in the `launching` set on the RunningGames context. Mounted once
 * at the AppShell level so it floats over any page.
 *
 * Auto-dismisses when the Rust launcher fires `game:started` (or when the
 * 30s safety timeout in the context expires). The user can also dismiss
 * manually via the close button — useful if the launch is hung and the
 * timeout hasn't fired yet.
 */
export function LaunchingOverlay() {
  const { launching } = useRunningGames();
  // Big Picture shows its own full-screen launch screen (and dismisses it).
  const bigPicture = useBigPictureState().status !== 'closed';
  if (launching.size === 0 || bigPicture) return null;

  return (
    <div style={stackStyle}>
      {Array.from(launching.values()).map((entry) => (
        <LaunchingCard key={entry.game.threadId} entry={entry} />
      ))}
    </div>
  );
}

function LaunchingCard({ entry }: { entry: LaunchEntry }) {
  const { t } = useT();
  const { cancelLaunch } = useRunningGames();
  const { game, startedAt, launchedAt } = entry;
  const isReady = launchedAt !== undefined;
  const threadId = game.threadId;
  // The card owns its own dismissal timing. As soon as Rust flips us
  // into the "ready" state, schedule a self-dismiss so the user can
  // actually see the "Pronto" pop. If the spawn took longer than the
  // minimum already, dismiss right away.
  //
  // Pulling `cancelLaunch` from the context (stable via useCallback)
  // instead of receiving it as a prop avoids the "new function every
  // render" bug that resets the timer continuously.
  useEffect(() => {
    if (!isReady) return;
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, MIN_OVERLAY_DURATION_MS - elapsed);
    const timer = setTimeout(() => cancelLaunch(threadId), remaining);
    return () => clearTimeout(timer);
  }, [isReady, startedAt, threadId, cancelLaunch]);

  const onDismiss = () => cancelLaunch(threadId);

  return (
    <div style={cardStyle} className="launching-card">
      <div style={artStyle}>
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt={game.title}
            style={artImg}
            draggable={false}
          />
        ) : (
          <span style={artFallback}>{game.title.charAt(0).toUpperCase()}</span>
        )}
      </div>

      <div style={contentStyle}>
        <div style={titleRowStyle}>
          <div style={titleStackStyle}>
            <h2 style={titleStyle} title={game.title}>
              {game.title}
            </h2>
            <div style={statusRowStyle}>
              {isReady ? <ReadyIcon /> : <Spinner size="sm" />}
              <span
                style={{
                  ...statusTextStyle,
                  color: isReady ? 'var(--status-success)' : 'var(--text-muted)',
                  fontWeight: isReady ? 600 : 500,
                }}
              >
                {isReady ? t('launching.ready') : t('launching.starting')}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            className="launching-close"
            style={closeBtnStyle}
            aria-label={t('common.cancel')}
            title={t('common.cancel')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" />
              <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>

        <div style={statsRowStyle}>
          <div style={statItemStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>{formatPlaytime(game.totalPlaytimeSeconds)}</span>
          </div>
          {game.currentVersion && (
            <div style={statItemStyle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M7 4h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path d="M9 20h6M12 12v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span>{game.currentVersion}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReadyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      style={{ flexShrink: 0, animation: 'ready-pop 0.28s ease-out' }}
    >
      <circle cx="12" cy="12" r="10" fill="var(--status-success)" />
      <path
        d="M8 12.5l2.5 2.5L16 9.5"
        stroke="#fff"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const stackStyle: React.CSSProperties = {
  position: 'fixed',
  top: 44, // sits just below the 32-px custom title bar with a small gap
  right: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  zIndex: 1500,
  pointerEvents: 'none',
};

const cardStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  display: 'flex',
  gap: 16,
  width: 'min(560px, calc(100vw - 40px))',
  padding: 12,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4)',
  // Subtle entrance animation — defined in App.css.
  animation: 'launching-in 0.22s ease-out',
};

const artStyle: React.CSSProperties = {
  width: 132,
  height: 196,
  flexShrink: 0,
  borderRadius: 6,
  overflow: 'hidden',
  background: 'var(--bg-sunken)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const artImg: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const artFallback: React.CSSProperties = {
  fontSize: 48,
  color: 'var(--text-faint)',
  fontWeight: 800,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  minWidth: 0,
  paddingTop: 4,
  paddingBottom: 4,
};

const titleRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  alignItems: 'flex-start',
};

const titleStackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--text-primary)',
  lineHeight: 1.15,
  // Truncate long titles to 2 lines.
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  letterSpacing: -0.2,
};

const statusRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const statusTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-muted)',
  fontWeight: 500,
};

const closeBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  background: 'transparent',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
  flexShrink: 0,
  marginTop: 2,
};

const statsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 18,
  alignItems: 'center',
  paddingTop: 8,
};

const statItemStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text-tertiary)',
};
