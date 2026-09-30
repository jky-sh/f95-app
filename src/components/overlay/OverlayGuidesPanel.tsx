import { useEffect, useMemo, useState } from 'react';
import { useThreadPosts } from '../../hooks/useThreadCommunity';
import { loadGameDetail, storedGameDetail } from '../../lib/gameDetailCache';
import { useT } from '../../lib/i18n';
import { formatWhen } from '../../lib/memberPresence';
import type { GameDetail } from '../../types/game';
import { sanitizeF95Html } from '../game/StoreDetailSections';
import { Icon } from '../ui/Icon';

type Section = 'guides' | 'changelog' | 'discussion';

/** Links worth having mid-game: walkthroughs, guides, mods, cheats, saves, patches. */
const GUIDE_RE = /walk\s*-?\s*through|guide|guia|tutorial|cheat|\bmods?\b|\burm\b|\bsaves?\b|save\s*file|gallery|patch|unlocker/i;

interface GuideLink {
  url: string;
  label: string;
  hint: string | null;
}

interface Props {
  threadId: string;
  enabled: boolean;
  /** Opens a link in the overlay's browser. */
  onOpenLink: (url: string) => void;
}

/**
 * The game's F95 thread without leaving the game: walkthrough, mod and
 * cheat links found in the first post, a search inside the thread, the
 * changelog, and the latest posts. Links open in the overlay's browser.
 */
