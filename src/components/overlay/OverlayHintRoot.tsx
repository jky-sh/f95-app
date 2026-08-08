import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LocaleProvider, useT } from '../../lib/i18n';
import * as ipc from '../../lib/ipc';
import * as theme from '../../lib/theme';
import '../../styles/overlay-hint.css';

interface OverlayHintPayload {
  title: string;
  hotkey: string;
}

interface OverlayErrorPayload {
  message: string;
}

interface OverlayAchievementPayload {
  title: string;
  description: string | null;
  iconUrl: string | null;
  index: number;
  count: number;
  unlockedCount: number;
  totalCount: number;
}

function OverlayAchievementToast({ payload }: { payload: OverlayAchievementPayload }) {
  const { t } = useT();
  return (
    <div
      className="overlay-hint-toast overlay-hint-toast--achievement"
      aria-live="polite"
      key={`${payload.index}-${payload.title}`}
    >
      {payload.iconUrl ? (
        <img
          className="overlay-hint-ach-icon"
          src={payload.iconUrl}
          alt=""
          aria-hidden
        />
      ) : (
        <div className="overlay-hint-icon overlay-hint-icon--achievement" aria-hidden>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M7 4h10v2h3v3c0 2.2-1.8 4-4 4h-.3A5 5 0 0 1 13 15.9V18h3v2H8v-2h3v-2.1A5 5 0 0 1 8.3 13H8c-2.2 0-4-1.8-4-4V6h3V4Zm-1 4v1c0 1.1.9 2 2 2V8H6Zm12 0h-2v3c1.1 0 2-.9 2-2V8Z"
              fill="currentColor"
            />
          </svg>
        </div>
      )}
      <div className="overlay-hint-text">
        <strong className="overlay-hint-title overlay-hint-title--achievement">
          {t('ach.toast.title')}
          {payload.count > 1 && (
            <span className="overlay-hint-ach-queue">
              {' '}
              {payload.index}/{payload.count}
            </span>
          )}
        </strong>
        <span className="overlay-hint-game" title={payload.title}>
          {payload.title}
        </span>
        <span className="overlay-hint-sub overlay-hint-ach-sub">
          {payload.description ? `${payload.description} · ` : ''}
          {t('ach.toast.progress', {
            unlocked: String(payload.unlockedCount),
            total: String(payload.totalCount),
          })}
        </span>
      </div>
    </div>
  );
}

function OverlayErrorToast({ message }: { message: string }) {
  const { t } = useT();
  return (
    <div className="overlay-hint-toast overlay-hint-toast--error" aria-live="assertive">
      <div className="overlay-hint-icon overlay-hint-icon--error" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 8v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="0.9" fill="currentColor" />
        </svg>
      </div>
      <div className="overlay-hint-text">
        <strong className="overlay-hint-title">{t('overlay.error.title')}</strong>
        <span className="overlay-hint-sub overlay-hint-error-msg">{message}</span>
      </div>
    </div>
  );
}

function OverlayHintToast({ payload }: { payload: OverlayHintPayload }) {
  const { t } = useT();
  return (
    <div className="overlay-hint-toast" aria-live="polite">
      <div className="overlay-hint-icon" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 20h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      <div className="overlay-hint-text">
        <strong className="overlay-hint-title">{t('overlay.ready.title')}</strong>
        <span className="overlay-hint-game" title={payload.title}>
          {payload.title}
        </span>
        <span className="overlay-hint-sub">
          {t('overlay.ready.hint', { hotkey: payload.hotkey })}
        </span>
      </div>
    </div>
  );
}

export function OverlayHintRoot() {
  const [payload, setPayload] = useState<OverlayHintPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [achievement, setAchievement] = useState<OverlayAchievementPayload | null>(null);
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('overlay-hint-window');
    document.body.style.userSelect = 'none';
    void getCurrentWindow()
      .setShadow(false)
      .catch(() => {});
    return () => {
      document.documentElement.classList.remove('overlay-hint-window');
      document.body.style.userSelect = '';
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubs: UnlistenFn[] = [];
    void listen<OverlayHintPayload>('overlay:hint', (e) => {
      if (!cancelled) {
        setErrorMessage(null);
        setAchievement(null);
        setPayload(e.payload);
        console.info('[overlay-hint] indicador:', e.payload.title);
      }
    }).then((fn) => unsubs.push(fn));
    void listen<OverlayErrorPayload>('overlay:error', (e) => {
      if (!cancelled) {
        setPayload(null);
        setAchievement(null);
        setErrorMessage(e.payload.message);
        console.warn('[overlay-hint] erro:', e.payload.message);
      }
    }).then((fn) => unsubs.push(fn));
    void listen<OverlayAchievementPayload>('overlay:achievement', (e) => {
      if (!cancelled) {
        setPayload(null);
        setErrorMessage(null);
        setAchievement(e.payload);
        console.info('[overlay-hint] conquista:', e.payload.title);
      }
    }).then((fn) => unsubs.push(fn));
    void ipc.overlayGetGameHintPayload().then((stored) => {
      if (!cancelled && stored) setPayload(stored);
    });
    return () => {
      cancelled = true;
      for (const fn of unsubs) fn();
    };
  }, []);

  useEffect(() => {
    void Promise.all([theme.loadSavedTheme(), theme.loadSavedSkin()]).then(
      ([savedTheme, savedSkin]) => {
        theme.applyTheme(savedTheme);
        theme.applySkin(savedSkin);
        setThemeReady(true);
      },
    );
  }, []);

  if (!themeReady && !payload && !errorMessage && !achievement) return null;

  return (
    <LocaleProvider>
      <div className="overlay-hint-root">
        {errorMessage ? (
          <OverlayErrorToast message={errorMessage} />
        ) : achievement ? (
          <OverlayAchievementToast payload={achievement} />
        ) : payload ? (
          <OverlayHintToast payload={payload} />
        ) : null}
      </div>
    </LocaleProvider>
  );
}
