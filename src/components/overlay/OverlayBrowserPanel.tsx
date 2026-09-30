import { useCallback, useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useT } from '../../lib/i18n';
import {
  closeOverlayBrowserWindow,
  useOverlayEmbeddedWebview,
} from './useOverlayEmbeddedWebview';

interface Props {
  enabled: boolean;
  homeUrl: string;
  boundsKey: string;
  /** A link another panel asked to open; a new nonce navigates again. */
  request?: { url: string; nonce: number } | null;
  /** Bumped each time the overlay is shown: closing it tears the page down. */
  showKey?: number;
}

function normalizeUrl(input: string, fallback: string): string {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function OverlayBrowserPanel({ enabled, homeUrl, boundsKey, request = null, showKey = 0 }: Props) {
  const { t } = useT();
  const frameRef = useRef<HTMLDivElement>(null);
  const firstUrl = normalizeUrl(request?.url ?? homeUrl, homeUrl);
  const [urlInput, setUrlInput] = useState(firstUrl);
  const [currentUrl, setCurrentUrl] = useState(firstUrl);
  const [history, setHistory] = useState<string[]>([firstUrl]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const { focusBrowser } = useOverlayEmbeddedWebview(
    frameRef,
    currentUrl,
    enabled,
    boundsKey,
    reloadNonce * 1000 + showKey,
  );

  const navigate = useCallback(
    (raw: string) => {
      const next = normalizeUrl(raw, homeUrl);
      setUrlInput(next);
      setCurrentUrl(next);
      setLoading(true);
      setHistory((h) => [...h.slice(0, historyIdx + 1), next]);
      setHistoryIdx((i) => i + 1);
      window.setTimeout(() => setLoading(false), 1200);
    },
    [historyIdx, homeUrl],
  );

  // Links from the other panels (guides, the game's thread) open here.
  const lastRequest = useRef(request?.nonce ?? 0);
  useEffect(() => {
    if (!request || request.nonce === lastRequest.current) return;
    lastRequest.current = request.nonce;
    navigate(request.url);
  }, [request, navigate]);

  const goBack = useCallback(() => {
    if (historyIdx <= 0) return;
    const idx = historyIdx - 1;
    const next = history[idx];
    setHistoryIdx(idx);
    setUrlInput(next);
    setCurrentUrl(next);
  }, [history, historyIdx]);

  const goForward = useCallback(() => {
    if (historyIdx >= history.length - 1) return;
    const idx = historyIdx + 1;
    const next = history[idx];
    setHistoryIdx(idx);
    setUrlInput(next);
    setCurrentUrl(next);
  }, [history, historyIdx]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadNonce((n) => n + 1);
    window.setTimeout(() => setLoading(false), 1200);
  }, []);

  if (!enabled) {
    return (
      <div className="game-overlay-panel-fill game-overlay-panel--disabled">
        {t('overlay.browser.disabled')}
      </div>
    );
  }

  return (
    <div className="game-overlay-browser">
      <div className="game-overlay-browser-toolbar">
        <button
          type="button"
          className="game-overlay-browser-btn"
          onClick={goBack}
          disabled={historyIdx <= 0}
          title={t('overlay.browser.back')}
        >
          ‹
        </button>
        <button
          type="button"
          className="game-overlay-browser-btn"
          onClick={goForward}
          disabled={historyIdx >= history.length - 1}
          title={t('overlay.browser.forward')}
        >
          ›
        </button>
        <button
          type="button"
          className="game-overlay-browser-btn"
          onClick={refresh}
          title={t('overlay.browser.refresh')}
        >
          ↻
        </button>
        <form
          className="game-overlay-browser-urlbar"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(urlInput);
          }}
        >
          <input
            className="game-overlay-browser-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            spellCheck={false}
            aria-label={t('overlay.browser.url')}
          />
          <button type="submit" className="game-overlay-browser-go">
            {t('overlay.browser.go')}
          </button>
        </form>
        <button
          type="button"
          className="game-overlay-browser-btn"
          onClick={() => void openUrl(currentUrl)}
          title={t('overlay.browser.openExternal')}
        >
          ↗
        </button>
      </div>
      <div
        ref={frameRef}
        className="game-overlay-browser-frame-wrap"
        onPointerDown={() => focusBrowser()}
      >
        {loading && (
          <div className="game-overlay-browser-loading">{t('overlay.browser.loading')}</div>
        )}
      </div>
    </div>
  );
}

export async function closeOverlayEmbeddedBrowser(): Promise<void> {
  await closeOverlayBrowserWindow();
}
