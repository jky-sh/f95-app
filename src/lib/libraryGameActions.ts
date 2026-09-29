import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { NavigateFunction } from 'react-router-dom';
import * as ipc from './ipc';
import * as library from './library';
import * as updates from './updates';
import * as uninstall from './uninstall';
import { dialog } from './dialog';
import { openGameDownloadModal } from './gameDownloadModal';
import type { LibraryGame } from '../types/library';

/** Abre o modal global de update (escolha de host) para um jogo da biblioteca. */
export function openUpdateModal(game: LibraryGame): void {
  openGameDownloadModal({
    threadId: game.threadId,
    category: game.category,
    mode: 'update',
    title: game.title,
    versionLabel: game.availableVersion,
  });
}

export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export interface LibraryGameActionsDeps {
  navigate: NavigateFunction;
  launch: (game: LibraryGame) => Promise<void>;
  running: Set<string>;
  isOffline: boolean;
  t: TranslateFn;
  onReload?: () => void | Promise<void>;
}

function formatErr(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

export async function playOrStop(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): Promise<void> {
  const { running, launch, navigate } = deps;
  if (running.has(game.threadId)) {
    try {
      await ipc.stopGame(game.threadId);
    } catch (err) {
      await dialog.alert(formatErr(err), { kind: 'error' });
    }
    return;
  }
  if (game.installStatus === 'update_available') {
    // Update pendente não torna o jogo injogável: com exe configurado, Jogar
    // continua jogando a versão instalada — atualizar é ação separada (menu
    // de contexto, página do jogo ou loja).
    if (game.exePath) {
      try {
        await launch(game);
      } catch (err) {
        await dialog.alert(formatErr(err), { kind: 'error' });
      }
      return;
    }
    openUpdateModal(game);
    return;
  }
  if (game.installStatus === 'installed' && game.installPath && game.category !== 'games') {
    navigate(`/library/game/${game.threadId}/view`);
    return;
  }
  if (game.installStatus === 'installed' && game.category === 'mods' && game.exePath) {
    try {
      await launch(game);
    } catch (err) {
      await dialog.alert(formatErr(err), { kind: 'error' });
    }
    return;
  }
  if (game.installStatus === 'installed' && game.exePath) {
    try {
      await launch(game);
    } catch (err) {
      await dialog.alert(formatErr(err), { kind: 'error' });
    }
    return;
  }
  if (
    game.installStatus === 'not_installed' ||
    (game.installStatus === 'installed' && !game.exePath)
  ) {
    await pickExeFor(game, deps);
  }
}

export async function pickExeFor(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): Promise<void> {
  const selected = await openFileDialog({
    multiple: false,
    directory: false,
    title: deps.t('contextMenu.pickExeTitle', { title: game.title }),
    filters: [
      { name: deps.t('contextMenu.exeFilter'), extensions: ['exe', 'sh', 'app', 'bat', 'cmd'] },
      { name: deps.t('contextMenu.allFilter'), extensions: ['*'] },
    ],
  });
  if (typeof selected !== 'string') return;
  await library.setExe(game.threadId, selected);
  await deps.onReload?.();
}

export async function openInstallFolder(game: LibraryGame): Promise<void> {
  if (!game.installPath) return;
  try {
    await ipc.revealInExplorer(game.installPath);
  } catch (err) {
    await dialog.alert(formatErr(err), { kind: 'error' });
  }
}

export function openLibraryDetail(
  game: LibraryGame,
  navigate: NavigateFunction,
): void {
  navigate(`/library/game/${game.threadId}`);
}

export function openMediaViewer(
  game: LibraryGame,
  navigate: NavigateFunction,
): void {
  navigate(`/library/game/${game.threadId}/view`);
}

export async function checkUpdateForGame(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): Promise<void> {
  if (deps.isOffline) {
    await dialog.alert(deps.t('offline.actionBlocked'), { kind: 'info' });
    return;
  }
  const result = await updates.checkOne(game);
  await deps.onReload?.();
  if (result.error) {
    await dialog.alert(deps.t('libdetail.update.failed', { error: result.error }));
  } else if (result.hasUpdate) {
    await dialog.alert(
      deps.t('libdetail.update.found', { version: result.latestVersion ?? '' }),
    );
  } else {
    await dialog.alert(deps.t('libdetail.update.uptodate'), { kind: 'info' });
  }
}

export function hasInstalledFiles(game: LibraryGame): boolean {
  return !!(game.installPath || game.exePath);
}

export function canUninstallGame(game: LibraryGame, running: Set<string>): boolean {
  return (
    hasInstalledFiles(game) &&
    !running.has(game.threadId) &&
    game.installStatus !== 'downloading' &&
    game.installStatus !== 'extracting'
  );
}

export async function uninstallGameFromMenu(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): Promise<void> {
  const { running, navigate, t, onReload } = deps;
  if (running.has(game.threadId)) {
    await dialog.alert(t('libdetail.uninstall.notRunning'));
    return;
  }
  if (game.installStatus === 'downloading' || game.installStatus === 'extracting') {
    await dialog.alert(t('libdetail.uninstall.waitDownload'));
    return;
  }
  const ok = await dialog.confirm(t('libdetail.confirmUninstall', { title: game.title }), {
    title: t('libdetail.confirmUninstallTitle'),
    kind: 'warning',
  });
  if (!ok) return;

  const hadInstallFiles = hasInstalledFiles(game);
  try {
    const result = await uninstall.uninstallGame(game.threadId);
    const removeFromLibrary = await dialog.ask(
      t('libdetail.uninstall.askRemoveLibrary', { title: game.title }),
      {
        title: t('libdetail.uninstall.askRemoveLibraryTitle'),
        kind: 'warning',
      },
    );
    if (removeFromLibrary) {
      await library.remove(game.threadId);
      navigate('/library');
      return;
    }
    await onReload?.();
    if (result.skippedPaths.length > 0) {
      await dialog.alert(
        t('libdetail.uninstall.partial', { paths: result.skippedPaths.join('\n') }),
      );
    } else if (!result.deleted && hadInstallFiles) {
      await dialog.alert(t('libdetail.uninstall.outsideLibrary'));
    }
  } catch (err) {
    await dialog.alert(t('libdetail.uninstall.failed', { error: formatErr(err) }));
  }
}

export async function removeFromLibrary(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): Promise<void> {
  const ok = await dialog.confirm(
    deps.t('contextMenu.removeFromLibraryConfirm', { title: game.title }),
    { title: deps.t('contextMenu.removeFromLibraryTitle'), kind: 'warning' },
  );
  if (!ok) return;
  await library.remove(game.threadId);
  await deps.onReload?.();
}

export function openThreadOnF95(game: LibraryGame): void {
  void openUrl(game.threadUrl);
}
