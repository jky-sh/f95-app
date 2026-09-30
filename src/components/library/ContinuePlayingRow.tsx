import { Link } from 'react-router-dom';
import { parseDbTime } from '../../lib/dbTime';
import { useT } from '../../lib/i18n';
import { formatWhen } from '../../lib/memberPresence';
import type { LibraryGame } from '../../types/library';
import { formatPlaytime } from '../../types/library';
import { LibraryCover } from './LibraryCover';
import { LibraryPrimaryAction, LibraryStatusBadge } from './LibraryGameViews';

interface Props {
  games: LibraryGame[];
  onPlay: (game: LibraryGame) => void;
  onContextMenu?: (e: React.MouseEvent, game: LibraryGame) => void;
}

/**
 * "What to play next": the games touched most recently, as wide art with a
 * round play button, above the full library (Steam's recent-activity rail).
 */
export function ContinuePlayingRow({ games, onPlay, onContextMenu }: Props) {
  const { t, locale } = useT();
  if (games.length === 0) return null;

  return (
    <section className="lib-section">
      <div className="ui-section-head">
        <h2 className="ui-section-title">{t('library.section.continuePlaying')}</h2>
        <span className="ui-section-hint">{t('library.section.continuePlaying.hint')}</span>
      </div>
      <div className="lib-continue">
        {games.map((g) => {
          const last = parseDbTime(g.lastPlayedAt);
          return (
            <article
              key={g.threadId}
              className="lib-continue-card"
              onContextMenu={onContextMenu ? (e) => onContextMenu(e, g) : undefined}
            >
              <Link to={`/library/game/${g.threadId}`} className="lib-tile-cover" aria-label={g.title}>
                <LibraryCover url={g.thumbnailUrl} title={g.title} />
                <span className="lib-tile-scrim" aria-hidden />
                <span className="lib-tile-info">
                  <span className="lib-tile-title">{g.title}</span>
                  <span className="lib-tile-meta">
                    <span>{formatPlaytime(g.totalPlaytimeSeconds)}</span>
                    {last && <span>{formatWhen(last.getTime(), locale)}</span>}
                  </span>
                </span>
              </Link>
              <span className="lib-badge-slot">
                <LibraryStatusBadge game={g} />
              </span>
              <LibraryPrimaryAction game={g} onPrimaryAction={onPlay} className="lib-continue-play" iconOnly />
            </article>
          );
        })}
      </div>
    </section>
  );
}
