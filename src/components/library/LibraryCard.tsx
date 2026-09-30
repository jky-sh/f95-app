import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useIsRunning, useRunningSince } from '../../contexts/RunningGames';
import type { ThreadDownload } from '../../hooks/useDownloadsByThread';
import { PlayTimer } from './PlayTimer';
import { useT } from '../../lib/i18n';
import type { LibraryGame } from '../../types/library';
import { formatPlaytime, statusColor, statusKey } from '../../types/library';

interface Props {
  game: LibraryGame;
  onPrimaryAction: (game: LibraryGame) => void;
  onContextMenu?: (e: React.MouseEvent, game: LibraryGame) => void;
  /** Live download/extraction of this game, if any. */
  download?: ThreadDownload;
}

// Memoized: download progress ticks re-render only the card they belong to.
export const LibraryCard = memo(function LibraryCard({
  game,
  onPrimaryAction,
  onContextMenu,
  download,
}: Props) {
  const { t } = useT();
  const isRunning = useIsRunning(game.threadId);
  const runningSince = useRunningSince(game.threadId);
  const cta = primaryCta(game, isRunning, t);
  return (
    <div
      style={cardStyle}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, game) : undefined}
    >
      <Link to={`/library/game/${game.threadId}`} style={thumbLinkStyle}>
        {game.thumbnailUrl ? (
          <img src={game.thumbnailUrl} alt={game.title} loading="lazy" style={thumbImg} />
        ) : (
          <div style={thumbFallback}>{game.title.slice(0, 1).toUpperCase()}</div>
        )}
        <div
          style={{
            ...statusBadgeStyle,
            background: isRunning
              ? 'var(--status-success)'
              : download
                ? statusColor(download.phase === 'extracting' ? 'extracting' : 'downloading')
                : statusColor(game.installStatus),
          }}
        >
          {isRunning ? (
            <>
              {t('libcard.playing')}
              {runningSince != null && (
                <>
                  {' · '}
                  <PlayTimer since={runningSince} />
                </>
              )}
            </>
          ) : download ? (
            downloadLabel(download, t)
          ) : (
            t(statusKey(game.installStatus))
          )}
        </div>
        {download?.percent != null && (
          <div style={progressTrackStyle} aria-hidden>
            <div style={{ ...progressFillStyle, width: `${download.percent}%` }} />
          </div>
        )}
      </Link>

      <div style={bodyStyle}>
        <Link to={`/library/game/${game.threadId}`} style={titleLinkStyle}>
          <span style={titleStyle} title={game.title}>
            {game.title}
          </span>
        </Link>

        <div style={metaRow}>
          {game.currentVersion && <span style={versionStyle}>{game.currentVersion}</span>}
          <span style={playtimeStyle}>{formatPlaytime(game.totalPlaytimeSeconds)}</span>
        </div>

        <div style={actionsRow}>
          <button
            onClick={() => onPrimaryAction(game)}
            style={{
              ...primaryBtn,
              ...(cta.intent === 'stop' ? { background: 'var(--accent-strong)' } : {}),
              ...(cta.intent === 'update' ? { background: 'var(--status-info)' } : {}),
              ...(cta.disabled ? disabledBtn : {}),
            }}
            disabled={cta.disabled}
            title={cta.title}
          >
            {cta.label}
          </button>
          <Link to={`/library/game/${game.threadId}`} style={detailLink}>
            {t('libcard.detail')}
          </Link>
        </div>
      </div>
    </div>
  );
});

export function downloadLabel(
  download: ThreadDownload,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  if (download.phase === 'queued') return t('libcard.progress.queued');
  const key =
    download.phase === 'extracting' ? 'libcard.progress.extracting' : 'libcard.progress.downloading';
  return download.percent != null ? t(key, { percent: download.percent }) : t(`${key}.unknown`);
}

function mediaCta(
  g: LibraryGame,
  t: (k: string, v?: Record<string, string | number>) => string,
): { label: string; title: string; disabled: boolean; intent: 'view' } {
  switch (g.category) {
    case 'comics':
      return { label: t('libcard.cta.read'), title: t('libcard.cta.read.title'), disabled: false, intent: 'view' };
    case 'animations':
      return { label: t('libcard.cta.watch'), title: t('libcard.cta.watch.title'), disabled: false, intent: 'view' };
    case 'assets':
      return { label: t('libcard.cta.browse'), title: t('libcard.cta.browse.title'), disabled: false, intent: 'view' };
    case 'mods':
      return g.exePath
        ? { label: t('libcard.cta.open'), title: t('libcard.cta.open.title'), disabled: false, intent: 'view' }
        : { label: t('libcard.cta.browse'), title: t('libcard.cta.browse.title'), disabled: false, intent: 'view' };
    default:
      return { label: t('libcard.cta.browse'), title: t('libcard.cta.browse.title'), disabled: false, intent: 'view' };
  }
}

