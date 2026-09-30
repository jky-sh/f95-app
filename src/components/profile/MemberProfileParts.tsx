import { useNavigate } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useT } from '../../lib/i18n';
import { activityRoute } from '../../lib/memberLinks';
import { formatDay, formatWhen, lastSeenLabel, presenceOf } from '../../lib/memberPresence';
import type { ActivityItem, MemberHeaderFields } from '../../types';
import { Spinner } from '../ui/Spinner';

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

/** "Staff" / "Mod" pills next to a member name. */
export function MemberRoleBadges({
  isStaff,
  isModerator,
}: {
  isStaff: boolean;
  isModerator: boolean;
}) {
  const { t } = useT();
  if (!isStaff && !isModerator) return null;
  return (
    <span className="member-role-badges">
      {isStaff && <span className="member-role-badge member-role-badge--staff">{t('social.role.staff')}</span>}
      {isModerator && <span className="member-role-badge member-role-badge--mod">{t('social.role.mod')}</span>}
    </span>
  );
}

export function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

export type MemberHeroData = Pick<
  MemberHeaderFields,
  | 'avatarUrl'
  | 'coverUrl'
  | 'coverPositionY'
  | 'banners'
  | 'customTitle'
  | 'location'
  | 'isStaff'
  | 'isModerator'
  | 'joinedAt'
  | 'joinedAtTs'
  | 'lastSeen'
  | 'lastSeenTs'
> & { username: string };

/** Cover, avatar with presence, name, banners, title/location and dates. */
export function MemberHero({
  member,
  now,
  actions,
}: {
  member: MemberHeroData;
  now: number;
  actions?: React.ReactNode;
}) {
  const { t, locale } = useT();
  const presence = presenceOf(member.lastSeenTs, now);
  const seen =
    lastSeenLabel(member.lastSeenTs, t, locale, now) ??
    (member.lastSeen ? `${t('profile.field.lastSeen')}: ${member.lastSeen}` : null);
  const joined = member.joinedAtTs ? formatDay(member.joinedAtTs, locale) : member.joinedAt;
  const exact = (ts: number | null) => (ts ? new Date(ts).toLocaleString(locale) : undefined);

  return (
    <div className="member-hero">
      <div
        className={`member-hero-cover${member.coverUrl ? '' : ' member-hero-cover--empty'}`}
        style={
          member.coverUrl
            ? {
                backgroundImage: `url("${member.coverUrl}")`,
                backgroundPositionY: `${member.coverPositionY ?? 50}%`,
              }
            : undefined
        }
      />
      <div className="member-hero-main">
        <div className="member-hero-avatar-wrap">
          <MemberAvatar src={member.avatarUrl} username={member.username} className="member-hero-avatar" />
          {presence === 'online' && <span className="presence-dot presence-dot--lg" />}
        </div>

        <div className="member-hero-body">
          <div className="member-hero-name-row">
            <h1 className="member-hero-name">{member.username}</h1>
            {member.banners.length === 0 && (
              <MemberRoleBadges isStaff={member.isStaff} isModerator={member.isModerator} />
            )}
          </div>
          {member.banners.length > 0 && (
            <div className="member-hero-banners">
              {member.banners.map((b) => (
                <span key={b} className="member-hero-banner">
                  {b}
                </span>
              ))}
            </div>
          )}
          {(member.customTitle || member.location) && (
            <div className="member-hero-subtitle">
              {member.customTitle && <span>{member.customTitle}</span>}
              {member.location && (
                <span className="member-hero-location">
                  <PinIcon />
                  {member.location}
                </span>
              )}
            </div>
          )}
          <div className="member-hero-meta">
            {seen && (
              <span
                className={`member-hero-presence member-hero-presence--${presence}`}
                title={exact(member.lastSeenTs)}
              >
                {seen}
              </span>
            )}
            {joined && (
              <span title={exact(member.joinedAtTs)}>{t('profile.memberSince', { date: joined })}</span>
            )}
          </div>
        </div>

        {actions && <div className="member-hero-actions">{actions}</div>}
      </div>
    </div>
  );
}

export interface MemberStat {
  label: string;
  value: string | number | null;
}

export function MemberStatsRow({ stats }: { stats: MemberStat[] }) {
  const { locale } = useT();
  return (
    <div className="member-stats">
      {stats.map((s) => (
        <div key={s.label} className="member-stat">
          <div className="member-stat-value">
            {s.value === null
              ? '—'
              : typeof s.value === 'number'
                ? s.value.toLocaleString(locale)
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

/** Tabbed section (Activity / Postings / About). */
export function MemberTabs<T extends string>({
  tabs,
  active,
  onChange,
  children,
}: {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="member-section member-tabs">
      <div className="member-tabs-bar" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            className={`member-tab${tab.id === active ? ' is-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{children}</div>
    </section>
  );
}

type TabBodyState<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: T };

/** Loading / error / content switch for a lazily loaded tab. */
export function MemberTabBody<T>({
  state,
  onRetry,
  children,
}: {
  state: TabBodyState<T>;
  onRetry: () => void;
  children: (data: T) => React.ReactNode;
}) {
  const { t } = useT();
  if (state.kind === 'ready') return <>{children(state.data)}</>;
  if (state.kind === 'error') {
    return (
      <div className="member-tab-status">
        <div>{t('profile.tab.loadFailed', { error: state.message })}</div>
        <button type="button" className="member-btn member-tab-retry" onClick={onRetry}>
          {t('common.refresh')}
        </button>
      </div>
    );
  }
  return (
    <div className="member-tab-status">
      <Spinner size="sm" />
    </div>
  );
}

export function MemberActivityList({ items, now }: { items: ActivityItem[]; now: number }) {
  const { t, locale } = useT();
  const navigate = useNavigate();

  if (items.length === 0) {
    return <div className="member-activity-empty">{t('profile.activity.empty')}</div>;
  }

  function onOpen(item: ActivityItem) {
    if (!item.url) return;
    // Threads open in-app on the store page and members on their profile;
    // anything else (posts, profile comments…) goes to the browser.
    const route = activityRoute(item.url);
    if (route) navigate(route);
    else void openUrl(item.url);
  }

  return (
    <ul className="member-activity-list">
      {items.map((item, idx) => {
        const when = item.dateTs ? formatWhen(item.dateTs, locale, now) : item.date;
        return (
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
                {(when || item.meta) && (
                  <div className="member-activity-foot">
                    {when && (
                      <span title={item.dateTs ? new Date(item.dateTs).toLocaleString(locale) : undefined}>
                        {when}
                      </span>
                    )}
                    {item.meta && <span className="member-activity-meta">{item.meta}</span>}
                  </div>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
