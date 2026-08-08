import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useNotifications } from '../contexts/Notifications';
import { useOffline } from '../contexts/Offline';
import { formatRelativeDate } from '../lib/formatDate';
import { useT } from '../lib/i18n';
import { extractThreadIdFromUrl } from '../lib/rssUpdates';

interface NotificationBellProps {
  /**
   * Where the panel opens relative to the button. `side` (default) suits the
   * left sidebar; `below` suits the Steam top nav, dropping the panel under
   * the bell aligned to its right edge.
   */
  placement?: 'side' | 'below';
}

export function NotificationBell({ placement = 'side' }: NotificationBellProps) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { isOffline } = useOffline();
  const { unified, unreadCount, loading, refresh, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const panelWidth = 360;
    const gap = 8;

    if (placement === 'below') {
      const top = rect.bottom + gap;
      const left = Math.max(12, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 12));
      setPanelPos({ top, left });
      return;
    }

    let left = rect.right + gap;
    const top = rect.top;

    if (left + panelWidth > window.innerWidth - 12) {
      left = Math.max(12, rect.left - panelWidth - gap);
    }

    setPanelPos({ top, left });
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const preview = unified.slice(0, 10);

  const panel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            className="notification-panel"
            style={{ top: panelPos.top, left: panelPos.left }}
            role="menu"
          >
            <div className="notification-panel-header">
              <span className="notification-panel-title">{t('notifications.title')}</span>
              {loading && <span className="notification-panel-loading">{t('common.loading')}</span>}
            </div>

            {preview.length === 0 ? (
              <div className="notification-panel-empty">{t('notifications.empty')}</div>
            ) : (
              <ul className="notification-panel-list">
                {preview.map((entry) => {
                  if (entry.kind === 'local') {
                    const n = entry.notification;
                    const isUnread = !n.readAt;
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          className={`notification-item${isUnread ? ' notification-item--unread' : ''}`}
                          onClick={() => {
                            void markRead(n.id, 'local');
                            setOpen(false);
                            if (n.url?.startsWith('/')) navigate(n.url);
                            else if (n.threadId) navigate(`/store/game/${n.threadId}?cat=games`);
                          }}
                        >
                          {n.thumbnailUrl ? (
                            <img src={n.thumbnailUrl} alt="" className="notification-item-thumb" />
                          ) : (
                            <div className="notification-item-avatar" style={{ background: 'var(--bg-sunken)' }} />
                          )}
                          <div className="notification-item-body">
                            <div className="notification-item-source">
                              {t('notifications.source.library')}
                            </div>
                            <div className="notification-item-text">{n.title}</div>
                            {n.body && <div className="notification-item-meta">{n.body}</div>}
                          </div>
                        </button>
                      </li>
                    );
                  }

                  const a = entry.alert;
                  const threadId = extractThreadIdFromUrl(a.url);
                  return (
                    <li key={a.alertId}>
                      <button
                        type="button"
                        className={`notification-item${a.isUnread ? ' notification-item--unread' : ''}`}
                        onClick={() => {
                          void markRead(a.alertId, 'f95');
                          setOpen(false);
                          if (threadId) navigate(`/store/game/${threadId}?cat=games`);
                          else if (a.url) void openUrl(a.url);
                        }}
                      >
                        {a.avatarUrl ? (
                          <img src={a.avatarUrl} alt="" className="notification-item-avatar" />
                        ) : (
                          <div className="notification-item-avatar" style={{ background: 'var(--bg-sunken)' }} />
                        )}
                        <div className="notification-item-body">
                          <div className="notification-item-source">{t('notifications.source.f95')}</div>
                          <div className="notification-item-text">{a.text}</div>
                          {a.date && (
                            <div className="notification-item-meta">
                              {formatRelativeDate(a.date, locale) ?? a.date}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="notification-panel-footer">
              <Link
                to="/alerts"
                className="notification-panel-footer-link"
                onClick={() => setOpen(false)}
              >
                {t('notifications.viewAll')}
              </Link>
              {isOffline && <span style={{ fontSize: 10, color: 'var(--status-warning)' }}>{t('offline.badge')}</span>}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="notification-bell-root">
      <button
        ref={btnRef}
        type="button"
        aria-label={t('notifications.title')}
        aria-expanded={open}
        title={t('notifications.title')}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void refresh();
        }}
        className={`notification-bell-btn${open ? ' notification-bell-btn--open' : ''}`}
      >
        <IconBell />
        {unreadCount > 0 && (
          <span className="notification-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>
      {panel}
    </div>
  );
}

function IconBell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}
