import { NavLink } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import { useSectionHref } from '../lib/lastSearch';
import { useNavCounts } from '../hooks/useNavCounts';
import type { ProfileDto } from '../types';

interface Props {
  profile: ProfileDto;
}

interface NavItem {
  to: string;
  key: string; // i18n key for the label
  icon: React.ReactNode;
}

interface NavSection {
  titleKey: string;
  items: NavItem[];
}

// Steam-like grouping: Discover (browsing the catalog), My games (your
// own collection + activity), Account (you + app settings). Keeps the
// most-used pages near the top of each group.
const NAV_SECTIONS: NavSection[] = [
  {
    titleKey: 'nav.section.discover',
    items: [
      { to: '/store', key: 'nav.store', icon: <IconStore /> },
      { to: '/news', key: 'nav.news', icon: <IconNews /> },
      { to: '/friends', key: 'nav.friends', icon: <IconFriends /> },
    ],
  },
  {
    titleKey: 'nav.section.library',
    items: [
      { to: '/library', key: 'nav.library', icon: <IconLibrary /> },
      { to: '/downloads', key: 'nav.downloads', icon: <IconDownload /> },
    ],
  },
  {
    titleKey: 'nav.section.account',
    items: [
      { to: '/profile', key: 'nav.profile', icon: <IconProfile /> },
      { to: '/alerts', key: 'nav.alerts', icon: <IconAlerts /> },
      { to: '/settings', key: 'nav.settings', icon: <IconSettings /> },
    ],
  },
];

export function Sidebar({ profile }: Props) {
  const { t } = useT();
  const { isOffline } = useOffline();
  // Store and library links reopen those lists with the filters they were left with.
  const sectionHref: Record<string, string> = {
    '/store': useSectionHref('/store'),
    '/library': useSectionHref('/library'),
  };
  // Work waiting for the user: downloads in progress, games with an update.
  const counts = useNavCounts();
  const navCount: Record<string, { n: number; tone: 'accent' | 'info'; title: string } | undefined> = {
    '/downloads': counts.downloads
      ? { n: counts.downloads, tone: 'accent', title: t('nav.count.downloads', { count: counts.downloads }) }
      : undefined,
    '/library': counts.updates
      ? { n: counts.updates, tone: 'info', title: t('nav.count.updates', { count: counts.updates }) }
      : undefined,
  };
  return (
    <aside style={sidebarStyle} className="app-sidebar">
      <div style={userBoxStyle}>
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt={profile.username} style={avatarStyle} />
        ) : (
          <div style={avatarFallbackStyle}>{profile.username.charAt(0).toUpperCase()}</div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={usernameStyle}>{profile.username}</div>
          <div
            style={{
              ...statusStyle,
              color: isOffline ? 'var(--status-warning)' : 'var(--status-success)',
            }}
          >
            <span
              style={{
                ...statusDotStyle,
                background: isOffline ? 'var(--status-warning)' : 'var(--status-success)',
                boxShadow: isOffline
                  ? '0 0 6px var(--status-warning)'
                  : '0 0 6px var(--status-success)',
              }}
            />{' '}
            {isOffline ? t('nav.offline') : t('nav.online')}
          </div>
        </div>
        <NotificationBell />
      </div>

      <nav style={navStyle}>
        {NAV_SECTIONS.map((section, sectionIdx) => (
          <div key={section.titleKey} style={sectionStyle(sectionIdx === 0)}>
            <div style={sectionTitleStyle}>{t(section.titleKey)}</div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={sectionHref[item.to] ?? item.to}
                style={({ isActive }) => ({
                  ...navLinkStyle,
                  ...(isActive ? navLinkActiveStyle : {}),
                })}
                className="sidebar-link"
              >
                <span style={navIconStyle}>{item.icon}</span>
                <span>{t(item.key)}</span>
                {navCount[item.to] && (
                  <span
                    className={`nav-count nav-count--${navCount[item.to]!.tone}`}
                    title={navCount[item.to]!.title}
                  >
                    {navCount[item.to]!.n}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function IconStore() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

function IconLibrary() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="18" rx="1" />
      <rect x="14" y="3" width="7" height="11" rx="1" />
      <path d="M14 17h7v4h-7z" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12" />
      <path d="M6 11l6 6 6-6" />
      <path d="M5 21h14" />
    </svg>
  );
}

function IconNews() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M7 8h10M7 12h10M7 16h6" />
    </svg>
  );
}

function IconFriends() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" />
      <circle cx="17" cy="6" r="2.5" />
      <path d="M17 11c2.5 0 5 1.5 5 4.5" />
    </svg>
  );
}

function IconAlerts() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.5 4-7 8-7s8 2.5 8 7" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}

const sidebarStyle: React.CSSProperties = {
  width: 220,
  flexShrink: 0,
  background: 'var(--bg-sidebar)',
  borderRight: '1px solid var(--border-faint)',
  display: 'flex',
  flexDirection: 'column',
  // Was `height: 100vh` when the title bar was the OS chrome; now the
  // sidebar sits inside a flex body that already constrains its height.
  height: '100%',
};

const userBoxStyle: React.CSSProperties = {
  padding: '14px 16px',
  borderBottom: '1px solid var(--border-faint)',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const avatarStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: '50%',
  objectFit: 'cover',
  background: 'var(--border)',
  border: '2px solid var(--border)',
};

const avatarFallbackStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: '50%',
  background: 'var(--bg-elevated)',
  border: '2px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  color: 'var(--text-muted)',
  fontWeight: 700,
};

const usernameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const statusStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--status-success)',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  marginTop: 2,
};

const statusDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'var(--status-success)',
  display: 'inline-block',
  boxShadow: '0 0 6px var(--status-success)',
};

const navStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '4px 0 16px',
  flex: 1,
  overflowY: 'auto',
};

const sectionStyle = (first: boolean): React.CSSProperties => ({
  padding: '0',
  marginTop: first ? 12 : 18,
  display: 'flex',
  flexDirection: 'column',
});

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: 'var(--text-faint)',
  textTransform: 'uppercase',
  letterSpacing: 1.4,
  padding: '0 18px',
  marginBottom: 6,
};

const navLinkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text-tertiary)',
  textDecoration: 'none',
  borderLeft: '3px solid transparent',
  transition: 'background 0.1s ease, color 0.1s ease, border-color 0.1s ease',
};

const navLinkActiveStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  background: 'var(--bg-elevated)',
  borderLeft: '3px solid var(--accent)',
  fontWeight: 700,
};

const navIconStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
};
