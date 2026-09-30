import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useIsRunning, useRunningSince } from '../../contexts/RunningGames';
import type { ThreadDownload } from '../../hooks/useDownloadsByThread';
import { parseDbTime } from '../../lib/dbTime';
import { useT, type TFunction } from '../../lib/i18n';
import { primaryCta, type LibraryCtaIntent } from '../../lib/libraryCta';
import { formatWhen } from '../../lib/memberPresence';
import { formatPlaytime, type LibraryGame, type LibrarySort } from '../../types/library';
import { Icon, type IconName } from '../ui/Icon';
import { LibraryCover } from './LibraryCover';
import { PlayTimer } from './PlayTimer';

/** What every library view needs to render and act on one game. */
export interface LibraryItemProps {
  game: LibraryGame;
  onPrimaryAction: (game: LibraryGame) => void;
  onContextMenu?: (e: React.MouseEvent, game: LibraryGame) => void;
  /** Live download/extraction of this game, if any. */
  download?: ThreadDownload;
}

const href = (g: LibraryGame) => `/library/game/${g.threadId}`;

export function downloadLabel(download: ThreadDownload, t: TFunction): string {
  if (download.phase === 'queued') return t('libcard.progress.queued');
  const key =
    download.phase === 'extracting' ? 'libcard.progress.extracting' : 'libcard.progress.downloading';
  return download.percent != null ? t(key, { percent: download.percent }) : t(`${key}.unknown`);
}

/**
 * Status over a cover. A plain installed game shows nothing (it is the normal
 * state); the list view passes `showInstalled` to fill its status column.
 */
export function LibraryStatusBadge({
  game,
  download,
  showInstalled = false,
}: {
  game: LibraryGame;
  download?: ThreadDownload;
  showInstalled?: boolean;
}) {
  const { t } = useT();
  const running = useIsRunning(game.threadId);
  const since = useRunningSince(game.threadId);
  if (running) {
    return (
      <span className="ui-badge ui-badge--success">
        {t('libcard.running')}
        {since != null && (
          <>
            {' · '}
            <PlayTimer since={since} />
          </>
        )}
      </span>
    );
  }
  if (download) return <span className="ui-badge ui-badge--info">{downloadLabel(download, t)}</span>;
  switch (game.installStatus) {
    case 'update_available':
      return (
        <span
          className="ui-badge ui-badge--info"
          title={game.availableVersion ? t('libcard.updateTo', { version: game.availableVersion }) : undefined}
        >
          {t('status.update_available')}
        </span>
      );
    case 'not_installed':
      return <span className="ui-badge ui-badge--muted">{t('status.not_installed')}</span>;
    case 'downloading':
    case 'extracting':
      return <span className="ui-badge ui-badge--info">{t(`status.${game.installStatus}`)}</span>;
    case 'error':
      return <span className="ui-badge ui-badge--danger">{t('status.error')}</span>;
    default:
      return showInstalled ? (
        <span className="ui-badge ui-badge--success">{t('status.installed')}</span>
      ) : null;
  }
}

const CTA_STYLE: Record<LibraryCtaIntent, { variant: string; icon: IconName | null }> = {
  play: { variant: 'ui-btn--primary', icon: 'play' },
  view: { variant: 'ui-btn--primary', icon: 'play' },
  stop: { variant: 'ui-btn--stop', icon: 'stop' },
  update: { variant: 'ui-btn--update', icon: 'download' },
  'pick-exe': { variant: 'ui-btn--secondary', icon: 'folder' },
  noop: { variant: 'ui-btn--secondary', icon: null },
};

/** The game's main action (Play, Stop, Update, Pick .exe…). */
export function LibraryPrimaryAction({
  game,
  onPrimaryAction,
  className,
  iconOnly = false,
}: Pick<LibraryItemProps, 'game' | 'onPrimaryAction'> & { className?: string; iconOnly?: boolean }) {
  const { t } = useT();
  const running = useIsRunning(game.threadId);
  const cta = primaryCta(game, running, t);
  const style = CTA_STYLE[cta.intent];
  return (
    <button
      type="button"
      className={`ui-btn ${style.variant}${iconOnly ? ' ui-btn--icon' : ''}${className ? ` ${className}` : ''}`}
      disabled={cta.disabled}
      title={cta.title}
      aria-label={iconOnly ? cta.label : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onPrimaryAction(game);
      }}
    >
      {style.icon && <Icon name={style.icon} size={iconOnly ? 18 : 13} />}
      {!iconOnly && <span className="lib-cta-label">{cta.label}</span>}
    </button>
  );
}

