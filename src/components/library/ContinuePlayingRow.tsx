import { Link } from 'react-router-dom';
import { useIsRunning } from '../../contexts/RunningGames';
import { useT } from '../../lib/i18n';
import type { LibraryGame } from '../../types/library';
import { formatPlaytime } from '../../types/library';
import { parseDbTime } from '../../lib/dbTime';

interface Props {
  games: LibraryGame[];
  onPlay: (game: LibraryGame) => void;
  onContextMenu?: (e: React.MouseEvent, game: LibraryGame) => void;
}

/**
 * Wide horizontal row of "what to play next" — the 4-5 games the user
 * touched most recently. Sits above the full grid in the Library page
 * the same way Steam's "Recent activity" rail does. Each card shows a
 * bigger banner + a play CTA inline.
 */
export function ContinuePlayingRow({ games, onPlay, onContextMenu }: Props) {
  const { t } = useT();
  if (games.length === 0) return null;

  return (
    <section style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <h2 style={titleStyle}>{t('library.section.continuePlaying')}</h2>
        <span style={subtitleStyle}>{t('library.section.continuePlaying.hint')}</span>
      </div>
      <div style={rowStyle}>
        {games.map((g) => (
          <ContinuePlayingCard
            key={g.threadId}
            game={g}
            onPlay={onPlay}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </section>
  );
}

function ContinuePlayingCard({
  game,
  onPlay,
  onContextMenu,
}: {
  game: LibraryGame;
  onPlay: (g: LibraryGame) => void;
  onContextMenu?: (e: React.MouseEvent, game: LibraryGame) => void;
}) {
  const { t } = useT();
  const isRunning = useIsRunning(game.threadId);
  const lastPlayed = parseDbTime(game.lastPlayedAt)?.toLocaleDateString() ?? null;
  const playable = !!game.exePath;

  return (
    <div
      style={cardStyle}
      className="continue-card"
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, game) : undefined}
    >
      <Link to={`/library/game/${game.threadId}`} style={thumbLinkStyle}>
        {game.thumbnailUrl ? (
          <img src={game.thumbnailUrl} alt={game.title} style={thumbImg} loading="lazy" />
        ) : (
          <div style={thumbFallback}>{game.title.slice(0, 1).toUpperCase()}</div>
        )}
        <div style={overlayStyle} />
        {isRunning && <div style={runningPillStyle}>{t('libcard.playing')}</div>}
      </Link>

      <div style={infoStyle}>
        <Link to={`/library/game/${game.threadId}`} style={titleLinkStyle}>
          <span className="continue-card-title" style={cardTitleStyle} title={game.title}>
            {game.title}
          </span>
        </Link>
        <div style={metaStyle}>
          <span style={playtimeStyle}>{formatPlaytime(game.totalPlaytimeSeconds)}</span>
          {lastPlayed && <span style={lastPlayedStyle}>· {lastPlayed}</span>}
        </div>
        {/* onPlay stops a running game and asks for the exe when there is
            none, so every state stays clickable. */}
        <button
          type="button"
          style={{
            ...playButtonStyle,
            ...(isRunning ? stopButtonStyle : playable ? {} : pickExeButtonStyle),
          }}
          onClick={() => onPlay(game)}
        >
          {isRunning
            ? t('libcard.cta.stop')
            : playable
              ? t('libcard.cta.play')
              : t('libcard.cta.pickExe')}
        </button>
      </div>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  marginBottom: 28,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 12,
  marginBottom: 12,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 800,
  color: 'var(--text-primary)',
  letterSpacing: 0.2,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: 12,
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: 'transform 0.12s ease, border-color 0.12s ease',
};

const thumbLinkStyle: React.CSSProperties = {
  position: 'relative',
  display: 'block',
  width: '100%',
  paddingTop: '46%', // a bit wider than 16:9 for a more cinematic strip
  background: 'var(--bg-sunken)',
  overflow: 'hidden',
};

const thumbImg: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const thumbFallback: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 48,
  color: 'var(--text-faint)',
  fontWeight: 800,
};

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background:
    'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.4) 100%)',
  pointerEvents: 'none',
};

const runningPillStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  background: 'var(--status-success)',
  color: '#ffffff',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.4,
  padding: '2px 8px',
  borderRadius: 2,
};

const infoStyle: React.CSSProperties = {
  padding: '10px 12px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const titleLinkStyle: React.CSSProperties = {
  textDecoration: 'none',
  color: 'inherit',
};

const cardTitleStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  transition: 'color 0.1s ease',
};

const metaStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  fontSize: 11,
  color: 'var(--text-muted)',
};

const playtimeStyle: React.CSSProperties = {
  color: 'var(--text-tertiary)',
};

const lastPlayedStyle: React.CSSProperties = {
  color: 'var(--text-faint)',
};

const playButtonStyle: React.CSSProperties = {
  marginTop: 4,
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  border: 'none',
  borderRadius: 3,
  padding: '7px 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const stopButtonStyle: React.CSSProperties = {
  background: 'var(--status-danger-bg)',
  color: 'var(--status-danger-text)',
  boxShadow: 'inset 0 0 0 1px var(--accent-strong)',
};

const pickExeButtonStyle: React.CSSProperties = {
  background: 'var(--border-strong)',
  color: 'var(--text-secondary)',
};
