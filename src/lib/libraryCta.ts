import type { LibraryGame } from '../types/library';

type T = (k: string, v?: Record<string, string | number>) => string;

export type LibraryCtaIntent = 'play' | 'stop' | 'pick-exe' | 'update' | 'noop' | 'view';

export interface LibraryCta {
  label: string;
  title: string;
  disabled: boolean;
  intent: LibraryCtaIntent;
}

/** The one action a library entry offers first (every view shows the same). */
export function primaryCta(g: LibraryGame, isRunning: boolean, t: T): LibraryCta {
  if (isRunning && g.category === 'games') {
    return { label: t('libcard.cta.stop'), title: t('libcard.cta.stop.title'), disabled: false, intent: 'stop' };
  }
  switch (g.installStatus) {
    case 'installed':
      if (g.category !== 'games') {
        if (g.installPath) return mediaCta(g, t);
        return { label: t('libcard.cta.pickExe'), title: t('libcard.cta.pickExe.title'), disabled: false, intent: 'pick-exe' };
      }
      return g.exePath
        ? { label: t('libcard.cta.play'), title: t('libcard.cta.play.title'), disabled: false, intent: 'play' }
        : { label: t('libcard.cta.pickExe'), title: t('libcard.cta.pickExe.title'), disabled: false, intent: 'pick-exe' };
    case 'downloading':
      return { label: t('libcard.cta.downloading'), title: t('libcard.cta.inFlight.title'), disabled: true, intent: 'noop' };
    case 'extracting':
      return { label: t('libcard.cta.extracting'), title: t('libcard.cta.inFlight.title'), disabled: true, intent: 'noop' };
    case 'update_available':
      // Playable with an update pending: Play stays first; the status badge
      // shows the update, which lives in the menu and on the game page.
      if (g.category === 'games' && g.exePath) {
        return {
          label: t('libcard.cta.play'),
          title: g.availableVersion
            ? t('libcard.cta.updatePlayable.title', { version: g.availableVersion })
            : t('libcard.cta.play.title'),
          disabled: false,
          intent: 'play',
        };
      }
      return {
        label: g.availableVersion
          ? t('libcard.cta.updateTo', { version: g.availableVersion })
          : t('libcard.cta.update'),
        title: g.availableVersion
          ? t('libcard.cta.update.title', { version: g.availableVersion })
          : t('libcard.cta.update.titleSimple'),
        disabled: false,
        intent: 'update',
      };
    case 'error':
      return { label: t('libcard.cta.error'), title: t('libcard.cta.error.title'), disabled: true, intent: 'noop' };
    case 'not_installed':
    default:
      return { label: t('libcard.cta.pickExe'), title: t('libcard.cta.pickExe.title'), disabled: false, intent: 'pick-exe' };
  }
}

function mediaCta(g: LibraryGame, t: T): LibraryCta {
  switch (g.category) {
    case 'comics':
      return { label: t('libcard.cta.read'), title: t('libcard.cta.read.title'), disabled: false, intent: 'view' };
    case 'animations':
      return { label: t('libcard.cta.watch'), title: t('libcard.cta.watch.title'), disabled: false, intent: 'view' };
    case 'assets':
      return { label: t('libcard.cta.browse'), title: t('libcard.cta.browse.title'), disabled: false, intent: 'view' };
    case 'mods':
      return g.exePath
        ? { label: t('libcard.cta.open'), title: t('libcard.cta.open.title'), disabled: false, intent: 'view' }
        : { label: t('libcard.cta.browse'), title: t('libcard.cta.browse.title'), disabled: false, intent: 'view' };
    default:
      return { label: t('libcard.cta.browse'), title: t('libcard.cta.browse.title'), disabled: false, intent: 'view' };
  }
}
