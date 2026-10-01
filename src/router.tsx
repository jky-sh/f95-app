import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { ProfileDto } from './types';
import { AppShell } from './components/AppShell';
import { useOffline } from './contexts/Offline';
import { ProfilePage } from './pages/ProfilePage';
import { StorePage } from './pages/StorePage';
import { GameDetailPage } from './pages/GameDetailPage';
import { LibraryLayout } from './components/library/LibraryLayout';
import { LibraryPage } from './pages/LibraryPage';
import { LibraryCollectionPage } from './pages/LibraryCollectionPage';
import { LibraryGamePage } from './pages/LibraryGamePage';
import { LibraryMediaViewerPage } from './pages/LibraryMediaViewerPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { NewsPage } from './pages/NewsPage';
import { FriendsPage } from './pages/FriendsPage';
import { FriendProfilePage } from './pages/FriendProfilePage';
import { AlertsPage } from './pages/AlertsPage';
import { AchievementsHubPage } from './pages/AchievementsHubPage';
import { SettingsPage } from './pages/SettingsPage';

interface BuildOpts {
  profile: ProfileDto;
  onLoggedOut: () => void;
}

function HomeRedirect() {
  const { isOffline } = useOffline();
  return <Navigate to={isOffline ? '/library' : '/store'} replace />;
}

export function buildRouter({ profile, onLoggedOut }: BuildOpts) {
  return createBrowserRouter([
    {
      path: '/',
      element: <AppShell profile={profile} onLoggedOut={onLoggedOut} />,
      children: [
        { index: true, element: <HomeRedirect /> },
        { path: 'store', element: <StorePage /> },
        { path: 'store/game/:threadId', element: <GameDetailPage /> },
        {
          // Layout keeps the Steam-skin game-list panel mounted across the
          // library home and game detail routes (pass-through otherwise).
          path: 'library',
          element: <LibraryLayout />,
          children: [
            { index: true, element: <LibraryPage /> },
            { path: 'collection/:collectionId', element: <LibraryCollectionPage /> },
            { path: 'game/:threadId', element: <LibraryGamePage /> },
          ],
        },
        { path: 'library/game/:threadId/view', element: <LibraryMediaViewerPage /> },
        { path: 'downloads', element: <DownloadsPage /> },
        { path: 'news', element: <NewsPage /> },
        { path: 'friends', element: <FriendsPage /> },
        { path: 'friends/:userId', element: <FriendProfilePage /> },
        { path: 'profile', element: <ProfilePage /> },
        { path: 'achievements', element: <AchievementsHubPage /> },
        { path: 'alerts', element: <AlertsPage /> },
        { path: 'settings', element: <SettingsPage onLoggedOut={onLoggedOut} /> },
        { path: '*', element: <Navigate to="/store" replace /> },
      ],
    },
  ]);
}
