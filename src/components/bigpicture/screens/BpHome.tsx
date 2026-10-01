import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOffline } from '../../../contexts/Offline';
import { useRunningGames } from '../../../contexts/RunningGames';
import { useDownloadsByThread } from '../../../hooks/useDownloadsByThread';
import { useLibraryIndex } from '../../../hooks/useLibraryIndex';
import { useSamList } from '../../../hooks/useSamList';
import { parseDbTime } from '../../../lib/dbTime';
import { useT } from '../../../lib/i18n';
import { primaryCta } from '../../../lib/libraryCta';
import { playOrStop } from '../../../lib/libraryGameActions';
import { formatWhen } from '../../../lib/memberPresence';
import { formatPlaytime, type LibraryGame } from '../../../types/library';
import type { SamGameCard } from '../../../types/sam';
import { Icon } from '../../ui/Icon';
import { formatCount } from '../../store/GameCard';
import { useBp, useBpGames } from '../BpContext';
import { BpGameTile, BpLoader, BpShelf, BpStoreTile } from '../BpParts';
import { ctaIcon } from './BpGame';

type Focused =
  | { kind: 'game'; game: LibraryGame }
  | { kind: 'store'; card: SamGameCard };

const SHELF_SIZE = 14;

function playedAt(g: LibraryGame): number {
  return parseDbTime(g.lastPlayedAt)?.getTime() ?? 0;
}

function addedAt(g: LibraryGame): number {
  return parseDbTime(g.addedAt)?.getTime() ?? 0;
}

/**
 * Home: the focused game fills the screen (art on the right, title and
 * quick actions on the left) above shelves of what to play next, what has
 * an update, what was just added and what is new on F95.
 */
export function BpHome() {
  const { t, locale } = useT();
  const bp = useBp();
  const games = useBpGames();
  const { isOffline } = useOffline();
  const downloads = useDownloadsByThread();
  const libraryIndex = useLibraryIndex();
  const [focused, setFocused] = useState<Focused | null>(null);

  const shelves = useMemo(() => {
    if (!games) return null;
    const recent = games
      .filter((g) => g.lastPlayedAt)
      .sort((a, b) => playedAt(b) - playedAt(a))
      .slice(0, SHELF_SIZE);
    const updates = games.filter((g) => g.installStatus === 'update_available').slice(0, SHELF_SIZE);
    const added = [...games].sort((a, b) => addedAt(b) - addedAt(a)).slice(0, SHELF_SIZE);
    return { recent, updates, added };
  }, [games]);

  const store = useSamList({ category: 'games', sort: 'date', rows: 18 }, { enabled: !isOffline });

  // Keep the hero on a game that still exists (and current, after changes).
  const hero: Focused | null = useMemo(() => {
    if (focused?.kind === 'game') {
      const fresh = games?.find((g) => g.threadId === focused.game.threadId);
      if (fresh) return { kind: 'game', game: fresh };
    } else if (focused) {
      return focused;
    }
    const first = shelves?.recent[0] ?? shelves?.added[0];
    if (first) return { kind: 'game', game: first };
    const card = store.items[0];
    return card ? { kind: 'store', card } : null;
  }, [focused, games, shelves, store.items]);

  const heroArt = hero ? (hero.kind === 'game' ? hero.game.thumbnailUrl : hero.card.thumbnailUrl) : null;
  useEffect(() => {
    // Holding a direction flies over tiles: only settle on where it stops.
    const timer = window.setTimeout(() => bp.setBackdrop(heroArt), 140);
    return () => window.clearTimeout(timer);
  }, [bp, heroArt]);

  const onFocusGame = useCallback((game: LibraryGame) => setFocused({ kind: 'game', game }), []);
  const onFocusCard = useCallback((card: SamGameCard) => setFocused({ kind: 'store', card }), []);

  if (!games || !shelves) {
    return (
      <div className="bp-screen-body bp-center" data-bp-scroll-y="">
        <BpLoader label={t('common.loading')} />
      </div>
    );
  }

  const empty = games.length === 0;
  // The first row keeps the page at its top, so the hero stays in view.
  let firstShelf = true;
  const snap = () => {
    const value = firstShelf ? 'top' : 'row';
    firstShelf = false;
    return value;
  };

  return (
    <div className="bp-screen-body bp-home" data-bp-scroll-y="">
      {empty ? (
        <section className="bp-hero" data-bp-snap="top">
          <h1 className="bp-hero-title">{t('bp.home.empty.title')}</h1>
          <p className="bp-hero-text">{t('bp.home.empty.text')}</p>
          <div className="bp-actions">
            <button
              type="button"
              className="bp-btn bp-btn--lg bp-btn--primary bp-focusable"
              data-bp-autofocus=""
              onClick={() => bp.switchTab('store')}
            >
              <Icon name="store" size={20} />
              {t('bp.home.empty.cta')}
            </button>
          </div>
        </section>
      ) : (
        hero && <Hero key={hero.kind === 'game' ? hero.game.threadId : hero.card.threadId} focused={hero} />
      )}

      {shelves.recent.length > 0 && (
        <BpShelf id="home-recent" title={t('bp.home.continue')} snap={snap()}>
          {shelves.recent.map((g, i) => (
            <BpGameTile
              key={g.threadId}
              game={g}
              group="home-recent"
              index={i}
              size="lg"
              autoFocus={i === 0}
              download={downloads.get(g.threadId)}
              sub={formatWhen(playedAt(g), locale)}
              onFocusGame={onFocusGame}
            />
          ))}
        </BpShelf>
      )}

      {shelves.updates.length > 0 && (
        <BpShelf id="home-updates" title={t('bp.home.updates')} count={shelves.updates.length} snap={snap()}>
          {shelves.updates.map((g, i) => (
            <BpGameTile
              key={g.threadId}
              game={g}
              group="home-updates"
              index={i}
              download={downloads.get(g.threadId)}
              sub={
                g.availableVersion
                  ? `${g.currentVersion ?? '?'} → ${g.availableVersion}`
                  : t('status.update_available')
              }
              onFocusGame={onFocusGame}
            />
          ))}
        </BpShelf>
      )}

      {shelves.added.length > 0 && (
        <BpShelf id="home-added" title={t('bp.home.added')} snap={snap()}>
          {shelves.added.map((g, i) => (
            <BpGameTile
              key={g.threadId}
              game={g}
              group="home-added"
              index={i}
              autoFocus={shelves.recent.length === 0 && i === 0}
              download={downloads.get(g.threadId)}
              sub={formatPlaytime(g.totalPlaytimeSeconds)}
              onFocusGame={onFocusGame}
            />
          ))}
        </BpShelf>
      )}

      {!isOffline && (
        <BpShelf id="home-store" title={t('bp.home.store')} snap={snap()}>
          {store.items.length === 0 ? (
            store.loading ? <BpLoader /> : <span className="bp-muted">{t('bp.store.error')}</span>
          ) : (
            store.items.map((card, i) => (
              <BpStoreTile
                key={card.threadId}
                card={card}
                category="games"
                group="home-store"
                index={i}
                entry={libraryIndex.get(card.threadId)}
                onFocusCard={onFocusCard}
              />
            ))
          )}
        </BpShelf>
      )}
    </div>
  );
}

