import { Outlet } from 'react-router-dom';
import { SteamLibrarySidebar } from './SteamLibrarySidebar';
import { useSkin } from '../../hooks/useSkin';

/**
 * Route layout for `/library` and `/library/game/:threadId`. With the
 * Steam skin active it keeps the Steam-style game-list panel mounted on
 * the left while the routed content (library home or game detail) renders
 * beside it — exactly how the Steam client keeps its sidebar when you
 * open a game page. With the default skin it's a pass-through.
 *
 * The media viewer route (`/library/game/:id/view`) intentionally stays
 * OUTSIDE this layout so reading comics/watching media keeps the full
 * window width.
 */
export function LibraryLayout() {
  const steamMode = useSkin() === 'steam';

  if (!steamMode) return <Outlet />;

  return (
    <div className="steam-library">
      <SteamLibrarySidebar />
      <div className="steam-library-main">
        <Outlet />
      </div>
    </div>
  );
}
