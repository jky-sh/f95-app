import { LazyRemoteImage } from '../game/LazyRemoteImage';
import '../../styles/game-description.css';

/**
 * Cover for library cards: F95's 400 px preview right away, then the
 * original resized to 720 px and cached on disk once the card nears the
 * viewport (sharp on high-DPI screens, instant next time and offline).
 * Fills the nearest positioned ancestor (the 16:9 thumbnail box).
 */
export function LibraryCover({ url, title }: { url: string | null; title: string }) {
  if (!url) {
    return <div className="library-cover-fallback">{title.slice(0, 1).toUpperCase()}</div>;
  }
  return (
    <LazyRemoteImage
      src={url}
      upgrade="cover"
      priority={3}
      rootMargin="240px 0px"
      alt={title}
      className="library-cover-img"
    />
  );
}
