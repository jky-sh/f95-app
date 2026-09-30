import { useEffect, useState } from 'react';
import { useT } from '../../lib/i18n';
import { toF95PreviewUrl } from '../../lib/f95ImageUrl';
import { prefetchRemoteImage } from '../../lib/remoteImageQueue';
import { LazyRemoteImage } from './LazyRemoteImage';
import '../../styles/game-description.css';

interface Props {
  images: string[];
}

export function ScreenshotGallery({ images }: Props) {
  const { t } = useT();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    if (openIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenIndex(null);
      if (e.key === 'ArrowRight') {
        setOpenIndex((i) => (i === null ? null : Math.min(images.length - 1, i + 1)));
      }
      if (e.key === 'ArrowLeft') {
        setOpenIndex((i) => (i === null ? null : Math.max(0, i - 1)));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex, images.length]);

  useEffect(() => {
    if (openIndex === null) return;
    if (openIndex + 1 < images.length) prefetchRemoteImage(images[openIndex + 1], 0);
    if (openIndex > 0) prefetchRemoteImage(images[openIndex - 1], 1);
  }, [openIndex, images]);

  if (images.length === 0) return null;

  return (
    <>
      <div className="game-detail-screenshot-grid">
        {images.map((src, i) => (
          <button
            key={`${i}-${src}`}
            type="button"
            className="game-detail-screenshot-btn"
            onClick={() => setOpenIndex(i)}
            aria-label={t('gamedetail.screenshot.open', { n: i + 1 })}
          >
            <LazyRemoteImage
              src={src}
              previewSrc={toF95PreviewUrl(src)}
              upgrade="grid"
              className="game-detail-screenshot-img"
              rootMargin="80px 0px"
            />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <div
          role="dialog"
          aria-modal
          style={lightboxStyle}
          onClick={() => setOpenIndex(null)}
        >
          <img
            src={images[openIndex]}
            alt=""
            style={lightboxImgStyle}
            decoding="async"
            onClick={(e) => e.stopPropagation()}
          />
          <div style={lightboxCountStyle}>
            {openIndex + 1} / {images.length}
          </div>
          {openIndex > 0 && (
            <button
              type="button"
              style={{ ...lightboxNavStyle, left: 16 }}
              onClick={(e) => {
                e.stopPropagation();
                setOpenIndex((i) => (i === null ? null : Math.max(0, i - 1)));
              }}
              aria-label={t('gamedetail.screenshot.prev')}
            >
              ‹
            </button>
          )}
          {openIndex < images.length - 1 && (
            <button
              type="button"
              style={{ ...lightboxNavStyle, right: 16 }}
              onClick={(e) => {
                e.stopPropagation();
                setOpenIndex((i) => (i === null ? null : Math.min(images.length - 1, i + 1)));
              }}
              aria-label={t('gamedetail.screenshot.next')}
            >
              ›
            </button>
          )}
        </div>
      )}
    </>
  );
}

const lightboxStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.92)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'zoom-out',
};

const lightboxImgStyle: React.CSSProperties = {
  maxWidth: '92vw',
  maxHeight: '92vh',
  objectFit: 'contain',
  cursor: 'default',
};

const lightboxCountStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  color: '#ddd',
  fontSize: 13,
  background: 'rgba(0,0,0,0.6)',
  padding: '4px 10px',
  borderRadius: 2,
};

const lightboxNavStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'rgba(0,0,0,0.55)',
  color: 'var(--text-primary)',
  border: 'none',
  width: 44,
  height: 56,
  borderRadius: 4,
  fontSize: 28,
  cursor: 'pointer',
};