function primaryCta(
  g: LibraryGame,
  isRunning: boolean,
  t: (k: string, v?: Record<string, string | number>) => string,
): {
  label: string;
  title: string;
  disabled: boolean;
  intent: 'play' | 'stop' | 'pick-exe' | 'update' | 'noop' | 'view';
} {
  if (isRunning && g.category === 'games') {
    return { label: t('libcard.cta.stop'), title: t('libcard.cta.stop.title'), disabled: false, intent: 'stop' };
  }
  switch (g.installStatus) {
    case 'installed':
      if (g.category !== 'games') {
        if (g.installPath) return mediaCta(g, t);
        return { label: t('libcard.cta.pickExe'), title: t('libcard.cta.pickExe.title'), disabled: false, intent: 'pick-exe' };
      }
      return g.exePath
        ? { label: t('libcard.cta.play'), title: t('libcard.cta.play.title'), disabled: false, intent: 'play' }
        : { label: t('libcard.cta.pickExe'), title: t('libcard.cta.pickExe.title'), disabled: false, intent: 'pick-exe' };
    case 'downloading':
      return { label: t('libcard.cta.downloading'), title: t('libcard.cta.inFlight.title'), disabled: true, intent: 'noop' };
    case 'extracting':
      return { label: t('libcard.cta.extracting'), title: t('libcard.cta.inFlight.title'), disabled: true, intent: 'noop' };
    case 'update_available':
      // Jogável mesmo com update pendente: o CTA continua sendo Jogar (o
      // badge de status do card já sinaliza a atualização; ela fica no menu
      // de contexto e na página do jogo).
      if (g.category === 'games' && g.exePath) {
        return {
          label: t('libcard.cta.play'),
          title: g.availableVersion
            ? t('libcard.cta.updatePlayable.title', { version: g.availableVersion })
            : t('libcard.cta.play.title'),
          disabled: false,
          intent: 'play',
        };
      }
      return {
        label: g.availableVersion
          ? t('libcard.cta.updateTo', { version: g.availableVersion })
          : t('libcard.cta.update'),
        title: g.availableVersion
          ? t('libcard.cta.update.title', { version: g.availableVersion })
          : t('libcard.cta.update.titleSimple'),
        disabled: false,
        intent: 'update',
      };
    case 'error':
      return { label: t('libcard.cta.error'), title: t('libcard.cta.error.title'), disabled: true, intent: 'noop' };
    case 'not_installed':
    default:
      return { label: t('libcard.cta.pickExe'), title: t('libcard.cta.pickExe.title'), disabled: false, intent: 'pick-exe' };
  }
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  overflow: 'hidden',
};

// padding-top trick keeps the thumbnail at a fixed 16:9 ratio regardless of
// the source image's intrinsic dimensions. The browser sometimes ignores
// `aspect-ratio` on a grid child when the inner img reports a tall natural
// size (e.g. portrait posters from F95 thumbnails) — switching to a
// padding-top reserve makes the container ratio explicit before the image
// loads, so all cards in a row stay the same height.
const thumbLinkStyle: React.CSSProperties = {
  position: 'relative',
  display: 'block',
  width: '100%',
  paddingTop: '56.25%', // 9 / 16
  background: 'var(--bg-sunken)',
  textDecoration: 'none',
  overflow: 'hidden',
};

const thumbImg: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const thumbFallback: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 32,
  color: 'var(--text-faint)',
  fontWeight: 800,
};

const statusBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  color: 'var(--text-primary)',
  fontSize: 10,
  padding: '2px 8px',
  borderRadius: 2,
  fontWeight: 700,
  letterSpacing: 0.3,
};

const progressTrackStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: 3,
  background: 'rgba(0, 0, 0, 0.55)',
};

const progressFillStyle: React.CSSProperties = {
  height: '100%',
  background: 'var(--status-info)',
  transition: 'width 0.3s ease',
};

const bodyStyle: React.CSSProperties = {
  padding: '10px 12px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const titleLinkStyle: React.CSSProperties = {
  textDecoration: 'none',
  color: 'inherit',
};

const titleStyle: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  color: 'var(--text-primary)',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.3,
  minHeight: 36,
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontSize: 11,
  color: 'var(--text-muted)',
};

const versionStyle: React.CSSProperties = {
  background: 'var(--border)',
  color: 'var(--text-secondary)',
  padding: '1px 6px',
  borderRadius: 2,
  fontWeight: 600,
};

const playtimeStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
};

const actionsRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
};

const primaryBtn: React.CSSProperties = {
  flex: 1,
  background: 'var(--accent)',
  color: 'var(--text-primary)',
  border: 'none',
  padding: '6px 10px',
  borderRadius: 3,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const disabledBtn: React.CSSProperties = {
  background: 'var(--border-strong)',
  color: 'var(--text-muted)',
  cursor: 'not-allowed',
};

const detailLink: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  textDecoration: 'none',
};
