import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRunningGames } from '../contexts/RunningGames';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import { buildLibraryMenu } from '../lib/contextMenus/buildLibraryMenu';
import {
  buildLibraryDetailMenu,
  type LibraryDetailMenuExtra,
} from '../lib/contextMenus/buildLibraryDetailMenu';
import { playOrStop, type LibraryGameActionsDeps } from '../lib/libraryGameActions';
import { useContextMenu } from '../components/contextMenu';
import type { LibraryGame } from '../types/library';

export function useLibraryGameActions(opts?: { onReload?: () => void | Promise<void> }) {
  const navigate = useNavigate();
  const { running, launch } = useRunningGames();
  const { isOffline } = useOffline();
  const { t } = useT();
  const { openContextMenu } = useContextMenu();

  const deps = useMemo<LibraryGameActionsDeps>(
    () => ({
      navigate,
      launch,
      running,
      isOffline,
      t,
      onReload: opts?.onReload,
    }),
    [navigate, launch, running, isOffline, t, opts?.onReload],
  );

  // Stable handlers, so memoized cards don't re-render for new closures.
  const openLibraryContextMenu = useCallback(
    (e: React.MouseEvent, game: LibraryGame) => openContextMenu(e, buildLibraryMenu(game, deps)),
    [openContextMenu, deps],
  );

  const openLibraryDetailContextMenu = useCallback(
    (e: React.MouseEvent, game: LibraryGame, extra?: LibraryDetailMenuExtra) =>
      openContextMenu(e, buildLibraryDetailMenu(game, deps, extra)),
    [openContextMenu, deps],
  );

  const playOrStopGame = useCallback((game: LibraryGame) => playOrStop(game, deps), [deps]);

  return {
    deps,
    openLibraryContextMenu,
    openLibraryDetailContextMenu,
    playOrStop: playOrStopGame,
  };
}
