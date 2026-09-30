import { useMemo } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useThreadPosts, useThreadReviews, type ThreadFeed } from '../../hooks/useThreadCommunity';
import { useT } from '../../lib/i18n';
import { describeIpcError } from '../../lib/ipcError';
import { formatWhen } from '../../lib/memberPresence';
import type { Reactions, ThreadAuthor, ThreadPost, ThreadReview } from '../../types/game';
import { Icon } from '../ui/Icon';
import { sanitizeF95Html, useF95ContentLinks } from './StoreDetailSections';

/**
 * The thread's discussion, newest posts first, with older pages on demand.
 * Links open members and threads in the app and the rest in the browser.
 */
export function ThreadDiscussion({ threadId, threadUrl }: { threadId: string; threadUrl: string }) {
  const { t } = useT();
  const feed = useThreadPosts(threadId, true);
  const onContentClick = useF95ContentLinks();
  const oldest = feed.pages.length ? Math.min(...feed.pages) : 0;
  return (
    <section className="community" onClick={onContentClick}>
      <header className="community-head">
        <p className="community-hint">
          {feed.totalPages > 0
            ? t('community.discussion.hint', { page: oldest.toLocaleString(), total: feed.totalPages.toLocaleString() })
            : t('community.discussion.hintLoading')}
        </p>
        <OpenOnF95 href={`${threadUrl.replace(/\/$/, '')}/latest`} />
      </header>
      <Feed
        feed={feed}
        empty={t('community.discussion.empty')}
        more={t('community.discussion.loadOlder')}
        render={(post) => <PostCard key={post.id} post={post} />}
      />
    </section>
  );
}

/** The thread's reviews with its average rating, newest first. */
export function ThreadReviews({
  threadId,
  threadUrl,
  rating,
  reviewCount,
}: {
  threadId: string;
  threadUrl: string;
  rating: { average: number; votes: number } | null | undefined;
  reviewCount: number | null | undefined;
}) {
  const { t } = useT();
  const feed = useThreadReviews(threadId, true);
  const onContentClick = useF95ContentLinks();
  return (
    <section className="community" onClick={onContentClick}>
      <header className="community-head">
        {rating ? (
          <div className="community-score">
            <span className="community-score-value">{rating.average.toFixed(1)}</span>
            <span>
              <Stars value={rating.average} label={t('community.reviews.stars', { count: rating.average.toFixed(1) })} />
              <span className="community-hint">
                {t('community.reviews.summary', {
                  votes: rating.votes.toLocaleString(),
                  reviews: (reviewCount ?? 0).toLocaleString(),
                })}
              </span>
            </span>
          </div>
        ) : (
          <p className="community-hint">{t('community.reviews.unrated')}</p>
        )}
        <OpenOnF95 href={`${threadUrl.replace(/\/$/, '')}/br-reviews/`} />
      </header>
      <Feed
        feed={feed}
        empty={t('community.reviews.empty')}
        more={t('community.reviews.loadMore')}
        render={(review) => <ReviewCard key={review.id} review={review} />}
      />
    </section>
  );
}

function Feed<T>({
  feed,
  empty,
  more,
  render,
}: {
  feed: ThreadFeed<T>;
  empty: string;
  more: string;
  render: (item: T) => React.ReactNode;
}) {
  const { t } = useT();
  const firstLoad = feed.pages.length === 0;
  return (
    <>
      {feed.items.length > 0 && <div className="community-list">{feed.items.map(render)}</div>}
      {firstLoad && feed.loading && <CommunitySkeleton />}
      {!feed.loading && !feed.error && !firstLoad && feed.items.length === 0 && (
        <div className="ui-empty community-empty">
          <Icon name="news" size={28} />
          <p className="ui-empty-title">{empty}</p>
        </div>
      )}
      {feed.error != null && (
        <div className="community-error" role="alert">
          <Icon name="alert" size={16} />
          <span>{describeIpcError(feed.error, t)}</span>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={feed.retry}>
            <Icon name="refresh" size={13} />
            {t('common.retry')}
          </button>
        </div>
      )}
      {!firstLoad && feed.hasMore && !feed.error && (
        <button
          type="button"
          className="ui-btn ui-btn--secondary community-more"
          onClick={feed.loadMore}
          disabled={feed.loading}
        >
          {feed.loading ? t('common.loading') : more}
        </button>
      )}
    </>
  );
}

