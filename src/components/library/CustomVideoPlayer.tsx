import { useCallback, useEffect, useRef, useState } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import { useT } from '../../lib/i18n';
import {
  applyNativeFullscreenLayout,
  clearNativeFullscreenLayout,
  getVideoFullscreenTarget,
  isCustomVideoFullscreen,
  prepareWindowForVideoFullscreen,
  restoreWindowAfterVideoFullscreen,
  setVideoFullscreenChrome,
} from '../../lib/windowVideoFullscreen';

interface Props {
  src: string;
  filePath: string;
  title: string;
}

const VOLUME_KEY = 'f95app.mediaViewer.volume';
const SKIP_SEC = 10;

function readStoredVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '1');
    if (Number.isFinite(v)) return Math.min(1, Math.max(0, v));
  } catch {
    /* ignore */
  }
  return 1;
}

export function CustomVideoPlayer({ src, filePath, title }: Props) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(readStoredVolume);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [seeking, setSeeking] = useState(false);

  const effectiveVolume = muted ? 0 : volume;

  const bumpControls = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setShowControls(false);
    }, 3000);
  }, []);

  const syncPlaying = useCallback(() => {
    const v = videoRef.current;
    if (v) setPlaying(!v.paused);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = effectiveVolume;
  }, [effectiveVolume]);

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume]);

  useEffect(() => {
    setPipSupported(
      typeof document !== 'undefined' && 'pictureInPictureEnabled' in document,
    );
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    const v = videoRef.current;
    const onFs = () => {
      const fs = isCustomVideoFullscreen(el);
      setIsFullscreen(fs);
      setVideoFullscreenChrome(fs);
      if (fs) {
        requestAnimationFrame(() => applyNativeFullscreenLayout(el));
      } else {
        clearNativeFullscreenLayout(el);
        void restoreWindowAfterVideoFullscreen();
      }
    };
    const onPip = () => {
      setIsPip(document.pictureInPictureElement === v);
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    v?.addEventListener('enterpictureinpicture', onPip);
    v?.addEventListener('leavepictureinpicture', onPip);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
      v?.removeEventListener('enterpictureinpicture', onPip);
      v?.removeEventListener('leavepictureinpicture', onPip);
    };
  }, [src]);

  useEffect(() => {
    if (!isFullscreen) return;
    const el = containerRef.current;
    const sync = () => applyNativeFullscreenLayout(el);
    sync();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', sync);
    window.addEventListener('resize', sync);
    return () => {
      vv?.removeEventListener('resize', sync);
      window.removeEventListener('resize', sync);
    };
  }, [isFullscreen]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => setPlaying(false));
    containerRef.current?.focus();
    bumpControls();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [src, bumpControls]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => undefined);
    } else {
      v.pause();
      setShowControls(true);
    }
    syncPlaying();
    bumpControls();
  }, [bumpControls, syncPlaying]);

  const seekTo = useCallback((time: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(time)) return;
    v.currentTime = Math.min(Math.max(0, time), v.duration || time);
    setCurrent(v.currentTime);
  }, []);

  const skip = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      seekTo((v.currentTime || 0) + delta);
      bumpControls();
    },
    [seekTo, bumpControls],
  );

  const exitFullscreen = useCallback(async () => {
    const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> };
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
    } catch {
      /* ignore */
    }
    clearNativeFullscreenLayout(containerRef.current);
    setVideoFullscreenChrome(false);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    const target = getVideoFullscreenTarget(el);
    const node = target as HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> };

    if (isCustomVideoFullscreen(el)) {
      await exitFullscreen();
    } else {
      await prepareWindowForVideoFullscreen();
      try {
        if (target.requestFullscreen) {
          await target.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
        } else {
          await node.webkitRequestFullscreen?.();
        }
      } catch {
        try {
          if (target.requestFullscreen) await target.requestFullscreen();
          else await node.webkitRequestFullscreen?.();
        } catch {
          /* webview may block */
        }
      }
    }
    requestAnimationFrame(() => applyNativeFullscreenLayout(containerRef.current));
    containerRef.current?.focus();
    bumpControls();
  }, [exitFullscreen, bumpControls]);

  const togglePip = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !pipSupported) return;
    try {
      if (document.pictureInPictureElement === v) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      /* not allowed */
    }
    bumpControls();
  }, [pipSupported, bumpControls]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;

      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          e.stopPropagation();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          e.preventDefault();
          e.stopPropagation();
          skip(-SKIP_SEC);
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          e.preventDefault();
          e.stopPropagation();
          skip(SKIP_SEC);
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setVolume((vol) => {
            const next = Math.min(1, vol + 0.1);
            setMuted(false);
            return next;
          });
          bumpControls();
          break;
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setVolume((vol) => Math.max(0, vol - 0.1));
          bumpControls();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          e.stopPropagation();
          setMuted((m) => !m);
          bumpControls();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          e.stopPropagation();
          void toggleFullscreen();
          break;
        case 'p':
        case 'P':
          if (pipSupported) {
            e.preventDefault();
            e.stopPropagation();
            void togglePip();
          }
          break;
        case 'Escape': {
          if (isCustomVideoFullscreen(containerRef.current)) {
            e.preventDefault();
            e.stopPropagation();
            void exitFullscreen();
            break;
          }
          if (document.pictureInPictureElement === v) {
            e.preventDefault();
            e.stopPropagation();
            void document.exitPictureInPicture();
          }
          break;
        }
        case 'Home':
          e.preventDefault();
          seekTo(0);
          break;
        case 'End':
          e.preventDefault();
          seekTo(v.duration);
          break;
        default:
          break;
      }
    },
    [togglePlay, skip, toggleFullscreen, togglePip, pipSupported, seekTo, bumpControls, exitFullscreen],
  );

  const progressPct = duration > 0 ? (current / duration) * 100 : 0;
  const bufferPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const showCenterPlay = !playing && !seeking && showControls;

  return (
    <div
      ref={containerRef}
      className="custom-video"
      tabIndex={0}
      role="application"
      aria-label={title}
      onKeyDown={handleKeyDown}
      onMouseMove={bumpControls}
      onMouseLeave={() => {
        if (videoRef.current && !videoRef.current.paused) setShowControls(false);
      }}
      onClick={() => containerRef.current?.focus()}
    >
      <video
        ref={videoRef}
        className="custom-video-el"
        src={src}
        playsInline
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          void toggleFullscreen();
        }}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(el.duration);
          setCurrent(0);
        }}
        onTimeUpdate={(e) => {
          if (!seeking) setCurrent(e.currentTarget.currentTime);
        }}
        onProgress={(e) => {
          const el = e.currentTarget;
          if (el.buffered.length > 0) {
            setBuffered(el.buffered.end(el.buffered.length - 1));
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setShowControls(true);
        }}
      />

      <div
        className={`custom-video-overlay${showControls ? ' custom-video-overlay--visible' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="custom-video-top">
          <span className="custom-video-title" title={title}>
            {title}
          </span>
        </div>

        {showCenterPlay && (
          <button
            type="button"
            className="custom-video-center-play"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            aria-label={t('mediaViewer.play')}
          >
            <PlayIcon large />
          </button>
        )}

        <div className="custom-video-bottom">
          <div className="custom-video-progress-wrap">
            <div className="custom-video-progress-buffer" style={{ width: `${bufferPct}%` }} />
            <div className="custom-video-progress-fill" style={{ width: `${progressPct}%` }} />
            <input
              type="range"
              className="custom-video-progress"
              min={0}
              max={duration || 100}
              step={0.1}
              value={current}
              onChange={(e) => {
                setSeeking(true);
                setCurrent(Number(e.target.value));
              }}
              onMouseUp={(e) => {
                seekTo(Number((e.target as HTMLInputElement).value));
                setSeeking(false);
              }}
              onTouchEnd={(e) => {
                seekTo(Number((e.target as HTMLInputElement).value));
                setSeeking(false);
              }}
            />
          </div>

          <div className="custom-video-controls">
            <div className="custom-video-controls-left">
              <button
                type="button"
                className="custom-video-btn"
                onClick={togglePlay}
                aria-label={playing ? t('mediaViewer.pause') : t('mediaViewer.play')}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>

              <SkipButton
                direction="back"
                seconds={SKIP_SEC}
                label={t('mediaViewer.rewind')}
                onClick={() => skip(-SKIP_SEC)}
              />
              <SkipButton
                direction="forward"
                seconds={SKIP_SEC}
                label={t('mediaViewer.forward')}
                onClick={() => skip(SKIP_SEC)}
              />

              <span className="custom-video-time">
                {formatTime(current)} / {formatTime(duration)}
              </span>
            </div>

            <div className="custom-video-controls-right">
              <div className="custom-video-volume">
                <button
                  type="button"
                  className="custom-video-btn"
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? t('mediaViewer.unmute') : t('mediaViewer.mute')}
                >
                  {muted || volume === 0 ? <VolumeMuteIcon /> : <VolumeIcon />}
                </button>
                <input
                  type="range"
                  className="custom-video-volume-slider"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setVolume(val);
                    if (val > 0) setMuted(false);
                  }}
                />
              </div>

              {pipSupported && (
                <button
                  type="button"
                  className={`custom-video-btn${isPip ? ' custom-video-btn--active' : ''}`}
                  onClick={() => void togglePip()}
                  title={isPip ? t('mediaViewer.exitPip') : t('mediaViewer.pip')}
                  aria-label={isPip ? t('mediaViewer.exitPip') : t('mediaViewer.pip')}
                >
                  <PipIcon active={isPip} />
                </button>
              )}

              <button
                type="button"
                className="custom-video-btn"
                onClick={() => void toggleFullscreen()}
                title={isFullscreen ? t('mediaViewer.exitFullscreen') : t('mediaViewer.fullscreen')}
              >
                {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
              </button>

              <button
                type="button"
                className="custom-video-btn"
                onClick={() => openPath(filePath)}
                title={t('mediaViewer.openExternal')}
              >
                <ExternalIcon />
              </button>
            </div>
          </div>

          {!isFullscreen && (
            <p className="custom-video-kbd-hint">{t('mediaViewer.videoKeyboardHint')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SkipButton({
  direction,
  seconds,
  label,
  onClick,
}: {
  direction: 'back' | 'forward';
  seconds: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="custom-video-skip"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {direction === 'back' ? <ReplayIcon /> : <ForwardIcon />}
      <span className="custom-video-skip-num">{seconds}</span>
    </button>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function ReplayIcon() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="currentColor" aria-hidden>
      <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="currentColor" aria-hidden>
      <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
    </svg>
  );
}

function PipIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden>
      {active ? (
        <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
      ) : (
        <path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z" />
      )}
    </svg>
  );
}

function PlayIcon({ large }: { large?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={large ? 64 : 22}
      height={large ? 64 : 22}
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden>
      <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.74 2.5-2.26 2.5-4.02z" />
    </svg>
  );
}

function VolumeMuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden>
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden>
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden>
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden>
      <path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
    </svg>
  );
}
