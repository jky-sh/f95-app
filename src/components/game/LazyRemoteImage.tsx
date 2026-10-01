import { useEffect, useRef, useState } from 'react';
import { requestRemotePreview } from '../../lib/gridPreviewQueue';
import { instantPreviewUrl } from '../../lib/f95ImageUrl';

export type LazyRemoteUpgrade = 'none' | 'grid' | 'cover';

interface Props {
  src: string;
  previewSrc?: string;
  /** none = só o preview leve; grid = preview 400px em cache; cover = original em 720px, em cache */
  upgrade?: LazyRemoteUpgrade;
  priority?: number;
  alt?: string;
  className?: string;
  rootMargin?: string;
  /** Every image that finishes loading (the light preview, then the upgrade). */
  onLoad?: (img: HTMLImageElement) => void;
}

export function LazyRemoteImage({
  src,
  previewSrc,
  upgrade = 'none',
  priority = 5,
  alt = '',
  className,
  rootMargin = '80px 0px',
  onLoad,
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const preview = previewSrc ?? instantPreviewUrl(src) ?? src;

  useEffect(() => {
    setDisplaySrc(null);
    const el = ref.current;
    if (!el) return;

    let cancelled = false;

    const startLoad = () => {
      if (cancelled) return;
      if (preview) setDisplaySrc(preview);

      if (upgrade === 'none') return;

      void requestRemotePreview(src, { variant: upgrade, priority }).then((url) => {
        if (!cancelled) setDisplaySrc(url);
      });
    };

    if (typeof IntersectionObserver === 'undefined') {
      startLoad();
      return () => {
        cancelled = true;
      };
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          startLoad();
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [src, preview, upgrade, priority, rootMargin]);

  const imgClass = className
    ? displaySrc
      ? className
      : `${className} ${className}--placeholder`
    : undefined;

  return (
    <span ref={ref} className="lazy-remote-image">
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={alt}
          className={imgClass}
          decoding="async"
          loading="lazy"
          onLoad={onLoad ? (e) => onLoad(e.currentTarget) : undefined}
        />
      ) : (
        <span className={imgClass ?? 'lazy-remote-image__placeholder'} aria-hidden />
      )}
    </span>
  );
}
