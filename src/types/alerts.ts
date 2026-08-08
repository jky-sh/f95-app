export interface F95Alert {
  alertId: string;
  text: string;
  url: string | null;
  avatarUrl: string | null;
  username: string | null;
  date: string | null;
  isUnread: boolean;
}

export interface F95AlertsPopupResult {
  alerts: F95Alert[];
  unreadCount: number;
}

export interface F95AlertsListResult {
  alerts: F95Alert[];
  hasMore: boolean;
  page: number;
}

export type NotificationSource = 'f95' | 'rss_library' | 'achievement';

export interface AppNotification {
  id: string;
  source: NotificationSource;
  threadId: string | null;
  title: string;
  body: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  readAt: string | null;
}
