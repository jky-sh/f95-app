import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { LibraryCover } from '../library/LibraryCover';
import { Icon, type IconName } from '../ui/Icon';
import { formatCount } from '../store/GameCard';
import { libraryBadgeKind } from '../store/LibraryBadge';
import { useIsRunning } from '../../contexts/RunningGames';
import { useT } from '../../lib/i18n';
import { requestRemotePreview } from '../../lib/gridPreviewQueue';
import { isF95AttachmentUrl, toF95OriginalUrl, toF95PreviewUrl } from '../../lib/f95ImageUrl';
import type { LibraryEntry } from '../../hooks/useLibraryIndex';
import type { ThreadDownload } from '../../hooks/useDownloadsByThread';
import { statusKey, type LibraryGame } from '../../types/library';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { useBp } from './BpContext';

/** "4:07" / "1:02:33": time in the current session. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/* ------------------------------------------------------------------------- */
/* Art                                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Art for large surfaces: F95's light preview at once, the 720 px cover
 * cached on disk next (the only one offline), the original last when
 * `original` — never stepping back down to a blurrier one.
 */
export function useProgressiveArt(url: string | null, original = true): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let level = 0;
    const upgrade = (next: string, to: number) => {
      if (cancelled || to <= level) return;
      level = to;
      setSrc(next);
    };
    const f95 = isF95AttachmentUrl(url);
    setSrc(f95 ? toF95PreviewUrl(url) : url);
    if (!f95) return;
    requestRemotePreview(url, { variant: 'cover', priority: 1 })
      .then((cover) => upgrade(cover, 1))
      .catch(() => undefined);
    if (original) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => upgrade(img.src, 2);
      img.src = toF95OriginalUrl(url);
    }
    return () => {
      cancelled = true;
    };
  }, [url, original]);
  return src;
}

/** Waits until an image can paint, so swaps never flash an empty frame. */
function preload(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  return img
    .decode()
    .catch(() => undefined)
    .then(() => img);
}

/** Banners much wider (3:1 logos) or taller than a screen show whole, not cropped. */
function fitsBadly(img: HTMLImageElement): boolean {
  const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
  return ratio > 2.05 || ratio < 1.1;
}

/** `onLoad` for header art: marks banners that should show whole (`data-whole`). */
export function markWholeArt(e: React.SyntheticEvent<HTMLImageElement>): void {
  e.currentTarget.toggleAttribute('data-whole', fitsBadly(e.currentTarget));
}

interface Layer {
  id: number;
  src: string;
  /** Shown whole (contain) instead of filling the area. */
  whole: boolean;
}

/**
 * The art behind every screen, cross-faded when the focus moves to another
 * game: a blurred wash of it everywhere, and on `hero` screens the art itself
 * on the right, fading into the dark.
 */
