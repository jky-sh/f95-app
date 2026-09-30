import { useCallback, useState } from 'react';
import { LazyRemoteImage } from '../game/LazyRemoteImage';
import '../../styles/game-description.css';

/** Wider than this (or much taller than the box) → show whole, not cropped. */
const WIDE_RATIO = 2.05;
const TALL_RATIO = 1.25;

/**
 * Cover for library tiles, filling the nearest positioned ancestor.
 * F95's 400 px preview shows right away, then the original resized to 720 px
 * and cached on disk once the tile nears the viewport (sharp on high-DPI
 * screens, instant next time and offline). Banners much wider than the box
 * (3:1 logos are common on F95) show whole over a blurred copy of themselves
 * instead of losing their title to the crop.
 */
export function LibraryCover({
  url,
  title,
  quality = 'full',
}: {
  url: string | null;
  title: string;
  /** preview: only F95's 400 px image (store grids browse hundreds of games). */
  quality?: 'full' | 'preview';
}) {
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const onLoad = useCallback((img: HTMLImageElement) => {
    const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
    setBackdrop(ratio > WIDE_RATIO || ratio < TALL_RATIO ? img.currentSrc || img.src : null);
  }, []);

  if (!url) {
    return (
      <div className="library-cover">
        <div className="library-cover-fallback">{title.slice(0, 1).toUpperCase()}</div>
      </div>
    );
  }
  return (
    <div
      className={`library-cover${backdrop ? ' library-cover--contain' : ''}`}
      style={backdrop ? ({ '--cover-url': `url("${backdrop}")` } as React.CSSProperties) : undefined}
    >
      <LazyRemoteImage
        src={url}
        upgrade={quality === 'full' ? 'cover' : 'none'}
        priority={3}
        rootMargin="240px 0px"
        alt={title}
        className="library-cover-img"
        onLoad={onLoad}
      />
    </div>
  );
}
