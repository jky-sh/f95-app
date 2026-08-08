import { useNavigate } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { extractThreadIdFromUrl } from '../../lib/rssUpdates';
import { useT } from '../../lib/i18n';
import type { ActivityItem } from '../../types';

/**
 * Shared presentational pieces for member profiles — used by the user's
 * own Profile page and by friend profile pages so both share one visual
 * language. Styles live in `styles/profile.css`.
 */

export function MemberAvatar({
  src,
  username,
  className,
}: {
  src: string | null;
  username: string;
  className: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={username}
        className={className}
        onError={(e) => {
          (e.target as HTMLImageElement).style.visibility = 'hidden';
        }}
      />
    );
  }
  return (
    <div className={`${className} ${className}--fallback`}>
      {username.charAt(0).toUpperCase()}
    </div>
  );
}

interface MemberHeroProps {
  avatarUrl: string | null;
  username: string;
  userBanner: string | null;
  customTitle: string | null;
  joinedAt: string | null;
  lastSeen: string | null;
  actions?: React.ReactNode;
}

export function MemberHero({
  avatarUrl,
  username,
  userBanner,
  customTitle,
  joinedAt,
  lastSeen,
  actions,
}: MemberHeroProps) {
  const { t } = useT();
  return (
    <div className="member-hero">
      <MemberAvatar src={avatarUrl} username={username} className="member-hero-avatar" />

      <div className="member-hero-body">
        <h1 className="member-hero-name">{username}</h1>
        {userBanner && <span className="member-hero-banner">{userBanner}</span>}
        {customTitle && customTitle !== userBanner && (
          <div className="member-hero-subtitle">{customTitle}</div>
        )}

        <div className="member-hero-meta">
          {joinedAt && (
            <span>
              <span className="member-hero-meta-label">{t('profile.field.joinedAt')}:</span>
              {joinedAt}
            </span>
          )}
          {lastSeen && (
            <span>
              <span className="member-hero-meta-label">{t('profile.field.lastSeen')}:</span>
              {lastSeen}
            </span>
          )}
        </div>
      </div>

      {actions && <div className="member-hero-actions">{actions}</div>}
    </div>
  );
}

export interface MemberStat {
  label: string;
  value: string | number | null;
}

export function MemberStatsRow({ stats }: { stats: MemberStat[] }) {
  return (
    <div className="member-stats">
      {stats.map((s) => (
        <div key={s.label} className="member-stat">
          <div className="member-stat-value">
            {s.value === null
              ? '—'
              : typeof s.value === 'number'
                ? s.value.toLocaleString()
                : s.value}
          </div>
          <div className="member-stat-label">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export function MemberSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="member-section">
      <h2 className="member-section-title">{title}</h2>
      {children}
    </section>
  );
}

export function MemberActivityList({ items }: { items: ActivityItem[] }) {
  const { t } = useT();
  const navigate = useNavigate();

  if (items.length === 0) {
    return <div className="member-activity-empty">{t('profile.activity.empty')}</div>;
  }

  function onOpen(item: ActivityItem) {
    if (!item.url) return;
    // Threads open in-app on the store game page; anything else (posts,
    // profile comments...) goes to the browser.
    const threadId = extractThreadIdFromUrl(item.url);
    if (threadId) navigate(`/store/game/${threadId}?cat=games`);
    else void openUrl(item.url);
  }

  return (
    <ul className="member-activity-list">
      {items.map((item, idx) => (
        <li key={idx}>
          <button
            type="button"
            className={`member-activity-row${item.url ? '' : ' member-activity-row--static'}`}
            onClick={() => onOpen(item)}
            disabled={!item.url}
          >
            <MemberAvatar
              src={item.avatarUrl}
              username={item.title}
              className="member-activity-avatar"
            />
            <div className="member-activity-body">
              <div className="member-activity-title">{item.title}</div>
              {item.snippet && <div className="member-activity-snippet">{item.snippet}</div>}
              {item.date && <div className="member-activity-date">{item.date}</div>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MemberAboutList({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="member-about">
      {rows.map(([k, v]) => (
        <div key={k} className="member-about-row">
          <dt className="member-about-key">{k}</dt>
          <dd className="member-about-val">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