export function OverlayGuidesPanel({ threadId, enabled, onOpenLink }: Props) {
  const { t } = useT();
  const [section, setSection] = useState<Section>('guides');
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('walkthrough');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setDetail(null);
    setDetailState('loading');
    void (async () => {
      // Saved details show at once (and offline); F95 is asked only when there are none.
      const stored = await storedGameDetail(threadId);
      if (cancelled) return;
      if (stored) {
        setDetail(stored);
        setDetailState('ready');
        return;
      }
      try {
        const fresh = await loadGameDetail(threadId);
        if (!cancelled) {
          setDetail(fresh);
          setDetailState('ready');
        }
      } catch {
        if (!cancelled) setDetailState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, enabled]);

  const guides = useMemo(() => (detail ? guideLinks(detail) : []), [detail]);
  const changelog = useMemo(
    () => (detail?.changelogHtml ? sanitizeF95Html(detail.changelogHtml) : ''),
    [detail?.changelogHtml],
  );

  if (!enabled) {
    return <div className="game-overlay-panel--disabled">{t('overlay.guides.disabled')}</div>;
  }

  const openFromContent = (e: React.MouseEvent) => {
    const href = (e.target as HTMLElement).closest('a')?.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    if (/^https?:/i.test(href)) onOpenLink(href);
  };

  const searchUrl = (q: string) =>
    `https://f95zone.to/search/?q=${encodeURIComponent(q.trim() || 'walkthrough')}&t=post&c[thread]=${threadId}&o=date`;

  return (
    <div className="game-overlay-guides">
      <div className="game-overlay-segmented" role="tablist" aria-label={t('overlay.tab.guides')}>
        {(['guides', 'changelog', 'discussion'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            className={section === id ? 'is-active' : undefined}
            onClick={() => setSection(id)}
          >
            {t(`overlay.guides.section.${id}`)}
          </button>
        ))}
      </div>

      <div className="game-overlay-panel-fill game-overlay-panel-fill--scroll" onClick={openFromContent}>
        {section === 'guides' && (
          <>
            <form
              className="game-overlay-guides-search"
              onSubmit={(e) => {
                e.preventDefault();
                onOpenLink(searchUrl(query));
              }}
            >
              <Icon name="search" size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('overlay.guides.searchPlaceholder')}
                aria-label={t('overlay.guides.searchPlaceholder')}
                spellCheck={false}
              />
              <button type="submit">{t('overlay.guides.searchThread')}</button>
            </form>

            {detailState === 'loading' && <p className="game-overlay-empty">{t('common.loading')}</p>}
            {detailState === 'error' && <p className="game-overlay-empty">{t('overlay.guides.detailFailed')}</p>}
            {detailState === 'ready' && guides.length === 0 && (
              <p className="game-overlay-empty">{t('overlay.guides.noLinks')}</p>
            )}
            {guides.length > 0 && (
              <ul className="game-overlay-link-list">
                {guides.map((link) => (
                  <li key={link.url}>
                    <a href={link.url}>
                      <Icon name="external" size={13} />
                      <span className="game-overlay-link-label">{link.label}</span>
                      {link.hint && <span className="game-overlay-link-hint">{link.hint}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {section === 'changelog' &&
          (changelog ? (
            <>
              {detail?.version && <p className="game-overlay-stats">{detail.version}</p>}
              <div className="game-overlay-rich" dangerouslySetInnerHTML={{ __html: changelog }} />
            </>
          ) : (
            <p className="game-overlay-empty">
              {detailState === 'loading' ? t('common.loading') : t('overlay.guides.noChangelog')}
            </p>
          ))}

        {section === 'discussion' && <OverlayDiscussion threadId={threadId} />}
      </div>
    </div>
  );
}

function OverlayDiscussion({ threadId }: { threadId: string }) {
  const { t, locale } = useT();
  const feed = useThreadPosts(threadId, true);
  return (
    <>
      {feed.items.map((post) => (
        <article key={post.id} className="game-overlay-post">
          <header className="game-overlay-post-head">
            <span className="game-overlay-post-author">{post.author.name}</span>
            {post.byStarter && <span className="game-overlay-chip">{t('community.post.starter')}</span>}
            {post.postedAt && (
              <time className="game-overlay-post-time" title={new Date(post.postedAt).toLocaleString(locale)}>
                {formatWhen(post.postedAt, locale)}
              </time>
            )}
          </header>
          <div className="game-overlay-rich" dangerouslySetInnerHTML={{ __html: sanitizeF95Html(post.html) }} />
          {post.reactions.count > 0 && (
            <span className="game-overlay-post-reactions">
              <Icon name="heart" size={11} />
              {post.reactions.count.toLocaleString()}
            </span>
          )}
        </article>
      ))}
      {feed.loading && <p className="game-overlay-empty">{t('common.loading')}</p>}
      {feed.error != null && !feed.loading && (
        <p className="game-overlay-empty">
          {t('overlay.guides.discussionFailed')}{' '}
          <button type="button" className="game-overlay-inline-btn" onClick={feed.retry}>
            {t('common.retry')}
          </button>
        </p>
      )}
      {!feed.loading && !feed.error && feed.pages.length > 0 && feed.items.length === 0 && (
        <p className="game-overlay-empty">{t('community.discussion.empty')}</p>
      )}
      {feed.hasMore && !feed.loading && !feed.error && (
        <button type="button" className="game-overlay-action game-overlay-action--block" onClick={feed.loadMore}>
          {t('community.discussion.loadOlder')}
        </button>
      )}
    </>
  );
}

/** Guide-like links from the first post: download groups, social links and the description. */
function guideLinks(detail: GameDetail): GuideLink[] {
  const out = new Map<string, GuideLink>();
  const add = (url: string, label: string, hint: string | null) => {
    if (!/^https?:/i.test(url) || out.has(url)) return;
    out.set(url, { url, label: label.trim() || url, hint });
  };
  for (const d of detail.downloads) {
    if (GUIDE_RE.test(`${d.text} ${d.group ?? ''}`)) add(d.url, d.group ? `${d.group} · ${d.text}` : d.text, d.host);
  }
  for (const s of detail.social) {
    if (GUIDE_RE.test(`${s.text} ${s.url}`)) add(s.url, s.text, s.host);
  }
  if (typeof DOMParser !== 'undefined' && detail.descriptionHtml) {
    const doc = new DOMParser().parseFromString(detail.descriptionHtml, 'text/html');
    doc.querySelectorAll('a[href]').forEach((a) => {
      const text = a.textContent ?? '';
      if (GUIDE_RE.test(text)) add(a.getAttribute('href') ?? '', text, hostOf(a.getAttribute('href') ?? ''));
    });
  }
  return [...out.values()];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
