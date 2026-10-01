import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBigPictureState } from '../lib/bigPicture';
import { useT } from '../lib/i18n';
import { APP_TOAST_EVENT, type AppToast } from '../lib/updateNotifier';
import { Icon } from './ui/Icon';
import '../styles/app-toast.css';

const TOAST_MS = 8000;

/**
 * Update toasts in the desktop interface while the window is in front
 * (updateNotifier sends system notifications otherwise). Big Picture shows
 * its own. Hovering keeps a toast up.
 */
export function AppToastHost() {
  const { t } = useT();
  const navigate = useNavigate();
  const bigPicture = useBigPictureState().status !== 'closed';
  const [current, setCurrent] = useState<{ id: number; toast: AppToast } | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (bigPicture) {
      setCurrent(null);
      return;
    }
    const onToast = (e: Event) => {
      const toast = (e as CustomEvent<AppToast>).detail;
      if (toast) setCurrent((prev) => ({ id: (prev?.id ?? 0) + 1, toast }));
    };
    window.addEventListener(APP_TOAST_EVENT, onToast);
    return () => window.removeEventListener(APP_TOAST_EVENT, onToast);
  }, [bigPicture]);

  useEffect(() => {
    if (!current || hovered) return;
    const timer = window.setTimeout(() => setCurrent(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [current, hovered]);

  if (!current) return null;
  const { toast } = current;

  const open = () => {
    setCurrent(null);
    setHovered(false);
    if (toast.kind === 'app_update') {
      window.dispatchEvent(new CustomEvent('f95:open-version-modal'));
    } else if (toast.games.length === 1) {
      navigate(`/library/game/${toast.games[0].threadId}`);
    } else {
      navigate('/library?st=update_available');
    }
  };
  const art = toast.kind === 'game_update' ? toast.games[0]?.thumbnailUrl : null;

  return (
    <div
      key={current.id}
      className="app-toast"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button type="button" className="app-toast-main" onClick={open}>
        {art ? (
          <img className="app-toast-art" src={art} alt="" />
        ) : (
          <span className="app-toast-icon" aria-hidden>
            <Icon name={toast.kind === 'app_update' ? 'download' : 'refresh'} size={18} />
          </span>
        )}
        <span className="app-toast-text">
          <span className="app-toast-title">{toast.title}</span>
          {toast.body && <span className="app-toast-body">{toast.body}</span>}
          <span className="app-toast-action">
            {toast.kind === 'app_update' ? t('notify.action.details') : t('notify.action.view')}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="app-toast-close"
        aria-label={t('common.close')}
        title={t('common.close')}
        onClick={() => {
          setCurrent(null);
          setHovered(false);
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
