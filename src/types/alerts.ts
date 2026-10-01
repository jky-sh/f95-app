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

/** `rss_library` is only in rows written before game_update replaced it. */
export type NotificationSource = 'f95' | 'rss_library' | 'achievement' | 'game_update' | 'app_update';

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
