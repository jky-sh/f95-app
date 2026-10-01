export interface AchievementDefinition {
  id: string;
  threadId: string | null;
  title: string;
  description: string | null;
  iconKey: string | null;
  points: number;
  hidden: boolean;
  sortOrder: number;
}

export interface AchievementUnlock {
  threadId: string;
  achievementId: string;
  unlockedAt: string;
  progressJson: string | null;
}

export interface AchievementStats {
  total: number;
  unlocked: number;
  points: number;
}

/* ── Achievements Steam (integração estilo Hydra) ─────────────────────── */

/** Uma conquista Steam já combinada: schema + estado de unlock do jogador. */
export interface SteamAchievement {
  apiName: string;
  displayName: string;
  description: string;
  iconUrl: string;
  iconGrayUrl: string;
  hidden: boolean;
  /** % global de jogadores que desbloquearam (raridade). */
  globalPercent: number | null;
  unlocked: boolean;
  /** Epoch ms do unlock; null se o formato do crack não guarda horário. */
  unlockTime: number | null;
}

export interface SteamAchievementStats {
  total: number;
  unlocked: number;
}

/** Payload do evento Rust `achievement:sync` (watcher → frontend). */
export interface AchievementSyncPayload {
  threadId: string;
  appId: string;
  /** true na primeira passada (baseline): persistir sem notificar. */
  initial: boolean;
  achievements: {
    apiName: string;
    unlockTime: number | null;
    source: string;
  }[];
}
