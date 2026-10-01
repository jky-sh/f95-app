import { useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useOffline } from '../../contexts/Offline';
import {
  normalizeVersion,
  prepareReleaseHtml,
  refreshAppReleases,
  RELEASES_PAGE_URL,
  useAppReleases,
  type AppRelease,
} from '../../lib/appReleases';
import { getChangelogEntries, type ChangelogEntry } from '../../lib/changelog';
import { useT, type TFunction } from '../../lib/i18n';
import { LoadingState } from '../ui/LoadingState';

interface Props {
  /** The running app's version, marked in the list. */
  currentVersion: string | null;
  /** Versions shown before "Show more versions". */
  initialCount: number;
  className?: string;
}

/**
 * The app's changelog in Settings → About and the version modal: the notes
 * of every release published on GitHub, or the CHANGELOG.md bundled with
 * the build when GitHub can't be reached and nothing was saved before.
 */
export function AppChangelog({ currentVersion, initialCount, className }: Props) {
  const { t, locale } = useT();
  const { isOffline } = useOffline();
  const { releases, loading, failed } = useAppReleases(currentVersion, !isOffline);
  const [expanded, setExpanded] = useState(false);
  const bundled = useMemo(() => getChangelogEntries(), []);
  const current = currentVersion ? normalizeVersion(currentVersion) : null;
  const fromGithub = releases != null && releases.length > 0;

  if (!fromGithub && loading) {
    return <LoadingState variant="inline" label={t('settings.changelog.loading')} />;
  }

  const total = fromGithub ? releases.length : bundled.length;
  const shown = expanded ? total : initialCount;
  const notice = !fromGithub
    ? t('settings.changelog.bundled')
    : failed
      ? t('settings.changelog.refreshFailed')
      : null;

  return (
    <>
      {notice && (
        <p className="settings-changelog-notice">
          <span>{notice}</span>
          {!isOffline && (
            <button
              type="button"
              className="settings-changelog-link"
              disabled={loading}
              onClick={() => void refreshAppReleases()}
            >
              {t('common.retry')}
            </button>
          )}
        </p>
      )}
      <div className={className ? `settings-changelog ${className}` : 'settings-changelog'}>
        {fromGithub
          ? releases
              .slice(0, shown)
              .map((release) => (
                <ReleaseEntry
                  key={release.version}
                  release={release}
                  current={release.version === current}
                  locale={locale}
                  t={t}
                />
              ))
          : bundled
              .slice(0, shown)
              .map((entry) => (
                <BundledEntry
                  key={`${entry.version}-${entry.date ?? 'na'}`}
                  entry={entry}
                  current={normalizeVersion(entry.version) === current}
                  locale={locale}
                  t={t}
                />
              ))}
      </div>
      <div className="settings-changelog-actions">
        {total > initialCount && (
          <button
            type="button"
            className="settings-toolbar-btn settings-toolbar-btn-ghost"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t('settings.changelog.showLess') : t('settings.changelog.showMore')}
          </button>
        )}
        <button
          type="button"
          className="settings-toolbar-btn settings-toolbar-btn-ghost"
          onClick={() => void openUrl(RELEASES_PAGE_URL)}
        >
          {t('settings.changelog.viewAll')}
        </button>
      </div>
    </>
  );
}

function formatDay(value: string, locale: string): string {
  // A bare day (CHANGELOG.md) is a local date, not UTC midnight.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Links in the notes open in the browser instead of navigating the app window. */
function openNotesLink(e: React.MouseEvent) {
  const anchor = (e.target as HTMLElement).closest('a');
  const href = anchor?.getAttribute('href');
  if (!anchor || !href) return;
  e.preventDefault();
  if (/^https?:/i.test(href)) void openUrl(href);
}

function EntryHead({
  label,
  date,
  current,
  prerelease,
  locale,
  t,
}: {
  label: string;
  date: string | null;
  current: boolean;
  prerelease?: boolean;
  locale: string;
  t: TFunction;
}) {
  return (
    <header className="settings-changelog-head">
      <h4 className="settings-changelog-version">
        {label}
        {current && <span className="settings-changelog-badge">{t('settings.changelog.current')}</span>}
        {prerelease && (
          <span className="settings-changelog-badge settings-changelog-badge--muted">
            {t('settings.changelog.prerelease')}
          </span>
        )}
      </h4>
      {date && (
        <time className="settings-changelog-date" dateTime={date}>
          {formatDay(date, locale)}
        </time>
      )}
    </header>
  );
}

function ReleaseEntry({
  release,
  current,
  locale,
  t,
}: {
  release: AppRelease;
  current: boolean;
  locale: string;
  t: TFunction;
}) {
  const html = useMemo(() => prepareReleaseHtml(release.html), [release.html]);
  return (
    <article className="settings-changelog-entry">
      <EntryHead
        label={`v${release.version}`}
        date={release.publishedAt}
        current={current}
        prerelease={release.prerelease}
        locale={locale}
        t={t}
      />
      {html ? (
        <div
          className="settings-changelog-notes"
          onClick={openNotesLink}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="settings-changelog-empty">{t('settings.changelog.noNotes')}</p>
      )}
    </article>
  );
}

function BundledEntry({
  entry,
  current,
  locale,
  t,
}: {
  entry: ChangelogEntry;
  current: boolean;
  locale: string;
  t: TFunction;
}) {
  return (
    <article className="settings-changelog-entry">
      <EntryHead
        label={
          entry.version === 'Unreleased'
            ? t('settings.changelog.unreleased')
            : `v${normalizeVersion(entry.version)}`
        }
        date={entry.date}
        current={current}
        locale={locale}
        t={t}
      />
      {entry.sections.map((section) => (
        <div key={section.title} className="settings-changelog-section">
          <h5 className="settings-changelog-section-title">{section.title}</h5>
          <ul className="settings-changelog-list">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </article>
  );
}
