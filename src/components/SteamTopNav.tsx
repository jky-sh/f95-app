import { NavLink } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import type { ProfileDto } from '../types';

interface Props {
  profile: ProfileDto;
}

/**
 * Steam-style horizontal header nav, rendered by AppShell instead of the
 * left sidebar when the Steam skin is active. Mirrors the Steam client
 * chrome: big uppercase section links on the left (STORE / LIBRARY / ...)
 * and utility icons + avatar on the right. All styling lives in
 * `styles/steam-skin.css` under the `data-skin='steam'` scope.
 */
export function SteamTopNav({ profile }: Props) {
  const { t } = useT();
  const { isOffline } = useOffline();

  return (
    <nav className="steam-topnav">
      <div className="steam-topnav-links">
        <NavLink to="/store" className="steam-topnav-link">
          {t('nav.store')}
        </NavLink>
        <NavLink to="/library" className="steam-topnav-link">
          {t('nav.library')}
        </NavLink>
        <NavLink to="/news" className="steam-topnav-link">
          {t('nav.news')}
        </NavLink>
        <NavLink to="/friends" className="steam-topnav-link">
          {t('nav.friends')}
        </NavLink>
      </div>

      <div className="steam-topnav-side">
        <NavLink
          to="/downloads"
          className="steam-topnav-icon"
          title={t('nav.downloads')}
          aria-label={t('nav.downloads')}
        >
          <IconDownload />
        </NavLink>
        <NotificationBell placement="below" />
        <NavLink
          to="/settings"
          className="steam-topnav-icon"
          title={t('nav.settings')}
          aria-label={t('nav.settings')}
        >
          <IconSettings />
        </NavLink>

        <NavLink to="/profile" className="steam-topnav-user" title={t('nav.profile')}>
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.username}
              className={`steam-topnav-avatar${isOffline ? ' steam-topnav-avatar--offline' : ''}`}
            />
          ) : (
            <span
              className={`steam-topnav-avatar steam-topnav-avatar-fallback${
                isOffline ? ' steam-topnav-avatar--offline' : ''
              }`}
            >
              {profile.username.charAt(0).toUpperCase()}
            </span>
          )}
          <span
            className={`steam-topnav-username${isOffline ? ' steam-topnav-username--offline' : ''}`}
          >
            {profile.username}
          </span>
        </NavLink>
      </div>
    </nav>
  );
}

function IconDownload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12" />
      <path d="M6 11l6 6 6-6" />
      <path d="M5 21h14" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}
