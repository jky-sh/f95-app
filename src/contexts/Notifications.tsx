import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { parseDbTime } from '../lib/dbTime';
import * as ipc from '../lib/ipc';
import * as notifications from '../lib/notifications';
import { useOffline } from './Offline';
import type { AppNotification, F95Alert } from '../types/alerts';

/** F95's own alerts. Library notifications come from the background scheduler. */
const ALERTS_POLL_MS = 5 * 60_000;

export type UnifiedNotification =
  | { kind: 'f95'; alert: F95Alert }
  | { kind: 'local'; notification: AppNotification };

export interface NotificationsContextValue {
  f95Alerts: F95Alert[];
  localNotifications: AppNotification[];
  unified: UnifiedNotification[];
  unreadCount: number;
  f95UnreadCount: number;
  localUnreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string, kind: 'f95' | 'local') => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

function toUnified(
  f95Alerts: F95Alert[],
  localNotifications: AppNotification[],
): UnifiedNotification[] {
  const f95Items: UnifiedNotification[] = f95Alerts.map((alert) => ({
    kind: 'f95',
    alert,
  }));
  const localItems: UnifiedNotification[] = localNotifications.map((notification) => ({
    kind: 'local',
    notification,
  }));
  // Newest first across both, then the cap: local rows (achievements,
  // updates) piling up must not push every F95 alert out of the preview.
  return [...localItems, ...f95Items]
    .sort((a, b) => unifiedTime(b) - unifiedTime(a))
    .slice(0, 50);
}

function unifiedTime(item: UnifiedNotification): number {
  const ms =
    item.kind === 'f95'
      ? item.alert.date
        ? Date.parse(item.alert.date)
        : NaN
      : (parseDbTime(item.notification.createdAt)?.getTime() ?? NaN);
  return Number.isNaN(ms) ? 0 : ms;
}

interface Props {
  children: ReactNode;
  initialF95Unread?: number;
}

export function NotificationsProvider({ children, initialF95Unread = 0 }: Props) {
  const { isOffline } = useOffline();
  const [f95Alerts, setF95Alerts] = useState<F95Alert[]>([]);
  const [f95UnreadCount, setF95UnreadCount] = useState(initialF95Unread);
  const [localNotifications, setLocalNotifications] = useState<AppNotification[]>([]);
  const [localUnreadCount, setLocalUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  const reloadLocal = useCallback(async () => {
    const [list, unread] = await Promise.all([
      notifications.list({ limit: 100 }),
      notifications.unreadCount(),
    ]);
    if (!mounted.current) return;
    setLocalNotifications(list);
    setLocalUnreadCount(unread);
  }, []);

  const refreshF95 = useCallback(async () => {
    if (isOffline) return;
    try {
      const popup = await ipc.fetchAlertsPopup();
      if (!mounted.current) return;
      setF95Alerts(popup.alerts);
      setF95UnreadCount(popup.unreadCount);
    } catch (err) {
      console.warn('[notifications] alerts popup failed', err);
    }
  }, [isOffline]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([refreshF95(), reloadLocal()]);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [refreshF95, reloadLocal]);

  useEffect(() => {
    mounted.current = true;
    void reloadLocal();
    if (!isOffline) void refreshF95();
    return () => {
      mounted.current = false;
    };
  }, [isOffline, reloadLocal, refreshF95]);

  useEffect(() => {
    if (isOffline) return;
    const alertsTimer = setInterval(() => void refreshF95(), ALERTS_POLL_MS);
    return () => clearInterval(alertsTimer);
  }, [isOffline, refreshF95]);

  // Update checks and installs write notifications from outside React.
  useEffect(
    () => notifications.onNotificationsChanged(() => void reloadLocal().catch(() => undefined)),
    [reloadLocal],
  );

  const markRead = useCallback(
    async (id: string, kind: 'f95' | 'local') => {
      if (kind === 'local') {
        await notifications.markRead(id);
        await reloadLocal();
        return;
      }
      setF95Alerts((prev) =>
        prev.map((a) => (a.alertId === id ? { ...a, isUnread: false } : a)),
      );
      setF95UnreadCount((c) => Math.max(0, c - 1));
    },
    [reloadLocal],
  );

  const markAllRead = useCallback(async () => {
    await notifications.markAllRead();
    setF95Alerts((prev) => prev.map((a) => ({ ...a, isUnread: false })));
    setF95UnreadCount(0);
    await reloadLocal();
  }, [reloadLocal]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      f95Alerts,
      localNotifications,
      unified: toUnified(f95Alerts, localNotifications),
      unreadCount: f95UnreadCount + localUnreadCount,
      f95UnreadCount,
      localUnreadCount,
      loading,
      refresh,
      markRead,
      markAllRead,
    }),
    [
      f95Alerts,
      localNotifications,
      f95UnreadCount,
      localUnreadCount,
      loading,
      refresh,
      markRead,
      markAllRead,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within NotificationsProvider');
  }
  return ctx;
}
