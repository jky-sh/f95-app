import { openUrl } from '@tauri-apps/plugin-opener';
import type { ContextMenuItem } from '../../components/contextMenu/types';
import type { FollowedUser } from '../../types/social';
import type { TranslateFn } from '../libraryGameActions';
import { copyTextWithFeedback } from '../clipboard';
import { item, offlineTitle } from './helpers';

export function buildFriendsMenu(
  user: FollowedUser,
  opts: { isOffline: boolean; t: TranslateFn; onViewProfile?: () => void },
): ContextMenuItem[] {
  const off = offlineTitle(opts.isOffline, opts.t);
  const items: ContextMenuItem[] = [];
  if (opts.onViewProfile) {
    items.push(
      item('view', opts.t('contextMenu.viewProfile'), opts.onViewProfile, {
        disabled: opts.isOffline,
        title: off,
      }),
    );
  }
  items.push(
    item('profile', opts.t('contextMenu.openProfile'), () => openUrl(user.profileUrl), {
      disabled: opts.isOffline,
      title: off,
    }),
    item('copy', opts.t('contextMenu.copyProfileLink'), () =>
      copyTextWithFeedback(user.profileUrl),
    ),
  );
  return items;
}
