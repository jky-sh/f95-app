import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDownloads } from '../../contexts/Downloads';
import { useNotifications } from '../../contexts/Notifications';
import { useOffline } from '../../contexts/Offline';
import { useRunningGames } from '../../contexts/RunningGames';
import { useFriendsOnline } from '../../hooks/useFriendsOnline';
import { useNavCounts } from '../../hooks/useNavCounts';
import { useNow } from '../../hooks/useNow';
import { appUpdateOffer, installLabel, useAppUpdate } from '../../lib/appUpdateState';
import { installAppUpdate } from '../../lib/appUpdater';
import { useT } from '../../lib/i18n';
import type { ContextMenuItem } from '../contextMenu/types';
import { LibraryCover } from '../library/LibraryCover';
import { Icon, type IconName } from '../ui/Icon';
import type { ProfileDto } from '../../types';
import { BP_TABS, useBp, useBpGames, type BpSheetSpec, type BpTab } from './BpContext';
import { useInputMethod } from './bpInput';
import { BpGlyph } from './BpGlyph';
import { BpMark } from './BpLogo';
import { formatElapsed, useProgressiveArt } from './BpParts';

const TAB_LABEL: Record<BpTab, string> = {
  home: 'bp.tab.home',
  library: 'bp.tab.library',
  store: 'bp.tab.store',
  news: 'bp.tab.news',
  friends: 'bp.tab.friends',
  downloads: 'bp.tab.downloads',
};

const TAB_ICON: Record<BpTab, IconName> = {
  home: 'home',
  library: 'library',
  store: 'store',
  news: 'news',
  friends: 'users',
  downloads: 'download',
};

/**
 * A member's picture, or their initial. `size` is in pixels; null leaves it
 * to the stylesheet (lists sized with the rest of Big Picture).
 */
export function BpAvatar({
  profile,
  size = 36,
  className,
}: {
  profile: Pick<ProfileDto, 'avatarUrl' | 'username'>;
  size?: number | null;
  className?: string;
}) {
  // A picture F95 no longer serves falls back to the initial.
  const [failed, setFailed] = useState<string | null>(null);
  const style = size == null ? undefined : { width: size, height: size };
  const cls = className ? `bp-avatar ${className}` : 'bp-avatar';
  return profile.avatarUrl && failed !== profile.avatarUrl ? (
    <img className={cls} src={profile.avatarUrl} alt="" style={style} onError={() => setFailed(profile.avatarUrl)} />
  ) : (
    <span className={`${cls} bp-avatar--letter`} style={style}>
      {profile.username.charAt(0).toUpperCase()}
    </span>
  );
}

/** Unread alerts and notifications, on the News tab. */
function NewsCount() {
  const { t } = useT();
  const { unreadCount } = useNotifications();
  if (unreadCount <= 0) return null;
  return (
    <span className="bp-count bp-count--accent" title={t('notifications.unreadCount', { count: unreadCount })}>
      {unreadCount > 99 ? '99+' : unreadCount}
    </span>
  );
}

