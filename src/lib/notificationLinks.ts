import type { AppNotification, NotificationSource } from '../types/alerts';

/** Label key for where a local notification came from (bell and alerts page). */
export function localSourceLabelKey(source: NotificationSource): string {
  switch (source) {
    case 'game_update':
      return 'notifications.source.update';
    case 'app_update':
      return 'notifications.source.app';
    case 'achievement':
      return 'notifications.source.achievement';
    default:
      return 'notifications.source.library';
  }
}

/** Open what a local notification is about. */
export function openLocalNotification(
  n: AppNotification,
  navigate: (to: string) => void,
): void {
  if (n.source === 'app_update') {
    // The version panel has what is new and the Install button.
    window.dispatchEvent(new CustomEvent('f95:open-version-modal'));
  } else if (n.source === 'game_update' && n.threadId) {
    navigate(`/library/game/${n.threadId}`);
  } else if (n.url?.startsWith('/')) {
    navigate(n.url);
  } else if (n.threadId) {
    navigate(`/store/game/${n.threadId}?cat=games`);
  }
}