/** "⋯": the same menu as right-clicking the game. */
export function LibraryMoreButton({
  game,
  onContextMenu,
  className,
}: Pick<LibraryItemProps, 'game' | 'onContextMenu'> & { className?: string }) {
  const { t } = useT();
  if (!onContextMenu) return null;
  return (
    <button
      type="button"
      className={`ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm${className ? ` ${className}` : ''}`}
      aria-label={t('libcard.more')}
      title={t('libcard.more')}
      onClick={(e) => onContextMenu(e, game)}
    >
      <Icon name="more" size={18} strokeWidth={3} />
    </button>
  );
}

function ProgressBar({ download }: { download?: ThreadDownload }) {
  if (download?.percent == null) return null;
  return (
    <div className="lib-progress" aria-hidden>
      <div style={{ width: `${download.percent}%` }} />
    </div>
  );
}

/** "v0.3.1 → v0.3.2" for pending updates, else the installed version. */
function VersionText({ game }: { game: LibraryGame }) {
  if (!game.currentVersion) return null;
  const pending =
    game.installStatus === 'update_available' && game.availableVersion && game.availableVersion !== game.currentVersion;
  return (
    <span className="lib-version" title={game.currentVersion}>
      {game.currentVersion}
      {pending && <span className="lib-version-next"> → {game.availableVersion}</span>}
    </span>
  );
}

function lastPlayedText(game: LibraryGame, locale: string): string | null {
  const d = parseDbTime(game.lastPlayedAt);
  return d ? formatWhen(d.getTime(), locale) : null;
}

/* ── Cards (the default grid) ───────────────────────────────────────────── */

export const LibraryCard = memo(function LibraryCard({ game, onPrimaryAction, onContextMenu, download }: LibraryItemProps) {
  const { locale } = useT();
  const lastPlayed = parseDbTime(game.lastPlayedAt);
  return (
    <article className="lib-card" onContextMenu={onContextMenu ? (e) => onContextMenu(e, game) : undefined}>
      <Link to={href(game)} className="lib-card-cover" aria-label={game.title}>
        <LibraryCover url={game.thumbnailUrl} title={game.title} />
        <span className="lib-badge-slot">
          <LibraryStatusBadge game={game} download={download} />
        </span>
        <ProgressBar download={download} />
      </Link>
      <div className="lib-card-body">
        <Link to={href(game)} className="lib-card-title" title={game.title}>
          {game.title}
        </Link>
        {/* Two facts fit a card; when it was last played shows on hover. */}
        <div
          className="lib-card-meta"
          title={lastPlayed ? formatWhen(lastPlayed.getTime(), locale) : undefined}
        >
          <VersionText game={game} />
          {game.category === 'games' && <span>{formatPlaytime(game.totalPlaytimeSeconds)}</span>}
        </div>
        <div className="lib-card-actions">
          <LibraryPrimaryAction game={game} onPrimaryAction={onPrimaryAction} className="ui-btn--sm lib-card-cta" />
          <LibraryMoreButton game={game} onContextMenu={onContextMenu} />
        </div>
      </div>
    </article>
  );
});

/* ── Covers (big art, actions on hover) ─────────────────────────────────── */