/** Title, facts and the two quick actions of the focused game. */
function Hero({ focused }: { focused: Focused }) {
  const { t, locale } = useT();
  const bp = useBp();
  const { running } = useRunningGames();

  if (focused.kind === 'store') {
    const { card } = focused;
    return (
      <section className="bp-hero" data-bp-snap="top">
        <h1 className="bp-hero-title">{card.title}</h1>
        <div className="bp-meta">
          {card.creator && <span>{card.creator}</span>}
          {card.version && <span>{card.version}</span>}
          {card.rating != null && card.rating > 0 && (
            <span>
              <Icon name="star" size={15} /> {card.rating.toFixed(1)}
            </span>
          )}
          {card.likes != null && (
            <span>
              <Icon name="heart" size={15} /> {formatCount(card.likes)}
            </span>
          )}
        </div>
        <div className="bp-actions" data-bp-group="hero" data-bp-row="">
          <button
            type="button"
            className="bp-btn bp-btn--lg bp-btn--primary bp-focusable"
            onClick={() => bp.openStoreGame(card, 'games')}
          >
            <Icon name="store" size={20} />
            {t('bp.store.details')}
          </button>
        </div>
      </section>
    );
  }

  const { game } = focused;
  const isRunning = running.has(game.threadId);
  const cta = primaryCta(game, isRunning, t);
  const last = parseDbTime(game.lastPlayedAt);
  return (
    <section className="bp-hero" data-bp-snap="top">
      <h1 className="bp-hero-title">{game.title}</h1>
      <div className="bp-meta">
        {isRunning && <span className="bp-badge bp-badge--live">{t('bp.badge.playing')}</span>}
        <span>
          <Icon name="clock" size={15} /> {formatPlaytime(game.totalPlaytimeSeconds)}
        </span>
        <span>{last ? t('bp.lastPlayed', { when: formatWhen(last.getTime(), locale) }) : t('time.neverPlayed')}</span>
        {game.currentVersion && <span>{game.currentVersion}</span>}
        {game.installStatus === 'update_available' && game.availableVersion && (
          <span className="bp-meta-accent">{t('bp.updateTo', { version: game.availableVersion })}</span>
        )}
      </div>
      <div className="bp-actions" data-bp-group="hero" data-bp-row="">
        <button
          type="button"
          className={`bp-btn bp-btn--lg ${cta.intent === 'stop' ? 'bp-btn--stop' : 'bp-btn--primary'} bp-focusable`}
          data-bp-a={cta.label}
          disabled={cta.disabled}
          title={cta.title}
          onClick={() => void playOrStop(game, bp.gameDeps())}
        >
          <Icon name={ctaIcon(cta.intent, game)} size={20} />
          {cta.label}
        </button>
        <button type="button" className="bp-btn bp-btn--lg bp-focusable" onClick={() => bp.openGame(game)}>
          <Icon name="info" size={20} />
          {t('bp.game.page')}
        </button>
      </div>
    </section>
  );
}
