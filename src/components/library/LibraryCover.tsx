import { LazyRemoteImage } from '../game/LazyRemoteImage';
import '../../styles/game-description.css';

/**
 * Cover for library cards: F95's small thumbnail right away, then the ~720px
 * preview cached on disk once the card nears the viewport. Lighter than the
 * full banners the rows store, and cached covers keep showing offline.
 * Fills the nearest positioned ancestor (the 16:9 thumbnail box).
 */
export function LibraryCover({ url, title }: { url: string | null; title: string }) {
  if (!url) {
    return <div className="library-cover-fallback">{title.slice(0, 1).toUpperCase()}</div>;
  }
  return (
    <LazyRemoteImage
      src={url}
      upgrade="grid"
      priority={3}
      rootMargin="240px 0px"
      alt={title}
      className="library-cover-img"
    />
  );
}
