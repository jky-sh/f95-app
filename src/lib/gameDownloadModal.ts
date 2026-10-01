/**
 * Abre o modal global de download/atualização (montado uma vez no AppShell),
 * no mesmo padrão de `openManageCollections`: CustomEvent no `window`, sem
 * plumbing de contexto — menus de contexto (funções puras) também conseguem
 * disparar.
 */
import type { GameDetail } from '../types/game';
import type { SamCategory } from '../types/sam';

export const GAME_DOWNLOAD_MODAL_EVENT = 'f95:game-download-modal';

export interface GameDownloadModalDetail {
  threadId: string;
  category: SamCategory;
  /** 'install' = primeiro download; 'update' = baixar versão nova. */
  mode: 'install' | 'update';
  /** Título do jogo — exibido no cabeçalho enquanto os links carregam. */
  title: string;
  /** Rótulo da versão oferecida (update). Cai no version do detail se ausente. */
  versionLabel?: string | null;
  /** Detail já carregado (página da loja) — evita um segundo scrape. */
  detail?: GameDetail;
  /** Chamado quando um download começou de fato (ex.: página marca inLibrary). */
  onStarted?: () => void;
}

export function openGameDownloadModal(detail: GameDownloadModalDetail): void {
  window.dispatchEvent(new CustomEvent(GAME_DOWNLOAD_MODAL_EVENT, { detail }));
}