export function BpBackdrop({ art, mode }: { art: string | null; mode: 'hero' | 'ambient' }) {
  const src = useProgressiveArt(art, mode === 'hero');
  const [layers, setLayers] = useState<Layer[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    void preload(src).then((img) => {
      if (cancelled) return;
      nextId.current += 1;
      const id = nextId.current;
      setLayers((prev) => [...prev.slice(-1), { id, src, whole: fitsBadly(img) }]);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Older layers go once the new one has faded in over them.
  useEffect(() => {
    if (layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers((prev) => prev.slice(-1)), 900);
    return () => window.clearTimeout(timer);
  }, [layers]);

  return (
    <div className={`bp-backdrop bp-backdrop--${mode}`} aria-hidden>
      <div className="bp-backdrop-wash">
        {layers.map((l) => (
          <img key={l.id} src={l.src} alt="" className="bp-backdrop-layer" draggable={false} />
        ))}
      </div>
      <div className="bp-backdrop-hero">
        {layers.map((l) => (
          <img
            key={l.id}
            src={l.src}
            alt=""
            className="bp-backdrop-layer"
            data-whole={l.whole || undefined}
            draggable={false}
          />
        ))}
      </div>
      <div className="bp-backdrop-shade" />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Headings, rows, states                                                     */
/* ------------------------------------------------------------------------- */

export function BpHeading({ title, count, children }: { title: string; count?: number | null; children?: ReactNode }) {
  return (
    <div className="bp-heading">
      <h2 className="bp-heading-title">{title}</h2>
      {count != null && <span className="bp-heading-count">{count}</span>}
      {children}
    </div>
  );
}

/**
 * True for a moment after mount. Entrance animations hang off it, so they
 * play when a list first appears but not again when a hidden screen shows
 * again (showing an element restarts its CSS animations).
 */
export function useFresh(ms = 1400): boolean {
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setFresh(false), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return fresh;
}

/** A grid of tiles whose items rise in, one after the other, when it appears. */
export function BpGrid({ children, className }: { children: ReactNode; className?: string }) {
  const fresh = useFresh();
  return (
    <div className={className ? `bp-grid ${className}` : 'bp-grid'} data-fresh={fresh || undefined}>
      {children}
    </div>
  );
}

/**
 * A horizontal row of tiles; left/right stay in it, up/down leave it. `snap`
 * decides where the page settles when the focus enters it (see revealElement).
 */
export function BpShelf({
  id,
  title,
  count,
  snap = 'row',
  children,
}: {
  id: string;
  title: string;
  count?: number | null;
  snap?: 'row' | 'top' | 'none';
  children: ReactNode;
}) {
  const fresh = useFresh();
  return (
    <section
      className="bp-shelf"
      data-bp-group={id}
      data-bp-row=""
      data-bp-snap={snap === 'none' ? undefined : snap}
      data-fresh={fresh || undefined}
    >
      <BpHeading title={title} count={count} />
      <div className="bp-shelf-track" data-bp-track="">
        {children}
      </div>
    </section>
  );
}

/**
 * Tabs inside a page (a game's overview, achievements…). The focus picks the
 * tab, like on a console: moving along the row switches the panel below.
 */
export function BpSubTabs<T extends string>({
  id,
  tabs,
  active,
  onChange,
}: {
  id: string;
  tabs: { id: T; label: string; count?: string | number | null }[];
  active: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div className="bp-subtabs" role="tablist" data-bp-group={id} data-bp-row="">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className="bp-subtab bp-focusable"
          onFocus={() => onChange(tab.id)}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count != null && tab.count !== '' && <span className="bp-subtab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function BpLoader({ label }: { label?: string }) {
  return (
    <div className="bp-loader" role="status">
      <span className="bp-loader-bar" />
      {label && <span className="bp-loader-label">{label}</span>}
    </div>
  );
}

export function BpEmpty({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="bp-empty">
      <Icon name={icon} size={44} strokeWidth={1.5} />
      <h3 className="bp-empty-title">{title}</h3>
      {text && <p className="bp-empty-text">{text}</p>}
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Tiles                                                                      */
/* ------------------------------------------------------------------------- */

function GameStatus({ game, download }: { game: LibraryGame; download?: ThreadDownload }) {
  const { t } = useT();
  const running = useIsRunning(game.threadId);
  if (running) {
    return <span className="bp-badge bp-badge--live">{t('bp.badge.playing')}</span>;
  }
  if (download) {
    const label =
      download.phase === 'extracting'
        ? t('status.extracting')
        : download.phase === 'queued'
          ? t('bp.badge.queued')
          : t('status.downloading');
    return (
      <span className="bp-badge bp-badge--progress">
        {label}
        {download.percent != null && ` ${download.percent}%`}
      </span>
    );
  }
  switch (game.installStatus) {
    case 'update_available':
      return <span className="bp-badge bp-badge--info">{t('bp.badge.update')}</span>;
    case 'not_installed':
      return <span className="bp-badge">{t(statusKey(game.installStatus))}</span>;
    case 'error':
      return <span className="bp-badge bp-badge--danger">{t(statusKey(game.installStatus))}</span>;
    default:
      return null;
  }
}

interface GameTileProps {
  game: LibraryGame;
  /** Remembered-focus id prefix (the shelf or grid it sits in). */
  group: string;
  /** Position, for the staggered entrance. */
  index: number;
  size?: 'lg' | 'md';
  sub?: string | null;
  download?: ThreadDownload;
  onFocusGame?: (game: LibraryGame) => void;
  autoFocus?: boolean;
}

export const BpGameTile = memo(function BpGameTile({
  game,
  group,
  index,
  size = 'md',
  sub,
  download,
  onFocusGame,
  autoFocus,
}: GameTileProps) {
  const { t } = useT();
  const bp = useBp();
  const artRef = useRef<HTMLSpanElement>(null);
  return (
    <button
      type="button"
      className={`bp-tile bp-tile--${size} bp-focusable`}
      style={{ '--i': Math.min(index, 14) } as React.CSSProperties}
      data-bp-id={`${group}:${game.threadId}`}
      data-bp-a={t('bp.hint.open')}
      data-bp-x={t('bp.hint.options')}
      data-bp-autofocus={autoFocus || undefined}
      onFocus={onFocusGame ? () => onFocusGame(game) : undefined}
      onClick={() => bp.openGame(game, artRef.current)}
      onContextMenu={(e) => {
        e.preventDefault();
        bp.openGameOptions(game);
      }}
    >
      <span className="bp-tile-art" ref={artRef}>
        <LibraryCover url={game.thumbnailUrl} title={game.title} />
        <span className="bp-tile-badges">
          <GameStatus game={game} download={download} />
        </span>
        {download?.percent != null && (
          <span className="bp-tile-progress" aria-hidden>
            <span style={{ width: `${download.percent}%` }} />
          </span>
        )}
      </span>
      <span className="bp-tile-caption">
        <span className="bp-tile-title">{game.title}</span>
        {sub && <span className="bp-tile-sub">{sub}</span>}
      </span>
    </button>
  );
});

interface StoreTileProps {
  card: SamGameCard;
  category: SamCategory;
  group: string;
  index: number;
  entry?: LibraryEntry;
  size?: 'lg' | 'md';
  onFocusCard?: (card: SamGameCard, index: number) => void;
  autoFocus?: boolean;
}

export const BpStoreTile = memo(function BpStoreTile({
  card,
  category,
  group,
  index,
  entry,
  size = 'md',
  onFocusCard,
  autoFocus,
}: StoreTileProps) {
  const { t } = useT();
  const bp = useBp();
  const artRef = useRef<HTMLSpanElement>(null);
  const badge = libraryBadgeKind(entry, card.version);
  return (
    <button
      type="button"
      className={`bp-tile bp-tile--${size} bp-focusable`}
      style={{ '--i': Math.min(index, 14) } as React.CSSProperties}
      data-bp-id={`${group}:${card.threadId}`}
      data-bp-a={t('bp.hint.open')}
      data-bp-x={t('bp.hint.options')}
      data-bp-autofocus={autoFocus || undefined}
      onFocus={onFocusCard ? () => onFocusCard(card, index) : undefined}
      onClick={() => bp.openStoreGame(card, category, artRef.current)}
      onContextMenu={(e) => {
        e.preventDefault();
        bp.openStoreOptions(card, category);
      }}
    >
      <span className="bp-tile-art" ref={artRef}>
        <LibraryCover url={card.thumbnailUrl} title={card.title} quality="preview" />
        <span className="bp-tile-badges">
          {badge && <span className={`bp-badge bp-badge--lib-${badge}`}>{t(`store.lib.${badge}`)}</span>}
          {card.isNew && <span className="bp-badge bp-badge--new">{t('store.card.new')}</span>}
        </span>
        {card.version && <span className="bp-tile-version">{card.version}</span>}
      </span>
      <span className="bp-tile-caption">
        <span className="bp-tile-title">{card.title}</span>
        <span className="bp-tile-sub">
          {card.creator && <span className="bp-tile-creator">{card.creator}</span>}
          {card.rating != null && card.rating > 0 && (
            <span className="bp-tile-stat">
              <Icon name="star" size={12} /> {card.rating.toFixed(1)}
            </span>
          )}
          {card.likes != null && card.likes > 0 && (
            <span className="bp-tile-stat">
              <Icon name="heart" size={12} /> {formatCount(card.likes)}
            </span>
          )}
        </span>
      </span>
    </button>
  );
});
