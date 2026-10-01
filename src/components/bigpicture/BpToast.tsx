import { useEffect, useState } from 'react';
import { installAppUpdate } from '../../lib/appUpdater';
import { useT } from '../../lib/i18n';
import { APP_TOAST_EVENT, type AppToast } from '../../lib/updateNotifier';
import { Icon } from '../ui/Icon';
import { useBp } from './BpContext';
import { useInputMethod } from './bpInput';
import { useProgressiveArt } from './BpParts';
import { playSound } from './bpSound';

const TOAST_MS = 7000;

/**
 * Update notices over Big Picture: Windows mutes its own banners over a
 * fullscreen app. Out of the controller's way (never focused); a click
 * opens what it is about. The controller's buttons belong to the screen,
 * so with a pad or the keyboard the toast says where the same news waits:
 * the top bar's update button for the app, Home's updates shelf for games.
 */
export function BpToast() {
  const { t } = useT();
  const bp = useBp();
  const method = useInputMethod();
  const [current, setCurrent] = useState<{ id: number; toast: AppToast } | null>(null);

  useEffect(() => {
    const onToast = (e: Event) => {
      const toast = (e as CustomEvent<AppToast>).detail;
      if (!toast) return;
      playSound('open');
      setCurrent((prev) => ({ id: (prev?.id ?? 0) + 1, toast }));
    };
    window.addEventListener(APP_TOAST_EVENT, onToast);
    return () => window.removeEventListener(APP_TOAST_EVENT, onToast);
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setCurrent(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [current]);

  const toast = current?.toast ?? null;
  const cover = toast?.kind === 'game_update' ? (toast.games[0]?.thumbnailUrl ?? null) : null;
  const art = useProgressiveArt(cover, false);
  if (!current || !toast) return null;
  // The desktop text points at the status bar, which Big Picture covers.
  const body = toast.kind === 'app_update' ? t('bp.appUpdate.hint') : toast.body;
  const hint =
    toast.kind === 'game_update' && method !== 'mouse'
      ? t('bp.toast.gameHint', { home: t('bp.tab.home'), shelf: t('bp.home.updates') })
      : null;

  const open = () => {
    setCurrent(null);
    if (toast.kind === 'app_update') void installAppUpdate(t);
    else if (toast.games.length === 1) bp.push({ screen: 'game', threadId: toast.games[0].threadId });
    else bp.switchTab('library');
  };

  return (
    <button
      key={current.id}
      type="button"
      tabIndex={-1}
      className="bp-toast"
      role="status"
      aria-live="polite"
      onClick={open}
    >
      {art ? (
        <img className="bp-toast-art" src={art} alt="" draggable={false} />
      ) : (
        <span className="bp-toast-icon" aria-hidden>
          <Icon name={toast.kind === 'app_update' ? 'download' : 'refresh'} size={22} />
        </span>
      )}
      <span className="bp-toast-text">
        <span className="bp-toast-title">{toast.title}</span>
        {body && <span className="bp-toast-body">{body}</span>}
        {hint && <span className="bp-toast-hint">{hint}</span>}
      </span>
    </button>
  );
}
