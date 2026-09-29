import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gameDetail } from '../lib/ipc';
import {
  GAME_DOWNLOAD_MODAL_EVENT,
  type GameDownloadModalDetail,
} from '../lib/gameDownloadModal';
import { DownloadLinks } from './game/DownloadLinks';
import { LoadingState } from './ui/LoadingState';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import type { GameDetail } from '../types/game';

type BodyState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: GameDetail };

/**
 * Modal global de escolha de fonte de download — instalar um jogo ou baixar
 * uma atualização sem sair da tela atual. Montado uma vez no AppShell; abre
 * via `openGameDownloadModal()` de qualquer lugar (páginas, menus de
 * contexto, cards). Fecha sozinho quando um download começa.
 */
export function GameDownloadModal() {
  const { t } = useT();
  const navigate = useNavigate();
  const { isOffline } = useOffline();
  const [request, setRequest] = useState<GameDownloadModalDetail | null>(null);
  const [body, setBody] = useState<BodyState>({ kind: 'loading' });

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<GameDownloadModalDetail>).detail;
      if (!detail?.threadId) return;
      setRequest(detail);
    }
    window.addEventListener(GAME_DOWNLOAD_MODAL_EVENT, onOpen);
    return () => window.removeEventListener(GAME_DOWNLOAD_MODAL_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!request) return;
    if (request.detail) {
      setBody({ kind: 'ready', data: request.detail });
      return;
    }
    if (isOffline) {
      setBody({ kind: 'error', message: t('offline.actionBlocked') });
      return;
    }
    let cancelled = false;
    setBody({ kind: 'loading' });
    gameDetail(request.threadId)
      .then((data) => {
        if (!cancelled) setBody({ kind: 'ready', data });
      })
      .catch((err) => {
        if (!cancelled) setBody({ kind: 'error', message: formatError(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (!request) return null;

  const close = () => setRequest(null);
  const isUpdate = request.mode === 'update';
  const version =
    request.versionLabel ??
    (body.kind === 'ready' ? body.data.version : null);
  const title = isUpdate
    ? t('modal.gdl.updateTitle', { title: request.title })
    : t('modal.gdl.installTitle', { title: request.title });
  const hint =
    isUpdate && version
      ? t('modal.gdl.updateHint', { version })
      : t('modal.gdl.installHint');

  return (
    <div style={overlayStyle} onClick={close}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={titleStyle}>{title}</h2>
        <div style={descStyle}>{hint}</div>

        <div style={bodyStyle}>
          {body.kind === 'loading' && (
            <LoadingState label={t('common.loading')} variant="compact" />
          )}

          {body.kind === 'error' && (
            <div style={errorStyle}>
              <p style={{ margin: 0 }}>
                {t('modal.gdl.loadFailed', { error: body.message })}
              </p>
              <button
                type="button"
                className="dl-action-btn"
                onClick={() => {
                  close();
                  navigate(
                    `/store/game/${request.threadId}?cat=${request.category}`,
                  );
                }}
              >
                {t('modal.gdl.openStore')}
              </button>
            </div>
          )}

          {body.kind === 'ready' && (
            <DownloadLinks
              embedded
              game={{
                threadId: body.data.threadId,
                category: request.category,
                title: body.data.title,
                threadUrl: body.data.threadUrl,
                thumbnailUrl: body.data.bannerUrl,
                version: body.data.version,
              }}
              downloads={body.data.downloads}
              social={[]}
              onDownloadStarted={() => {
                request.onStarted?.();
                close();
              }}
            />
          )}
        </div>

        <div style={footerStyle}>
          <button style={cancelBtnStyle} onClick={close}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '20px 22px',
  width: 'min(560px, calc(100vw - 40px))',
  maxHeight: 'calc(100vh - 80px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
};
const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 700,
  color: 'var(--text-primary)',
};
const descStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-tertiary)',
};
const bodyStyle: React.CSSProperties = {
  overflow: 'auto',
  minHeight: 80,
  maxHeight: 'min(420px, calc(100vh - 260px))',
};
const errorStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 10,
  padding: '12px 0',
  fontSize: 13,
  color: 'var(--text-secondary)',
};
const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: 4,
};
const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border-strong)',
  padding: '6px 14px',
  borderRadius: 3,
  fontSize: 13,
  cursor: 'pointer',
};