function PostCard({ post }: { post: ThreadPost }) {
  const { t, locale } = useT();
  const html = useMemo(() => sanitizeF95Html(post.html), [post.html]);
  return (
    <article className="community-item">
      <Avatar author={post.author} />
      <div className="community-item-main">
        <header className="community-item-head">
          <AuthorName author={post.author} />
          {post.byStarter && (
            <span className="ui-badge ui-badge--info" title={t('community.post.starterTitle')}>
              {t('community.post.starter')}
            </span>
          )}
          {post.author.banners.slice(0, 2).map((b) => (
            <span key={b} className="ui-badge ui-badge--muted">
              {b}
            </span>
          ))}
          <span className="community-item-spacer" />
          {post.postedAt && (
            <time
              className="community-item-time"
              dateTime={new Date(post.postedAt).toISOString()}
              title={new Date(post.postedAt).toLocaleString(locale)}
            >
              {formatWhen(post.postedAt, locale)}
              {post.editedAt && ` · ${t('community.post.edited')}`}
            </time>
          )}
          <a className="community-item-number" href={post.url} title={t('community.post.open')}>
            {post.number ? `#${post.number.toLocaleString()}` : <Icon name="external" size={12} />}
          </a>
        </header>
        {post.author.title && <div className="community-item-sub">{post.author.title}</div>}
        <div className="community-body" dangerouslySetInnerHTML={{ __html: html }} />
        <ReactionLine reactions={post.reactions} label={t('community.reactions')} />
      </div>
    </article>
  );
}

function ReviewCard({ review }: { review: ThreadReview }) {
  const { t, locale } = useT();
  const html = useMemo(() => sanitizeF95Html(review.html), [review.html]);
  return (
    <article className="community-item">
      <Avatar author={review.author} />
      <div className="community-item-main">
        <header className="community-item-head">
          <AuthorName author={review.author} />
          <Stars value={review.rating} small label={t('community.reviews.stars', { count: review.rating })} />
          <span className="community-item-spacer" />
          {review.postedAt && (
            <time
              className="community-item-time"
              dateTime={new Date(review.postedAt).toISOString()}
              title={new Date(review.postedAt).toLocaleString(locale)}
            >
              {formatWhen(review.postedAt, locale)}
            </time>
          )}
        </header>
        <div className="community-body" dangerouslySetInnerHTML={{ __html: html }} />
        <ReactionLine reactions={review.likes} label={t('community.likes')} />
      </div>
    </article>
  );
}

function Avatar({ author }: { author: ThreadAuthor }) {
  if (author.avatarUrl) {
    return <img className="community-avatar" src={author.avatarUrl} alt="" loading="lazy" draggable={false} />;
  }
  return (
    <span className="community-avatar community-avatar--letter" style={{ background: letterColor(author.name) }} aria-hidden>
      {author.avatarLetter ?? author.name.charAt(0).toUpperCase()}
    </span>
  );
}

function AuthorName({ author }: { author: ThreadAuthor }) {
  // Member links open the in-app profile (useF95ContentLinks on the list).
  return author.profileUrl ? (
    <a className="community-item-author" href={author.profileUrl}>
      {author.name}
    </a>
  ) : (
    <span className="community-item-author">{author.name}</span>
  );
}

/** Heart and count; the names F95 shows are in the tooltip. */
function ReactionLine({ reactions, label }: { reactions: Reactions; label: string }) {
  if (reactions.count === 0) return null;
  const rest = reactions.count - reactions.names.length;
  const who = [reactions.names.join(', '), rest > 0 ? `+${rest.toLocaleString()}` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="community-reactions" title={who} aria-label={`${label}: ${reactions.count}`}>
      <Icon name="heart" size={12} />
      {reactions.count.toLocaleString()}
    </div>
  );
}

function Stars({ value, label, small = false }: { value: number; label: string; small?: boolean }) {
  return (
    <span className={`community-stars${small ? ' community-stars--small' : ''}`} role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => {
        // Each star fills by the part of the rating it covers (3.9 → 1, 1, 1, 0.9, 0).
        const fill = Math.max(0, Math.min(1, value - (n - 1)));
        return (
          <span key={n} className="community-star">
            <Icon name="star" size={small ? 13 : 16} />
            {fill > 0 && (
              <span className="community-star-fill" style={{ width: `${fill * 100}%` }}>
                <Icon name="star" size={small ? 13 : 16} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** F95's own page in the browser: as a thread link it would reopen this page in the app. */
function OpenOnF95({ href }: { href: string }) {
  const { t } = useT();
  return (
    <a
      className="ui-btn ui-btn--ghost ui-btn--sm"
      href={href}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void openUrl(href);
      }}
    >
      <Icon name="external" size={13} />
      {t('community.openOnF95')}
    </a>
  );
}

function CommunitySkeleton() {
  return (
    <div className="community-list" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="community-item community-item--skeleton">
          <span className="community-avatar skeleton" />
          <div className="community-item-main">
            <span className="skeleton community-skeleton-line" style={{ width: '30%' }} />
            <span className="skeleton community-skeleton-line" style={{ width: '92%' }} />
            <span className="skeleton community-skeleton-line" style={{ width: '70%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A stable muted color per member, like F95's default avatars. */
function letterColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 38%)`;
}
