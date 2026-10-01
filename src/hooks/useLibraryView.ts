import { useViewMode, type ViewMode } from '../components/ui/ViewModeSwitch';
import { useSkin } from './useSkin';

const ALL_VIEWS: readonly ViewMode[] = ['covers', 'cards', 'list'];
/** The Steam skin already lists every game in its left panel. */
const STEAM_VIEWS: readonly ViewMode[] = ['covers', 'cards'];

/**
 * The library's view mode (shared by the library and its collection pages).
 * The Steam skin offers no list view, since its game list sits beside the
 * page; a saved "list" shows as cards there and comes back in the default
 * skin.
 */
export function useLibraryView(): {
  view: ViewMode;
  setView: (mode: ViewMode) => void;
  views: readonly ViewMode[];
} {
  const steam = useSkin() === 'steam';
  const [saved, setView] = useViewMode('library');
  const views = steam ? STEAM_VIEWS : ALL_VIEWS;
  return { view: views.includes(saved) ? saved : 'cards', setView, views };
}
