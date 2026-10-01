import { getCurrentWindow } from '@tauri-apps/api/window';

async function waitForWindowLayout(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Elemento que entra em requestFullscreen (stage cobre a área útil sem faixa no WebView2). */
export function getVideoFullscreenTarget(container: HTMLElement): HTMLElement {
  return container.closest<HTMLElement>('.media-viewer-stage') ?? container;
}

export function getActiveFullscreenElement(): HTMLElement | null {
  const doc = document as Document & { webkitFullscreenElement?: Element };
  const el = document.fullscreenElement ?? doc.webkitFullscreenElement;
  return el instanceof HTMLElement ? el : null;
}

export function isCustomVideoFullscreen(container: HTMLElement | null): boolean {
  if (!container) return false;
  const fs = getActiveFullscreenElement();
  if (!fs) return false;
  const target = getVideoFullscreenTarget(container);
  return fs === container || fs === target;
}

/** A janela estava maximizada antes do fullscreen do vídeo. */
let restoreMaximized = false;

/**
 * Maximizar quebra o cálculo de :fullscreen no WebView2/Tauri (sobra uma faixa
 * preta da altura da barra de tarefas): restaura a janela antes.
 */
export async function prepareWindowForVideoFullscreen(): Promise<void> {
  try {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
      restoreMaximized = true;
      await waitForWindowLayout();
    }
  } catch {
    /* browser dev */
  }
}

/** Ao sair do fullscreen do vídeo: maximiza de novo se estava maximizada. */
export async function restoreWindowAfterVideoFullscreen(): Promise<void> {
  if (!restoreMaximized) return;
  restoreMaximized = false;
  try {
    await waitForWindowLayout();
    await getCurrentWindow().maximize();
  } catch {
    /* browser dev */
  }
}

export function setVideoFullscreenChrome(active: boolean): void {
  document.documentElement.classList.toggle('f95-video-fs', active);
}

/**
 * WebView2: visualViewport.height < innerHeight deixa faixa preta embaixo.
 * Ajusta o elemento em :fullscreen (stage ou player) com innerHeight.
 */
export function applyNativeFullscreenLayout(container: HTMLElement | null): void {
  if (!container || !isCustomVideoFullscreen(container)) return;

  const fsEl = getActiveFullscreenElement();
  if (!fsEl) return;

  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const left = vv?.offsetLeft ?? 0;
  const h = window.innerHeight;
  const w = window.innerWidth;

  fsEl.style.setProperty('top', `${top}px`, 'important');
  fsEl.style.setProperty('left', `${left}px`, 'important');
  fsEl.style.setProperty('right', 'auto', 'important');
  fsEl.style.setProperty('bottom', 'auto', 'important');
  fsEl.style.setProperty('width', `${w}px`, 'important');
  fsEl.style.setProperty('height', `${h}px`, 'important');
  fsEl.style.setProperty('max-width', `${w}px`, 'important');
  fsEl.style.setProperty('max-height', `${h}px`, 'important');
  fsEl.style.setProperty('margin', '0', 'important');
  fsEl.style.setProperty('padding', '0', 'important');
  fsEl.style.setProperty('box-sizing', 'border-box', 'important');
}

export function clearNativeFullscreenLayout(container: HTMLElement | null): void {
  if (!container) return;
  const fsEl = getActiveFullscreenElement();
  const target = getVideoFullscreenTarget(container);
  const nodes = new Set<HTMLElement>([container, target]);
  if (fsEl) nodes.add(fsEl);
  for (const el of nodes) {
    for (const prop of [
      'top',
      'left',
      'right',
      'bottom',
      'width',
      'height',
      'max-width',
      'max-height',
      'margin',
      'padding',
      'box-sizing',
    ] as const) {
      el.style.removeProperty(prop);
    }
  }
}
