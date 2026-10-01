import { useEffect, useRef, type CSSProperties } from 'react';
import {
  instantPreviewUrl,
  toF95FullUrl,
} from '../../lib/f95ImageUrl';
import { requestGridPreview } from '../../lib/gridPreviewQueue';
import '../../styles/game-description.css';

interface Props {
  html: string;
  className?: string;
  style?: CSSProperties;
}

const VIEW_MARGIN_PX = 200;

function isNearViewport(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  return rect.bottom >= -VIEW_MARGIN_PX && rect.top <= window.innerHeight + VIEW_MARGIN_PX;
}

/**
 * Descrição: preview F95 de 400px imediato → a mesma imagem em cache local
 * (fila), que continua aparecendo offline.
 */
export function GameDescription({ html, className, style }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const priorityRef = useRef(0);
  const upgradedRef = useRef(new WeakSet<HTMLImageElement>());

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    priorityRef.current = 0;
    upgradedRef.current = new WeakSet();
    const imgs = root.querySelectorAll<HTMLImageElement>('img');
    if (imgs.length === 0) return;

    const prepare = (img: HTMLImageElement) => {
      const raw = img.getAttribute('src') || img.dataset.fullSrc || '';
      const full = toF95FullUrl(raw);
      if (!full) return false;
      img.dataset.fullSrc = full;
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';

      const instant = instantPreviewUrl(full);
      if (instant) {
        img.src = instant;
      } else {
        img.removeAttribute('src');
        img.classList.add('game-description-img--pending');
      }
      return true;
    };

    const upgrade = (img: HTMLImageElement) => {
      if (upgradedRef.current.has(img)) return;
      const full = img.dataset.fullSrc;
      if (!full) return;
      upgradedRef.current.add(img);

      const priority = Math.min(priorityRef.current, 8);
      priorityRef.current += 1;

      void requestGridPreview(full, priority).then((url) => {
        if (!img.isConnected) return;
        img.src = url;
        img.classList.remove('game-description-img--pending', 'game-description-img--preview');
      });
    };

    const ready: HTMLImageElement[] = [];
    imgs.forEach((img) => {
      if (prepare(img)) ready.push(img);
    });

    if (typeof IntersectionObserver === 'undefined') {
      ready.forEach(upgrade);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          upgrade(entry.target as HTMLImageElement);
          io.unobserve(entry.target);
        }
      },
      { rootMargin: `${VIEW_MARGIN_PX}px 0px` },
    );

    ready.forEach((img) => {
      if (isNearViewport(img)) {
        upgrade(img);
      } else {
        io.observe(img);
      }
    });

    return () => io.disconnect();
  }, [html]);

  return (
    <div
      ref={rootRef}
      className={className ? `game-description ${className}` : 'game-description'}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
