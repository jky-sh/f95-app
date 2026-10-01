import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useContextMenu } from '../contextMenu';
import { useOffline } from '../../contexts/Offline';
import { useRssFeed } from '../../hooks/useRssFeed';
import { buildRssItemMenu } from '../../lib/contextMenus/buildRssMenu';
import { formatRelativeDate } from '../../lib/formatDate';
import { formatIpcError } from '../../lib/ipcError';
import { storePathForRssItem } from '../../lib/rssUpdates';
import { useT } from '../../lib/i18n';
import { Spinner } from '../ui/Spinner';

interface Props {
  onLoaded?: () => void;
}

const CARD_WIDTH = 200;

export function RssFeedSection({ onLoaded }: Props) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { isOffline } = useOffline();
  const { openContextMenu } = useContextMenu();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { items, loading, error, reload } = useRssFeed({ enabled: !isOffline });
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  // Once per load: when the feed arrives or fails.
  const settled = !isOffline && !loading;
  useEffect(() => {
    if (settled) onLoaded?.();
  }, [settled]);

  useEffect(() => {
    updateArrows();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      ro.disconnect();
    };
  }, [items, updateArrows]);

  const scrollBy = (dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * CARD_WIDTH * 2.2, behavior: 'smooth' });
  };

  if (isOffline) {
    return <div className="rss-rail-hint">{t('news.rss.offline')}</div>;
  }

  if (loading) {
    return (
      <div className="rss-rail-section">
        <div className="rss-rail-scroll rss-rail-scroll--loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rss-rail-card rss-rail-card--skeleton" aria-hidden />
          ))}
        </div>
        <div className="rss-rail-loading-label">
          <Spinner size="sm" />
          <span>{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  if (error != null) {
    return (
      <div className="rss-rail-error">
        {t('news.loadFailed', { error: formatIpcError(error) })}
        <button type="button" onClick={() => void reload()} className="rss-rail-retry">
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return <div className="rss-rail-hint">{t('news.rss.empty')}</div>;
  }

  return (
    <div
      className={`rss-rail-section${canScrollLeft ? ' rss-rail-section--fade-left' : ''}${canScrollRight ? ' rss-rail-section--fade-right' : ''}`}
    >
      <button
        type="button"
        className={`rss-rail-arrow rss-rail-arrow--left${canScrollLeft ? '' : ' rss-rail-arrow--hidden'}`}
        aria-label={t('news.rss.scrollLeft')}
        onClick={() => scrollBy(-1)}
      >
        <IconChevron dir="left" />
      </button>

      <div ref={scrollRef} className="rss-rail-scroll">
        {items.map((item) => {
          const storePath = storePathForRssItem(item);
          return (
            <Link
              key={item.guid}
              to={storePath}
              className="rss-rail-card"
              onContextMenu={(e) =>
                openContextMenu(
                  e,
                  buildRssItemMenu(item.link, storePath, {
                    isOffline,
                    t,
                    navigate: (path) => navigate(path),
                  }),
                )
              }
            >
              <div className="rss-rail-poster">
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt="" className="rss-rail-poster-img" loading="lazy" />
                ) : (
                  <div className="rss-rail-poster-fallback">
                    {item.displayTitle.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="rss-rail-poster-shade" />
                <span
                  className={`rss-rail-badge rss-rail-badge--${item.kind === 'new' ? 'new' : 'update'}`}
                >
                  {item.kind === 'new' ? t('news.rss.badge.new') : t('news.rss.badge.update')}
                </span>
                {item.version && <span className="rss-rail-version">{item.version}</span>}
                <div className="rss-rail-poster-info">
                  <div className="rss-rail-poster-title" title={item.displayTitle}>
                    {item.displayTitle}
                  </div>
                  <div className="rss-rail-poster-meta">
                    {item.creator && <span className="rss-rail-creator">{item.creator}</span>}
                    {item.pubDate && (
                      <span className="rss-rail-date">
                        {formatRelativeDate(item.pubDate, locale) ?? item.pubDate}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <button
        type="button"
        className={`rss-rail-arrow rss-rail-arrow--right${canScrollRight ? '' : ' rss-rail-arrow--hidden'}`}
        aria-label={t('news.rss.scrollRight')}
        onClick={() => scrollBy(1)}
      >
        <IconChevron dir="right" />
      </button>
    </div>
  );
}

function IconChevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      {dir === 'left' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}