export const LibraryCoverTile = memo(function LibraryCoverTile({
  game,
  onPrimaryAction,
  onContextMenu,
  download,
}: LibraryItemProps) {
  const { t } = useT();
  const running = useIsRunning(game.threadId);
  const cta = primaryCta(game, running, t);
  return (
    <article className="lib-tile" onContextMenu={onContextMenu ? (e) => onContextMenu(e, game) : undefined}>
      <Link to={href(game)} className="lib-tile-cover" aria-label={game.title}>
        <LibraryCover url={game.thumbnailUrl} title={game.title} />
        <span className="lib-tile-scrim" aria-hidden />
        <span className="lib-tile-info">
          <span className="lib-tile-title">{game.title}</span>
          <span className="lib-tile-meta">
            <VersionText game={game} />
            {game.category === 'games' && game.totalPlaytimeSeconds > 0 && (
              <span>{formatPlaytime(game.totalPlaytimeSeconds)}</span>
            )}
          </span>
        </span>
        <ProgressBar download={download} />
      </Link>
      <span className="lib-badge-slot">
        <LibraryStatusBadge game={game} download={download} />
      </span>
      <div className="lib-tile-actions">
        {!cta.disabled && (
          <LibraryPrimaryAction game={game} onPrimaryAction={onPrimaryAction} className="lib-tile-play" iconOnly />
        )}
        <LibraryMoreButton game={game} onContextMenu={onContextMenu} className="lib-tile-more" />
      </div>
    </article>
  );
});

/* ── List (dense rows, sortable columns) ────────────────────────────────── */

const LIST_COLUMNS: { key: string; labelKey: string; sort?: LibrarySort }[] = [
  { key: 'title', labelKey: 'library.col.game', sort: 'title' },
  { key: 'version', labelKey: 'library.col.version' },
  { key: 'playtime', labelKey: 'library.col.playtime', sort: 'playtime' },
  { key: 'last', labelKey: 'library.col.lastPlayed', sort: 'last_played' },
  { key: 'status', labelKey: 'library.col.status' },
];

export function LibraryList({
  games,
  sort,
  onSort,
  renderRow,
}: {
  games: LibraryGame[];
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  renderRow: (game: LibraryGame) => React.ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="lib-list" role="table" aria-rowcount={games.length}>
      <div className="lib-list-row lib-list-head" role="row">
        <span className="lib-list-thumb" role="columnheader" aria-hidden />
        {LIST_COLUMNS.map((c) => (
          <span key={c.key} className={`lib-list-col lib-list-col--${c.key}`} role="columnheader">
            {c.sort ? (
              <button
                type="button"
                className={`lib-list-sort${sort === c.sort ? ' lib-list-sort--active' : ''}`}
                aria-pressed={sort === c.sort}
                onClick={() => onSort(c.sort!)}
              >
                {t(c.labelKey)}
                {sort === c.sort && <Icon name="chevronDown" size={12} />}
              </button>
            ) : (
              t(c.labelKey)
            )}
          </span>
        ))}
        <span className="lib-list-col lib-list-col--actions" role="columnheader" aria-hidden />
      </div>
      {games.map(renderRow)}
    </div>
  );
}

export const LibraryListRow = memo(function LibraryListRow({
  game,
  onPrimaryAction,
  onContextMenu,
  download,
}: LibraryItemProps) {
  const { locale } = useT();
  const navigate = useNavigate();
  const last = lastPlayedText(game, locale);
  return (
    <div
      className="lib-list-row"
      role="row"
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, game) : undefined}
      onDoubleClick={() => navigate(href(game))}
    >
      <Link to={href(game)} className="lib-list-thumb" tabIndex={-1} aria-hidden>
        <LibraryCover url={game.thumbnailUrl} title={game.title} />
        <ProgressBar download={download} />
      </Link>
      <span className="lib-list-col lib-list-col--title" role="cell">
        <Link to={href(game)} className="lib-list-title" title={game.title}>
          {game.title}
        </Link>
      </span>
      <span className="lib-list-col lib-list-col--version" role="cell">
        <VersionText game={game} />
      </span>
      <span className="lib-list-col lib-list-col--playtime" role="cell">
        {game.category === 'games' ? formatPlaytime(game.totalPlaytimeSeconds) : '—'}
      </span>
      <span className="lib-list-col lib-list-col--last" role="cell">
        {last ?? '—'}
      </span>
      <span className="lib-list-col lib-list-col--status" role="cell">
        <LibraryStatusBadge game={game} download={download} showInstalled />
      </span>
      <span className="lib-list-col lib-list-col--actions" role="cell">
        <LibraryPrimaryAction game={game} onPrimaryAction={onPrimaryAction} className="ui-btn--sm" />
        <LibraryMoreButton game={game} onContextMenu={onContextMenu} />
      </span>
    </div>
  );
});
