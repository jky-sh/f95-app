import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LocaleProvider } from '../../lib/i18n';
import * as theme from '../../lib/theme';
import { GameOverlayApp } from './GameOverlayApp';
import '../../styles/game-overlay.css';

export function GameOverlayRoot() {
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    console.info('[overlay] janela game-overlay montada');
    document.documentElement.classList.add('game-overlay-window');
    void getCurrentWindow()
      .setShadow(false)
      .catch(() => {});
    return () => {
      console.info('[overlay] janela game-overlay desmontada');
      document.documentElement.classList.remove('game-overlay-window');
    };
  }, []);

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

  if (!themeReady) return null;

  return (
    <LocaleProvider>
      <div className="game-overlay-root">
        <GameOverlayApp />
      </div>
    </LocaleProvider>
  );
}