/** Followed members online, on the Friends tab (saved data, nothing fetched). */
function FriendsCount({ ownerId }: { ownerId: string }) {
  const { t } = useT();
  const online = useFriendsOnline(ownerId);
  if (online <= 0) return null;
  return (
    <span className="bp-count bp-count--online" title={t('friends.onlineCount', { count: online })}>
      {online}
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* Top bar                                                                    */
/* ------------------------------------------------------------------------- */

export function BpTopBar({
  profile,
  tab,
  draggable,
  onTab,
  onSearch,
  onProfile,
  onExit,
}: {
  profile: ProfileDto;
  tab: BpTab;
  /** Windowed: empty space in the bar drags the window. */
  draggable: boolean;
  onTab: (tab: BpTab) => void;
  onSearch: () => void;
  onProfile: () => void;
  onExit: () => void;
}) {
  const { t, locale } = useT();
  const bp = useBp();
  const games = useBpGames();
  const method = useInputMethod();
  const { isOffline } = useOffline();
  const { running, startedAt } = useRunningGames();
  const counts = useNavCounts();
  const { rows, progress } = useDownloads();
  const now = useNow(1000);
  const appUpdate = useAppUpdate();
  const appOffer = appUpdateOffer(appUpdate);
  const appUpdateLabel = appUpdate.install
    ? installLabel(appUpdate.install, t)
    : appOffer
      ? t('bp.appUpdate.available', { version: appOffer.version })
      : null;

  // The underline under the active section slides between tabs. When the
  // names don't all fit beside the rest of the bar (a game running,
  // downloads, a long language), the tabs show their icons only.
  const tabsRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const measure = () => {
      tabs.removeAttribute('data-compact');
      tabs.toggleAttribute('data-compact', tabs.scrollWidth > tabs.clientWidth + 1);
      const el = tabs.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
      if (el) setIndicator({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    // Counts coming and going and the side of the bar growing resize the tabs.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(tabs);
    for (const el of tabs.querySelectorAll('.bp-tab')) observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [tab, locale, counts.downloads, counts.updates, method]);

  const playing = useMemo(() => {
    const id = [...running][0];
    if (!id) return null;
    const game = games?.find((g) => g.threadId === id);
    return { id, title: game?.title ?? id, since: startedAt[id] ?? null };
  }, [running, games, startedAt]);

  // Overall progress of what is downloading, for the ring next to the count.
  const downloadPct = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const r of rows) {
      if (r.state !== 'downloading') continue;
      const live = progress[r.id];
      const size = live?.total ?? r.bytesTotal;
      if (!size) continue;
      total += size;
      done += live?.bytes ?? r.bytesDone;
    }
    return total > 0 ? Math.min(100, (done / total) * 100) : null;
  }, [rows, progress]);

  const clock = new Date(now).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  // Outside fullscreen the bar's empty space moves the window, like the title bar.
  const drag = draggable || undefined;

  return (
    <header className="bp-topbar" data-tauri-drag-region={drag}>
      <div className="bp-topbar-brand" data-tauri-drag-region={drag}>
        <BpMark />
      </div>

      <div
        className="bp-tabs"
        ref={tabsRef}
        data-bp-group="tabs"
        data-bp-row=""
        role="tablist"
        data-tauri-drag-region={drag}
      >
        {method === 'gamepad' && (
          <span className="bp-tabs-glyph">
            <BpGlyph action="prevTab" />
          </span>
        )}
        {BP_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === tab}
            data-tab={id}
            className="bp-tab bp-focusable"
            data-bp-a={t('bp.hint.open')}
            onClick={() => onTab(id)}
          >
            <Icon name={TAB_ICON[id]} size={18} />
            <span>{t(TAB_LABEL[id])}</span>
            {id === 'library' && counts.updates > 0 && <span className="bp-count">{counts.updates}</span>}
            {id === 'news' && <NewsCount />}
            {id === 'friends' && <FriendsCount ownerId={profile.userId ?? profile.username} />}
            {id === 'downloads' && counts.downloads > 0 && (
              <span className="bp-count bp-count--accent">{counts.downloads}</span>
            )}
          </button>
        ))}
        {method === 'gamepad' && (
          <span className="bp-tabs-glyph">
            <BpGlyph action="nextTab" />
          </span>
        )}
        {indicator && (
          <span
            className="bp-tabs-indicator"
            style={{ transform: `translateX(${indicator.x}px)`, width: indicator.w }}
            aria-hidden
          />
        )}
      </div>

      <div className="bp-topbar-side">
        {playing && (
          <button
            type="button"
            className="bp-live bp-focusable"
            data-bp-a={t('bp.hint.open')}
            onClick={() => bp.push({ screen: 'game', threadId: playing.id })}
            title={t('bp.playing', { title: playing.title })}
          >
            <span className="bp-live-dot" aria-hidden />
            <span className="bp-live-title">{playing.title}</span>
            {playing.since && <span className="bp-live-time">{formatElapsed(now - playing.since)}</span>}
          </button>
        )}
        {counts.downloads > 0 && (
          <button
            type="button"
            className="bp-icon-btn bp-focusable bp-dl-indicator"
            onClick={() => onTab('downloads')}
            aria-label={t('nav.count.downloads', { count: counts.downloads })}
            title={t('nav.count.downloads', { count: counts.downloads })}
          >
            <svg className="bp-dl-ring" viewBox="0 0 36 36" aria-hidden>
              <circle cx="18" cy="18" r="16" />
              {downloadPct != null && (
                <circle
                  cx="18"
                  cy="18"
                  r="16"
                  className="bp-dl-ring-fill"
                  strokeDasharray={`${downloadPct} 100`}
                  pathLength={100}
                />
              )}
            </svg>
            <Icon name="download" size={16} />
          </button>
        )}
        {appUpdateLabel && (
          <button
            type="button"
            className="bp-live bp-app-update bp-focusable"
            data-bp-a={t('settings.updates.install')}
            disabled={appUpdate.install != null}
            onClick={() => void installAppUpdate(t)}
            title={appUpdateLabel}
          >
            <Icon name="download" size={16} />
            <span className="bp-live-title">{appUpdateLabel}</span>
          </button>
        )}
        {isOffline && <span className="bp-offline">{t('nav.offline')}</span>}
        <button
          type="button"
          className="bp-icon-btn bp-focusable"
          onClick={onSearch}
          aria-label={t('bp.search')}
          title={t('bp.search')}
        >
          <Icon name="search" size={20} />
        </button>
        <span className="bp-clock">{clock}</span>
        <button
          type="button"
          className="bp-user bp-focusable"
          onClick={onProfile}
          aria-label={t('bp.profile')}
          title={profile.username}
        >
          <BpAvatar profile={profile} />
        </button>
        <button
          type="button"
          className="bp-icon-btn bp-focusable"
          onClick={onExit}
          aria-label={t('bp.exit')}
          title={t('bp.exit')}
        >
          <Icon name="power" size={19} />
        </button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------------- */
