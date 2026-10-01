import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { DownloadsProvider } from '../contexts/Downloads';
import { DownloadSettingsProvider } from '../contexts/DownloadSettings';
import { StoreSettingsProvider } from '../contexts/StoreSettings';
import { RunningGamesProvider } from '../contexts/RunningGames';
import { NotificationsProvider } from '../contexts/Notifications';
import { AchievementsBridge } from './AchievementsBridge';
import { Sidebar } from './Sidebar';
import { SteamTopNav } from './SteamTopNav';
import { TitleBar } from './TitleBar';
import { StatusBar } from './StatusBar';
import { useSkin } from '../hooks/useSkin';
import { LaunchingOverlay } from './LaunchingOverlay';
import { CollectionPickerModal } from './library/CollectionPickerModal';
import { GameDownloadModal } from './GameDownloadModal';
import { CommandPalette } from './CommandPalette';
import { BigPictureHost } from './bigpicture/BigPicture';
import { openBigPicture } from '../lib/bigPicture';
import { startBigPictureControllerBridge } from '../lib/bigPictureController';
import { CatalogBootstrap } from './store/CatalogBootstrap';
import { MainScrollRestoration } from './MainScrollRestoration';
import { UpdateCheckScheduler } from './library/UpdateCheckControl';
import { PrefixCatalogProvider } from '../contexts/PrefixCatalogContext';
import { TagCatalogProvider } from '../contexts/TagCatalogContext';
import { tStandalone } from '../lib/i18n';
import { startTrayActionBridge } from '../lib/trayActions';
import { startTrayIconSync } from '../lib/tray';
import type { ProfileDto } from '../types';

interface Props {
  profile: ProfileDto;
  onLoggedOut: () => void;
}

/**
 * App layout: custom title bar across the top (we hide the OS chrome via
 * `decorations: false` in tauri.conf.json), then a flex row below holding
 * the sidebar nav and the routed main content.
 */
export function AppShell({ profile, onLoggedOut }: Props) {
  const navigate = useNavigate();
  // Steam skin swaps the left sidebar for a Steam-style top nav.
  const steamNav = useSkin() === 'steam';

  // Start tray after the main shell mounts — settings DB is ready by then.
  useEffect(() => startTrayIconSync(tStandalone), []);

  useEffect(
    () =>
      startTrayActionBridge({
        navigate: (to) => {
          navigate(to);
        },
        openChangelog: () => {
          window.dispatchEvent(new CustomEvent('f95:open-version-modal'));
        },
        openBigPicture: () => openBigPicture(null),
      }),
    [navigate],
  );

  // The Xbox button or View + Menu opens Big Picture, also from the tray.
  useEffect(() => startBigPictureControllerBridge(), []);

  return (
    <RunningGamesProvider>
      <DownloadSettingsProvider>
        <StoreSettingsProvider>
        <DownloadsProvider>
          <NotificationsProvider initialF95Unread={profile.alerts}>
            <TagCatalogProvider>
              <PrefixCatalogProvider>
                <CatalogBootstrap />
                <MainScrollRestoration />
                <UpdateCheckScheduler />
                <AchievementsBridge />
                <div style={rootStyle} className="app-shell">
                  {/* The desktop chrome, apart from the dialogs below so Big
                      Picture can push it back without moving them. */}
                  <div style={frameStyle} className="app-shell-frame">
                    <TitleBar />
                    {steamNav && <SteamTopNav profile={profile} />}
                    <div style={bodyStyle} className="app-shell-body">
                      {!steamNav && <Sidebar profile={profile} />}
                      <main style={contentStyle} className="app-main">
                        <Outlet context={{ profile, onLoggedOut }} />
                      </main>
                    </div>
                    <StatusBar />
                  </div>
                  <LaunchingOverlay />
                  <CollectionPickerModal />
                  <GameDownloadModal />
                  <CommandPalette />
                  <BigPictureHost profile={profile} />
                </div>
              </PrefixCatalogProvider>
            </TagCatalogProvider>
          </NotificationsProvider>
        </DownloadsProvider>
        </StoreSettingsProvider>
      </DownloadSettingsProvider>
    </RunningGamesProvider>
  );
}

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: 'var(--bg-base)',
  color: 'var(--text-secondary)',
  overflow: 'hidden',
};

const frameStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'auto',
};
