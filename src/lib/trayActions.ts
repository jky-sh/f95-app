/**
 * Handle actions emitted by the custom tray menu (runs in the main window).
 */
import { exit } from '@tauri-apps/plugin-process';
import { checkForAppUpdateInteractive } from './appUpdater';
import { tStandalone } from './i18n';
import {
  showMainWindow,
  subscribeTrayMenuActions,
  type TrayMenuActionPayload,
} from './trayMenu';

export type TrayNavigateTarget =
  | '/downloads'
  | '/settings'
  | '/library'
  | `/library/game/${string}`;

export function startTrayActionBridge(options: {
  navigate: (to: TrayNavigateTarget) => void;
  openChangelog: () => void;
}): () => void {
  let active = true;
  let unlisten: (() => void) | null = null;

  void subscribeTrayMenuActions((payload) => {
    if (!active) return;
    void handleTrayAction(payload, options);
  }).then((fn) => {
    if (!active) {
      fn();
      return;
    }
    unlisten = fn;
  });

  return () => {
    active = false;
    unlisten?.();
    unlisten = null;
  };
}

async function handleTrayAction(
  payload: TrayMenuActionPayload,
  options: {
    navigate: (to: TrayNavigateTarget) => void;
    openChangelog: () => void;
  },
): Promise<void> {
  const { action, threadId } = payload;
  switch (action) {
    case 'show':
      await showMainWindow();
      break;
    case 'library':
      await showMainWindow();
      options.navigate('/library');
      break;
    case 'open-game':
      if (!threadId) break;
      await showMainWindow();
      options.navigate(`/library/game/${threadId}`);
      break;
    case 'downloads':
      await showMainWindow();
      options.navigate('/downloads');
      break;
    case 'settings':
      await showMainWindow();
      options.navigate('/settings');
      break;
    case 'changelog':
      await showMainWindow();
      options.openChangelog();
      break;
    case 'check-updates':
      await showMainWindow();
      await checkForAppUpdateInteractive(tStandalone);
      break;
    case 'quit':
      await exit(0);
      break;
    default:
      break;
  }
}