/* Hint bar                                                                   */
/* ------------------------------------------------------------------------- */

export function BpHintBar({
  hints,
  onMenu,
  onAccept,
  onBack,
  onOptions,
  onSearch,
}: {
  hints: { a: string | null; x: string | null };
  onMenu: () => void;
  onAccept: () => void;
  onBack: () => void;
  onOptions: () => void;
  onSearch: () => void;
}) {
  const { t } = useT();
  return (
    <footer className="bp-hints">
      <button type="button" className="bp-hint" onClick={onMenu}>
        <BpGlyph action="menu" />
        <span>{t('bp.hint.menu')}</span>
      </button>
      <div className="bp-hints-actions">
        <button type="button" className="bp-hint" onClick={onAccept}>
          <BpGlyph action="accept" />
          <span>{hints.a ?? t('bp.hint.select')}</span>
        </button>
        <button type="button" className="bp-hint" onClick={onBack}>
          <BpGlyph action="back" />
          <span>{t('bp.hint.back')}</span>
        </button>
        {hints.x && (
          <button type="button" className="bp-hint" onClick={onOptions}>
            <BpGlyph action="options" />
            <span>{hints.x}</span>
          </button>
        )}
        <button type="button" className="bp-hint" onClick={onSearch}>
          <BpGlyph action="search" />
          <span>{t('bp.hint.search')}</span>
        </button>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------------- */
/* Side menu                                                                  */
/* ------------------------------------------------------------------------- */

function MenuItem({
  icon,
  label,
  onClick,
  active,
  danger,
  trailing,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`bp-menu-item bp-focusable${danger ? ' bp-menu-item--danger' : ''}`}
      aria-current={active || undefined}
      data-bp-autofocus={active || undefined}
      onClick={onClick}
    >
      <Icon name={icon} size={20} />
      <span className="bp-menu-item-label">{label}</span>
      {trailing && <span className="bp-menu-item-trailing">{trailing}</span>}
    </button>
  );
}

export function BpMenu({
  profile,
  tab,
  fullscreen,
  onClose,
  onTab,
  onSearch,
  onProfile,
  onSettings,
  onFullscreen,
  onMinimize,
  onDesktop,
}: {
  profile: ProfileDto;
  tab: BpTab;
  fullscreen: boolean;
  onClose: () => void;
  onTab: (tab: BpTab) => void;
  onSearch: () => void;
  onProfile: () => void;
  onSettings: () => void;
  onFullscreen: () => void;
  onMinimize: () => void;
  onDesktop: () => void;
}) {
  const { t } = useT();
  const { isOffline } = useOffline();
  return (
    <div
      className="bp-layer bp-menu-layer"
      data-bp-layer=""
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="bp-menu" role="menu" aria-label={t('bp.menu')}>
        <div className="bp-menu-brand">
          <BpMark />
        </div>
        <button type="button" className="bp-menu-user bp-focusable" onClick={onProfile}>
          <BpAvatar profile={profile} size={44} />
          <span className="bp-menu-user-text">
            <span className="bp-menu-user-name">{profile.username}</span>
            <span className={`bp-menu-user-status${isOffline ? ' is-offline' : ''}`}>
              {isOffline ? t('nav.offline') : t('nav.online')}
            </span>
          </span>
        </button>
        <nav className="bp-menu-items">
          {BP_TABS.map((id) => (
            <MenuItem
              key={id}
              icon={TAB_ICON[id]}
              label={t(TAB_LABEL[id])}
              active={id === tab}
              onClick={() => onTab(id)}
            />
          ))}
          <MenuItem icon="search" label={t('bp.search')} onClick={onSearch} />
          <span className="bp-menu-sep" aria-hidden />
          <MenuItem icon="settings" label={t('bp.settings')} onClick={onSettings} />
          <MenuItem
            icon="maximize"
            label={t('bp.settings.fullscreen')}
            trailing={fullscreen ? t('bp.on') : t('bp.off')}
            onClick={onFullscreen}
          />
          <MenuItem icon="minus" label={t('bp.menu.minimize')} onClick={onMinimize} />
        </nav>
        <div className="bp-menu-foot">
          <MenuItem icon="power" label={t('bp.exit')} danger onClick={onDesktop} />
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Options sheet                                                              */
/* ------------------------------------------------------------------------- */

/** Hidden items out; no separator at an edge or next to another one. */
function visibleItems(items: ContextMenuItem[]): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  for (const item of items) {
    if (item.hidden) continue;
    if (item.separator && (out.length === 0 || out[out.length - 1].separator)) continue;
    out.push(item);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

export function BpSheet({
  spec,
  onClose,
  onPick,
}: {
  spec: BpSheetSpec;
  onClose: () => void;
  onPick: (item: ContextMenuItem) => void;
}) {
  const items = visibleItems(spec.items);
  let firstEnabled = true;
  return (
    <div
      className="bp-layer bp-sheet-layer"
      data-bp-layer=""
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bp-sheet" role="menu" aria-label={spec.title}>
        <header className="bp-sheet-head">
          <span className="bp-sheet-art">
            <LibraryCover url={spec.art ?? null} title={spec.title} quality="preview" />
          </span>
          <span className="bp-sheet-heading">
            <span className="bp-sheet-title">{spec.title}</span>
            {spec.subtitle && <span className="bp-sheet-sub">{spec.subtitle}</span>}
          </span>
        </header>
        <div className="bp-sheet-items">
          {items.map((item) => {
            if (item.separator) return <span key={item.id} className="bp-sheet-sep" aria-hidden />;
            const autofocus = firstEnabled && !item.disabled;
            if (autofocus) firstEnabled = false;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={`bp-sheet-item bp-focusable${item.danger ? ' bp-sheet-item--danger' : ''}`}
                disabled={item.disabled}
                title={item.title}
                data-bp-autofocus={autofocus || undefined}
                onClick={() => onPick(item)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Screenshot viewer                                                          */
/* ------------------------------------------------------------------------- */

export function BpViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: string[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const src = useProgressiveArt(images[index] ?? null);
  const step = (d: number) => onIndex((index + d + images.length) % images.length);
  return (
    <div
      className="bp-layer bp-viewer"
      data-bp-layer=""
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {src && <img key={index} src={src} alt="" className="bp-viewer-img" draggable={false} />}
      <div className="bp-viewer-bar">
        <button type="button" className="bp-viewer-nav" onClick={() => step(-1)} aria-label={t('bp.viewer.prev')}>
          <Icon name="chevronLeft" size={26} />
        </button>
        <span className="bp-viewer-count">
          {index + 1} / {images.length}
        </span>
        <button type="button" className="bp-viewer-nav" onClick={() => step(1)} aria-label={t('bp.viewer.next')}>
          <Icon name="chevronRight" size={26} />
        </button>
      </div>
    </div>
  );
}
