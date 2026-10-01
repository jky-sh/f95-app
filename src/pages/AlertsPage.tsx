import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import * as ipc from '../lib/ipc';
import { alertInitial, cleanAlertText } from '../lib/alertText';
import { useNotifications } from '../contexts/Notifications';
import { useOffline } from '../contexts/Offline';
import {
  formatRelativeDate,
  getDateGroup,
  sortDateGroups,
  type DateGroup,
} from '../lib/formatDate';
import { localSourceLabelKey, openLocalNotification } from '../lib/notificationLinks';
import { extractThreadIdFromUrl } from '../lib/rssUpdates';
import { useT } from '../lib/i18n';
import { Spinner } from '../components/ui/Spinner';
import type { AppNotification, F95Alert } from '../types/alerts';

type Filter = 'all' | 'f95' | 'library';

type AlertEntry =
  | { kind: 'f95'; alert: F95Alert; sortKey: string; dateGroup: DateGroup }
  | { kind: 'local'; notification: AppNotification; sortKey: string; dateGroup: DateGroup };

export function AlertsPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { isOffline } = useOffline();
  const {
    localNotifications,
    f95UnreadCount,
    localUnreadCount,
    markRead,
    markAllRead,
    refresh,
  } = useNotifications();
  const [filter, setFilter] = useState<Filter>('all');
  const [f95List, setF95List] = useState<F95Alert[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadF95 = useCallback(
    async (pageNum: number, append: boolean) => {
      if (isOffline) {
        setF95List([]);
        setHasMore(false);
        return;
      }
      const result = await ipc.fetchAlertsList(pageNum);
      setF95List((prev) => (append ? [...prev, ...result.alerts] : result.alerts));
      setHasMore(result.hasMore);
      setPage(result.page);
    },
    [isOffline],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadF95(1, false), refresh()]);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : String(err),
      );
    } finally {
      setLoading(false);
    }
  }, [loadF95, refresh]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = async () => {
    if (!hasMore || loadingMore || isOffline) return;
    setLoadingMore(true);
    try {
      await loadF95(page + 1, true);
    } catch (err) {
      console.warn('[alerts] load more failed', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const unreadInView = useMemo(() => {
    if (filter === 'library') return localUnreadCount;
    if (filter === 'f95') return f95UnreadCount;
    return f95UnreadCount + localUnreadCount;
  }, [filter, f95UnreadCount, localUnreadCount]);

  const groupedEntries = useMemo(() => {
    const list: AlertEntry[] = [];
    if (filter === 'all' || filter === 'library') {
      for (const n of localNotifications) {
        list.push({
          kind: 'local',
          notification: n,
          sortKey: n.createdAt,
          dateGroup: getDateGroup(n.createdAt),
        });
      }
    }
    if (filter === 'all' || filter === 'f95') {
      for (const a of f95List) {
        list.push({
          kind: 'f95',
          alert: a,
          sortKey: a.date ?? '',
          dateGroup: getDateGroup(a.date),
        });
      }
    }
    list.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

    const groups = new Map<DateGroup, AlertEntry[]>();
    for (const entry of list) {
      const bucket = groups.get(entry.dateGroup) ?? [];
      bucket.push(entry);
      groups.set(entry.dateGroup, bucket);
    }

    return [...groups.entries()].sort(([a], [b]) => sortDateGroups(a, b));
  }, [filter, localNotifications, f95List]);

  const tabCounts = useMemo(
    () => ({
      all: f95UnreadCount + localUnreadCount,
      f95: f95UnreadCount,
      library: localUnreadCount,
    }),
    [f95UnreadCount, localUnreadCount],
  );

  return (
    <div className="alerts-page">
      <header className="alerts-page-header">
        <div>
          <h1 className="alerts-page-title">{t('notifications.title')}</h1>
          {unreadInView > 0 && (
            <p className="alerts-page-subtitle">
              {t('notifications.unreadCount', { count: unreadInView })}
            </p>
          )}
        </div>
        <div className="alerts-page-actions">
          <button
            type="button"
            className="alerts-page-btn"
            onClick={() => void markAllRead()}
            disabled={unreadInView === 0}
          >
            {t('notifications.markAllRead')}
          </button>
          <button
            type="button"
            className="alerts-page-btn alerts-page-btn--primary"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? t('common.loading') : t('common.refresh')}
          </button>
        </div>
      </header>

      {isOffline && (
        <div className="offline-banner" role="status" style={{ marginBottom: 12 }}>
          {t('notifications.offlineF95')}
        </div>
      )}

      <div className="alerts-filter-bar">
        {(['all', 'f95', 'library'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`alerts-filter-tab${filter === key ? ' alerts-filter-tab--active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {key === 'all'
              ? t('notifications.filter.all')
              : key === 'f95'
                ? t('notifications.filter.f95')
                : t('notifications.filter.library')}
            {tabCounts[key] > 0 && (
              <span className="alerts-filter-badge">{tabCounts[key] > 99 ? '99+' : tabCounts[key]}</span>
            )}
          </button>
        ))}
      </div>

      {error && <div className="alerts-error">{error}</div>}

      {loading ? (
        <div className="alerts-loading">
          <Spinner />
        </div>
      ) : groupedEntries.length === 0 ? (
        <div className="alerts-list-panel">
          <div className="alerts-empty">
            <div className="alerts-empty-icon" aria-hidden>
              <IconBellLarge />
            </div>
            <p>{t('notifications.empty')}</p>
          </div>
        </div>
      ) : (
        <div className="alerts-groups">
          {groupedEntries.map(([group, entries]) => (
            <section key={group} className="alerts-group">
              <h2 className="alerts-group-title">{t(`notifications.group.${group}`)}</h2>
              <div className="alerts-list-panel">
                <ul className="alerts-list">
                  {entries.map((entry) => {
                    if (entry.kind === 'local') {
                      const n = entry.notification;
                      const isUnread = !n.readAt;
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            className={`alerts-row${isUnread ? ' alerts-row--unread' : ''}`}
                            onClick={() => {
                              void markRead(n.id, 'local');
                              openLocalNotification(n, navigate);
                            }}
                          >
                            <AlertMedia
                              thumbnailUrl={n.thumbnailUrl}
                              fallbackLetter={alertInitial(n.title)}
                              variant="thumb"
                            />
                            <div className="alerts-row-content">
                              <div className="alerts-row-text">{n.title}</div>
                              <div className="alerts-row-footer">
                                <span className="alerts-row-pill alerts-row-pill--library">
                                  {t(localSourceLabelKey(n.source))}
                                </span>
                                {n.body && <span className="alerts-row-version">{n.body}</span>}
                                <span className="alerts-row-date">
                                  {formatRelativeDate(n.createdAt, locale) ?? n.createdAt}
                                </span>
                              </div>
                            </div>
                            <IconChevronSmall />
                          </button>
                        </li>
                      );
                    }

                    const a = entry.alert;
                    const text = cleanAlertText(a.text);
                    return (
                      <li key={a.alertId}>
                        <button
                          type="button"
                          className={`alerts-row${a.isUnread ? ' alerts-row--unread' : ''}`}
                          onClick={() => {
                            void markRead(a.alertId, 'f95');
                            const threadId = extractThreadIdFromUrl(a.url);
                            if (threadId) navigate(`/store/game/${threadId}?cat=games`);
                            else if (a.url) void openUrl(a.url);
                          }}
                        >
                          <AlertMedia
                            avatarUrl={a.avatarUrl}
                            fallbackLetter={alertInitial(text)}
                            variant="avatar"
                          />
                          <div className="alerts-row-content">
                            <div className="alerts-row-text">{text}</div>
                            <div className="alerts-row-footer">
                              <span className="alerts-row-pill alerts-row-pill--f95">
                                {t('notifications.source.f95')}
                              </span>
                              {a.date && (
                                <span className="alerts-row-date">
                                  {formatRelativeDate(a.date, locale) ?? a.date}
                                </span>
                              )}
                            </div>
                          </div>
                          <IconChevronSmall />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ))}

          {filter !== 'library' && hasMore && !isOffline && (
            <div className="alerts-load-more">
              <button
                type="button"
                className="alerts-page-btn alerts-page-btn--primary"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? t('common.loading') : t('notifications.loadMore')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AlertMedia({
  avatarUrl,
  thumbnailUrl,
  fallbackLetter,
  variant,
}: {
  avatarUrl?: string | null;
  thumbnailUrl?: string | null;
  fallbackLetter: string;
  variant: 'avatar' | 'thumb';
}) {
  const src = thumbnailUrl ?? avatarUrl;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`alerts-row-media${variant === 'thumb' ? ' alerts-row-media--thumb' : ''}`}
      />
    );
  }
  return (
    <div
      className={`alerts-row-avatar-fallback${variant === 'thumb' ? ' alerts-row-avatar-fallback--thumb' : ''}`}
    >
      {fallbackLetter}
    </div>
  );
}

function IconChevronSmall() {
  return (
    <svg
      className="alerts-row-chevron"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function IconBellLarge() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}
