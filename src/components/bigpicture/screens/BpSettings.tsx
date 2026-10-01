import { useT } from '../../../lib/i18n';
import {
  enterBigPictureFullscreen,
  leaveBigPictureFullscreen,
  saveBigPicturePrefs,
  useBigPicturePrefs,
  type BigPicturePrefs,
} from '../../../lib/bigPicture';
import { Icon } from '../../ui/Icon';
import { useBp } from '../BpContext';
import { BpGlyph, type BpGlyphAction } from '../BpGlyph';
import { BpHeading } from '../BpParts';
import { playSound, setSoundsEnabled } from '../bpSound';

function Toggle({
  on,
  label,
  hint,
  onChange,
  autoFocus,
}: {
  on: boolean;
  label: string;
  hint: string;
  onChange: (on: boolean) => void;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="bp-toggle bp-focusable"
      data-bp-autofocus={autoFocus || undefined}
      onClick={() => onChange(!on)}
    >
      <span className="bp-toggle-text">
        <span className="bp-toggle-label">{label}</span>
        <span className="bp-toggle-hint">{hint}</span>
      </span>
      <span className="bp-switch" aria-hidden>
        <span className="bp-switch-knob" />
      </span>
    </button>
  );
}

const CONTROLS: { action: BpGlyphAction; labelKey: string }[] = [
  { action: 'accept', labelKey: 'bp.hint.select' },
  { action: 'back', labelKey: 'bp.hint.back' },
  { action: 'options', labelKey: 'bp.hint.options' },
  { action: 'search', labelKey: 'bp.hint.search' },
  { action: 'prevTab', labelKey: 'bp.controls.prevTab' },
  { action: 'nextTab', labelKey: 'bp.controls.nextTab' },
  { action: 'menu', labelKey: 'bp.hint.menu' },
];

/** Big Picture's own preferences, reachable from the menu. */
export function BpSettings() {
  const { t } = useT();
  const bp = useBp();
  const prefs = useBigPicturePrefs();

  const set = (patch: Partial<BigPicturePrefs>) => void saveBigPicturePrefs(patch);

  return (
    <div className="bp-screen-body bp-page bp-settings" data-bp-scroll-y="">
      <h1 className="bp-page-title">{t('bp.settings')}</h1>

      <div className="bp-settings-columns">
        <section>
          <div className="bp-toggle-list">
            <Toggle
              on={prefs.sounds}
              label={t('bp.settings.sounds')}
              hint={t('bp.settings.sounds.hint')}
              autoFocus
              onChange={(sounds) => {
                set({ sounds });
                setSoundsEnabled(sounds);
                if (sounds) playSound('toggle');
              }}
            />
            <Toggle
              on={prefs.intro}
              label={t('bp.settings.intro')}
              hint={t('bp.settings.intro.hint')}
              onChange={(intro) => set({ intro })}
            />
            <Toggle
              on={prefs.fullscreen}
              label={t('bp.settings.fullscreen')}
              hint={t('bp.settings.fullscreen.hint')}
              onChange={(fullscreen) => {
                set({ fullscreen });
                void (fullscreen ? enterBigPictureFullscreen() : leaveBigPictureFullscreen());
              }}
            />
            <Toggle
              on={prefs.onStartup}
              label={t('bp.settings.startup')}
              hint={t('bp.settings.startup.hint')}
              onChange={(onStartup) => set({ onStartup })}
            />
          </div>
          <div className="bp-actions">
            <button type="button" className="bp-btn bp-focusable" onClick={() => bp.exit('/settings')}>
              <Icon name="settings" size={20} />
              {t('bp.settings.appSettings')}
            </button>
            <button type="button" className="bp-btn bp-btn--danger bp-focusable" onClick={() => bp.exit()}>
              <Icon name="power" size={20} />
              {t('bp.exit')}
            </button>
          </div>
        </section>

        <section>
          <BpHeading title={t('bp.controls')} />
          <ul className="bp-controls">
            {CONTROLS.map((c) => (
              <li key={c.action} className="bp-control">
                <BpGlyph action={c.action} />
                <span>{t(c.labelKey)}</span>
              </li>
            ))}
            <li className="bp-control">
              <span className="bp-glyph bp-glyph--key">F11</span>
              <span>{t('bp.settings.fullscreen')}</span>
            </li>
          </ul>
          <p className="bp-muted">{t('bp.controls.note')}</p>
        </section>
      </div>
    </div>
  );
}
