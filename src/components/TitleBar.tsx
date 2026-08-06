import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useT } from '../lib/i18n';
import { handleTitleBarClose } from '../lib/tray';

/**
 * Custom title bar — replaces Windows' native chrome (we set
 * `decorations: false` in tauri.conf.json). The drag region matches the
 * stripe behind the brand; the controls on the right call into Tauri's
 * window API for minimize / maximize / close.
 *
 * Tracking the `maximized` state locally lets us flip the middle button
 * between "maximize" and "restore" glyphs.
 */
export function TitleBar() {
  const { t } = useT();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    // Tauri emits a synthetic resize whenever maximize toggles; we resync.
    const unlistenP = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlistenP.then((u) => u()).catch(() => {});
    };
  }, []);

  function callWindow(action: 'minimize' | 'toggleMaximize' | 'close') {
    const win = getCurrentWindow();
    if (action === 'minimize') void win.minimize();
    else if (action === 'toggleMaximize') void win.toggleMaximize();
    else void handleTitleBarClose();
  }

  return (
    <div style={barStyle} className="app-titlebar">
      {/* `data-tauri-drag-region` lives ONLY on the drag strip — putting it
          on the root makes the runtime treat the entire bar (buttons
          included) as a drag handle and swallows their clicks. */}
      <div data-tauri-drag-region style={dragStripStyle}>
        <div className="app-logo" style={brandLogo} />
        <span style={brandText}>F95 App</span>
      </div>

      <div style={controlsStyle}>
        <button
          type="button"
          style={btnStyle}
          className="titlebar-btn"
          onClick={() => callWindow('minimize')}
          aria-label={t('titlebar.minimize')}
          title={t('titlebar.minimize')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          style={btnStyle}
          className="titlebar-btn"
          onClick={() => callWindow('toggleMaximize')}
          aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
          title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              {/* Two stacked squares — "restore" glyph */}
              <rect x="3" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="1" y="3" width="7" height="7" fill="var(--bg-base)" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          type="button"
          style={btnStyle}
          className="titlebar-btn titlebar-close"
          onClick={() => callWindow('close')}
          aria-label={t('titlebar.close')}
          title={t('titlebar.close')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const barStyle: React.CSSProperties = {
  height: 32,
  background: 'var(--bg-sidebar)',
  borderBottom: '1px solid var(--border-faint)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
  userSelect: 'none',
  position: 'relative',
  zIndex: 100,
};

const dragStripStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingLeft: 12,
  height: '100%',
  flex: 1,
  // The whole strip is the drag handle — anything inside it (logo, name)
  // contributes to the click target for moving the window.
};

const brandLogo: React.CSSProperties = {
  width: 60,
  height: 22,
};

const brandText: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  fontWeight: 500,
  letterSpacing: 0.4,
};

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  height: '100%',
  // Make sure controls are NOT inside the drag region so the buttons
  // capture clicks normally.
};

const btnStyle: React.CSSProperties = {
  width: 46,
  height: '100%',
  background: 'transparent',
  border: 'none',
  color: 'var(--text-tertiary)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
  transition: 'background 0.1s ease, color 0.1s ease',
};
