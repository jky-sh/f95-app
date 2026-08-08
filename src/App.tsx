import { useEffect, useMemo, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { LoginWindow } from './components/LoginWindow';
import { MainAppGate } from './components/MainAppGate';
import { OfflineProvider } from './contexts/Offline';
import { AppDialogProvider } from './components/AppDialogProvider';
import { ContextMenuProvider } from './components/contextMenu';
import { buildRouter } from './router';
import * as settings from './lib/settings';
import * as theme from './lib/theme';
import * as ipc from './lib/ipc';
import { LocaleProvider } from './lib/i18n';
import { DevDebugConsole } from './components/DevDebugConsole';
import { GameOverlayRoot } from './components/overlay/GameOverlayRoot';
import { OverlayHintRoot } from './components/overlay/OverlayHintRoot';
import { TrayMenuRoot } from './components/tray/TrayMenuRoot';
import { loadDevDebugSettings } from './lib/devDebugSettings';
import { startOverlayHotkeySync } from './lib/overlayHotkey';
import { runStartupUpdateCheck } from './lib/appUpdater';
import { tStandalone } from './lib/i18n';
import type { ProfileDto } from './types';
import './App.css';
import './styles/steam-skin.css';
import './styles/store-filter.css';
import './styles/offline.css';
import './styles/context-menu.css';
import './styles/notifications.css';
import './styles/settings-store.css';
import './styles/settings-changelog.css';
import './styles/version-info-modal.css';
import './styles/nav-accent.css';
import './styles/custom-video-fullscreen.css';
import './styles/collections.css';
import './styles/profile.css';
import './styles/achievements.css';

type AppWindowKind = 'login' | 'main' | 'overlay' | 'overlay-hint' | 'tray-menu';

function resolveAppWindowKind(): AppWindowKind {
  try {
    const label = getCurrentWindow().label;
    if (label === 'login') return 'login';
    if (label === 'game-overlay') return 'overlay';
    if (label === 'overlay-hint') return 'overlay-hint';
    if (label === 'tray-menu') return 'tray-menu';
  } catch {
    /* browser preview */
  }
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const w = params.get('window');
    if (w === 'overlay') return 'overlay';
    if (w === 'overlay-hint') return 'overlay-hint';
    if (w === 'tray-menu') return 'tray-menu';
  }
  return 'main';
}

const appWindowKind = resolveAppWindowKind();

function App() {
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [savedTheme, savedSkin] = await Promise.all([
        theme.loadSavedTheme(),
        theme.loadSavedSkin(),
      ]);
      theme.applyTheme(savedTheme);
      theme.applySkin(savedSkin);
      setThemeReady(true);
    })();
  }, []);

  useEffect(() => {
    if (
      appWindowKind === 'login' ||
      appWindowKind === 'overlay' ||
      appWindowKind === 'overlay-hint' ||
      appWindowKind === 'tray-menu'
    ) {
      return;
    }
    return startOverlayHotkeySync();
  }, []);

  useEffect(() => {
    if (
      appWindowKind === 'login' ||
      appWindowKind === 'overlay' ||
      appWindowKind === 'overlay-hint' ||
      appWindowKind === 'tray-menu'
    ) {
      return;
    }
    (async () => {
      try {
        const [token, accountId, megaSession, uhCookies, uhEmail, uhIsPro, bhAccountId, datanodesKey, mixdropEmail, mixdropKey] = await Promise.all([
          settings.get(settings.KEY_GOFILE_TOKEN),
          settings.get(settings.KEY_GOFILE_ACCOUNT_ID),
          settings.get(settings.KEY_MEGA_SESSION),
          settings.get(settings.KEY_UPLOADHAVEN_COOKIES),
          settings.get(settings.KEY_UPLOADHAVEN_EMAIL),
          settings.get(settings.KEY_UPLOADHAVEN_IS_PRO),
          settings.get(settings.KEY_BUZZHEAVIER_ACCOUNT_ID),
          settings.get(settings.KEY_DATANODES_API_KEY),
          settings.get(settings.KEY_MIXDROP_EMAIL),
          settings.get(settings.KEY_MIXDROP_API_KEY),
        ]);
        if (token) {
          await ipc.setGofileCredentials({ token, accountId });
        }
        if (megaSession) {
          await ipc.setMegaSession({ session: megaSession });
        }
        if (uhCookies) {
          await ipc.setUploadhavenSession({
            cookieHeader: uhCookies,
            email: uhEmail,
            isPro: uhIsPro === '1' || uhIsPro === 'true',
          });
        }
        if (bhAccountId) {
          await ipc.setBuzzheavierAccount({ accountId: bhAccountId });
        }
        if (datanodesKey) {
          await ipc.setDatanodesKey({ key: datanodesKey });
        }
        if (mixdropEmail && mixdropKey) {
          await ipc.setMixdropCredentials({ email: mixdropEmail, apiKey: mixdropKey });
        }
      } catch (err) {
        console.warn('[boot] failed to push host credentials', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (
      appWindowKind === 'login' ||
      appWindowKind === 'overlay' ||
      appWindowKind === 'overlay-hint' ||
      appWindowKind === 'tray-menu'
    ) {
      return;
    }
    void loadDevDebugSettings();
  }, []);

  useEffect(() => {
    if (appWindowKind !== 'main') return;
    const timer = window.setTimeout(() => {
      void runStartupUpdateCheck(tStandalone);
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (
      appWindowKind === 'login' ||
      appWindowKind === 'overlay' ||
      appWindowKind === 'tray-menu' ||
      !import.meta.env.DEV
    ) {
      return;
    }
    let cancelled = false;
    void listen<{ cookieHeader: string; isPro: boolean }>(
      'uploadhaven:session-updated',
      async (e) => {
        if (cancelled || !e.payload.cookieHeader) return;
        await settings.set(settings.KEY_UPLOADHAVEN_COOKIES, e.payload.cookieHeader);
        await settings.set(
          settings.KEY_UPLOADHAVEN_IS_PRO,
          e.payload.isPro ? '1' : '0',
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!themeReady) return null;

  if (appWindowKind === 'tray-menu') {
    return <TrayMenuRoot />;
  }

  return (
    <LocaleProvider>
      <ContextMenuProvider>
      <AppDialogProvider>
        {appWindowKind === 'overlay' ? (
          <GameOverlayRoot />
        ) : appWindowKind === 'overlay-hint' ? (
          <OverlayHintRoot />
        ) : appWindowKind === 'login' ? (
          <LoginWindow />
        ) : (
          <OfflineProvider>
            <MainAppGate>
              {({ profile, onLoggedOut }) => (
                <>
                  <RouterRoot profile={profile} onLoggedOut={onLoggedOut} />
                  <DevDebugConsole />
                </>
              )}
            </MainAppGate>
          </OfflineProvider>
        )}
      </AppDialogProvider>
      </ContextMenuProvider>
    </LocaleProvider>
  );
}

function RouterRoot({
  profile,
  onLoggedOut,
}: {
  profile: ProfileDto;
  onLoggedOut: () => void;
}) {
  const router = useMemo(
    () => buildRouter({ profile, onLoggedOut }),
    [profile, onLoggedOut],
  );
  return <RouterProvider router={router} />;
}

export default App;
