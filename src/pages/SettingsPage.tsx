import { useCallback, useEffect, useMemo, useState } from 'react';
import { getVersion, getName, getTauriVersion } from '@tauri-apps/api/app';
import { appConfigDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { dialog } from '../lib/dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import * as ipc from '../lib/ipc';
import * as libraries from '../lib/libraries';
import * as downloads from '../lib/downloads';
import * as settings from '../lib/settings';
import * as theme from '../lib/theme';
import { useT, LOCALES, type Locale } from '../lib/i18n';
import { execute, query } from '../lib/db';
import { clearCredentials } from '../lib/stronghold';
import type { InstallLibraryWithDisk } from '../types/install-library';
import type { ThemeId } from '../lib/theme';
import { useDownloadSettings } from '../contexts/DownloadSettings';
import { useStoreSettings } from '../contexts/StoreSettings';
import type { StoreScrollMode } from '../lib/storeSettings';
import { useOffline } from '../contexts/Offline';
import {
  loadDevDebugSettings,
  saveDevDebugSettings,
  subscribeDevDebugSettings,
  isDevDebugPanelAvailable,
  type DevDebugSettings,
} from '../lib/devDebugSettings';
import {
  DEFAULT_COMPACT_GEOM,
  DEFAULT_OVERLAY_HOTKEY,
  loadExperimentalSettings,
  saveExperimentalSettings,
  subscribeExperimentalSettings,
  type ExperimentalSettings,
} from '../lib/experimentalSettings';
import { formatOverlayAnchorStatus } from '../lib/overlayAnchorLabel';
import { formatIpcError } from '../lib/ipcError';
import {
  getOverlayHotkeyRegistrationMessage,
  isOverlayHotkeyRegistered,
  syncOverlayHotkey,
} from '../lib/overlayHotkey';
import { LoadingState } from '../components/ui/LoadingState';
import { useScrollSpy } from '../hooks/useScrollSpy';
import {
  loadAppRuntimeSettings,
  saveAppRuntimeSettings,
  subscribeAppRuntimeSettings,
  type AppRuntimeSettings,
} from '../lib/appRuntimeSettings';
import { checkForAppUpdateInteractive } from '../lib/appUpdater';
import { getChangelogEntries } from '../lib/changelog';
import { syncTrayIcon } from '../lib/tray';

interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  databaseDir: string;
}

interface CacheCounts {
  games: number;
  finishedDownloads: number;
  sessions: number;
}

type SettingsSectionId =
  | 'appearance'
  | 'storage'
  | 'downloads'
  | 'hosts'
  | 'system'
  | 'experimental'
  | 'account';

const SETTINGS_SECTION_IDS: SettingsSectionId[] = [
  'appearance',
  'storage',
  'downloads',
  'hosts',
  'system',
  'experimental',
  'account',
];

interface Props {
  onLoggedOut: () => void;
}

export function SettingsPage({ onLoggedOut: _onLoggedOut }: Props) {
  const { t, locale, setLocale } = useT();
  const {
    isOffline,
    offlineReason,
    manualOffline,
    setManualOffline,
    refreshConnectivity,
    lastCheckedAt,
    probing,
  } = useOffline();
  const { settings: dlSettings, update: updateDlSettings } = useDownloadSettings();
  const { settings: storeSettings, update: updateStoreSettings } = useStoreSettings();

  async function requireOnlineForHostAction(): Promise<boolean> {
    if (!isOffline) return true;
    await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
    return false;
  }
  const [devDebug, setDevDebug] = useState<DevDebugSettings | null>(null);
  const [runtime, setRuntime] = useState<AppRuntimeSettings | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [changelogExpanded, setChangelogExpanded] = useState(false);
  const changelogEntries = useMemo(() => getChangelogEntries(), []);
  const [experimental, setExperimental] = useState<ExperimentalSettings | null>(null);
  const [runningCount, setRunningCount] = useState(0);
  const [overlayAnchorProbe, setOverlayAnchorProbe] = useState<string | null>(null);
  const [overlayHotkeyOk, setOverlayHotkeyOk] = useState(true);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [counts, setCounts] = useState<CacheCounts | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [libs, setLibs] = useState<InstallLibraryWithDisk[]>([]);
  const [libsLoading, setLibsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('appearance');
  const [activeTheme, setActiveTheme] = useState<ThemeId>(theme.currentTheme());
  const [gofileToken, setGofileToken] = useState('');
  const [gofileAccountId, setGofileAccountId] = useState('');
  const [gofileSaved, setGofileSaved] = useState<{ token: string | null; accountId: string | null }>({
    token: null,
    accountId: null,
  });
  const [gofileTokenVisible, setGofileTokenVisible] = useState(false);
  const [gofileVerify, setGofileVerify] = useState<{
    state: 'idle' | 'verifying' | 'done';
    result?: { valid: boolean; tier: string | null; message: string };
  }>({ state: 'idle' });
  const [megaEmail, setMegaEmail] = useState('');
  const [megaPassword, setMegaPassword] = useState('');
  const [megaMfa, setMegaMfa] = useState('');
  const [megaNeedsMfa, setMegaNeedsMfa] = useState(false);
  const [megaPasswordVisible, setMegaPasswordVisible] = useState(false);
  const [megaLoggedIn, setMegaLoggedIn] = useState(false);
  const [megaLoggedInEmail, setMegaLoggedInEmail] = useState<string | null>(null);
  const [megaVerify, setMegaVerify] = useState<{
    state: 'idle' | 'verifying' | 'done';
    result?: { valid: boolean; message: string; email?: string | null };
  }>({ state: 'idle' });
  const [uhEmail, setUhEmail] = useState('');
  const [uhPassword, setUhPassword] = useState('');
  const [uhPasswordVisible, setUhPasswordVisible] = useState(false);
  const [uhLoggedIn, setUhLoggedIn] = useState(false);
  const [uhLoggedInEmail, setUhLoggedInEmail] = useState<string | null>(null);
  const [uhIsPro, setUhIsPro] = useState(false);
  const [uhVerify, setUhVerify] = useState<{
    state: 'idle' | 'verifying' | 'done';
    result?: { valid: boolean; isPro: boolean; message: string; email?: string | null };
  }>({ state: 'idle' });
  const [bhAccountId, setBhAccountId] = useState('');
  const [bhSaved, setBhSaved] = useState<string | null>(null);
  const [bhAccountVisible, setBhAccountVisible] = useState(false);
  const [bhVerify, setBhVerify] = useState<{
    state: 'idle' | 'verifying' | 'done';
    result?: {
      valid: boolean;
      message: string;
      email?: string | null;
      storageUsed?: string | null;
      storageLimit?: string | null;
    };
  }>({ state: 'idle' });
  const [dnApiKey, setDnApiKey] = useState('');
  const [dnSaved, setDnSaved] = useState<string | null>(null);
  const [dnKeyVisible, setDnKeyVisible] = useState(false);
  const [dnVerify, setDnVerify] = useState<{
    state: 'idle' | 'verifying' | 'done';
    result?: { valid: boolean; message: string; email?: string | null };
  }>({ state: 'idle' });

  const navItems = useMemo(
    (): { id: SettingsSectionId; label: string }[] => [
      { id: 'appearance', label: t('settings.nav.appearance') },
      { id: 'storage', label: t('settings.nav.storage') },
      { id: 'downloads', label: t('settings.nav.downloads') },
      { id: 'hosts', label: t('settings.nav.hosts') },
      { id: 'system', label: t('settings.nav.system') },
      { id: 'experimental', label: t('settings.nav.experimental') },
      { id: 'account', label: t('settings.nav.account') },
    ],
    [t],
  );

  const onSpySection = useCallback((id: SettingsSectionId) => {
    setActiveSection((prev) => (prev === id ? prev : id));
  }, []);

  const { pauseScrollSpy } = useScrollSpy(SETTINGS_SECTION_IDS, onSpySection, {
    idPrefix: 'settings-',
    anchorOffset: 100,
  });

  useEffect(() => {
    (async () => {
      try {
        const [name, version, tauriVersion, config] = await Promise.all([
          getName(),
          getVersion(),
          getTauriVersion(),
          appConfigDir(),
        ]);
        setInfo({ name, version, tauriVersion, databaseDir: config });
      } catch (err) {
        console.warn('[settings] failed to load app info', err);
      }
      refreshCounts();
      refreshLibs();
      refreshHostTokens();
    })();
  }, []);

  useEffect(() => {
    if (!isDevDebugPanelAvailable()) return;
    void loadDevDebugSettings().then(setDevDebug);
    return subscribeDevDebugSettings(setDevDebug);
  }, []);

  useEffect(() => {
    void loadAppRuntimeSettings().then(setRuntime);
    return subscribeAppRuntimeSettings(setRuntime);
  }, []);

  useEffect(() => {
    const refreshHotkey = () => {
      void syncOverlayHotkey().then(() => setOverlayHotkeyOk(isOverlayHotkeyRegistered()));
    };
    void loadExperimentalSettings().then((s) => {
      setExperimental(s);
      if (s.overlayEnabled) refreshHotkey();
    });
    return subscribeExperimentalSettings((s) => {
      setExperimental(s);
      if (s.overlayEnabled) refreshHotkey();
      else setOverlayHotkeyOk(true);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void ipc.runningGames().then((list) => {
        if (!cancelled) setRunningCount(list.length);
      });
    };
    refresh();
    const id = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  async function refreshHostTokens() {
    try {
      const [token, accountId, mega, megaEmailSaved, uhCookies, uhEmailSaved, uhIsProRaw, bhSavedRaw, dnKeyRaw] =
        await Promise.all([
        settings.get(settings.KEY_GOFILE_TOKEN),
        settings.get(settings.KEY_GOFILE_ACCOUNT_ID),
        settings.get(settings.KEY_MEGA_SESSION),
        settings.get(settings.KEY_MEGA_EMAIL),
        settings.get(settings.KEY_UPLOADHAVEN_COOKIES),
        settings.get(settings.KEY_UPLOADHAVEN_EMAIL),
        settings.get(settings.KEY_UPLOADHAVEN_IS_PRO),
        settings.get(settings.KEY_BUZZHEAVIER_ACCOUNT_ID),
        settings.get(settings.KEY_DATANODES_API_KEY),
      ]);
      setGofileSaved({ token, accountId });
      setGofileToken(token ?? '');
      setGofileAccountId(accountId ?? '');
      setGofileVerify({ state: 'idle' });
      setMegaLoggedIn(!!mega);
      setMegaLoggedInEmail(megaEmailSaved);
      if (megaEmailSaved) setMegaEmail(megaEmailSaved);
      setMegaPassword('');
      setMegaMfa('');
      setMegaNeedsMfa(false);
      setMegaVerify({ state: 'idle' });
      setUhLoggedIn(!!uhCookies);
      setUhLoggedInEmail(uhEmailSaved);
      setUhIsPro(uhIsProRaw === '1' || uhIsProRaw === 'true');
      if (uhEmailSaved) setUhEmail(uhEmailSaved);
      setUhPassword('');
      setUhVerify({ state: 'idle' });
      setBhSaved(bhSavedRaw);
      setBhAccountId(bhSavedRaw ?? '');
      setBhVerify({ state: 'idle' });
      setDnSaved(dnKeyRaw);
      setDnApiKey(dnKeyRaw ?? '');
      setDnVerify({ state: 'idle' });
    } catch (err) {
      console.warn('[settings] failed to load host tokens', err);
    }
  }

  async function onSaveGofileCreds() {
    const tokenNext = gofileToken.trim();
    const accountNext = gofileAccountId.trim();
    setBusy('gofile-save');
    try {
      await Promise.all([
        settings.set(settings.KEY_GOFILE_TOKEN, tokenNext || null),
        settings.set(settings.KEY_GOFILE_ACCOUNT_ID, accountNext || null),
      ]);
      await ipc.setGofileCredentials({
        token: tokenNext || null,
        accountId: accountNext || null,
      });
      setGofileSaved({ token: tokenNext || null, accountId: accountNext || null });
      setGofileVerify({ state: 'idle' });
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onClearGofileCreds() {
    setBusy('gofile-clear');
    try {
      await Promise.all([
        settings.remove(settings.KEY_GOFILE_TOKEN),
        settings.remove(settings.KEY_GOFILE_ACCOUNT_ID),
      ]);
      await ipc.setGofileCredentials({ token: null, accountId: null });
      setGofileToken('');
      setGofileAccountId('');
      setGofileSaved({ token: null, accountId: null });
      setGofileVerify({ state: 'idle' });
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onVerifyGofileCreds() {
    if (!(await requireOnlineForHostAction())) return;
    setGofileVerify({ state: 'verifying' });
    try {
      const r = await ipc.verifyGofileCredentials();
      setGofileVerify({
        state: 'done',
        result: { valid: r.valid, tier: r.tier, message: r.message },
      });
    } catch (err) {
      setGofileVerify({
        state: 'done',
        result: { valid: false, tier: null, message: formatError(err) },
      });
    }
  }

  async function onMegaLogin() {
    const emailNext = megaEmail.trim();
    if (!emailNext || !megaPassword) {
      await dialog.alert(t('settings.hosts.megaLoginMissing'), { kind: 'warning' });
      return;
    }
    setBusy('mega-login');
    try {
      const r = await ipc.loginMega({
        email: emailNext,
        password: megaPassword,
        mfa: megaNeedsMfa ? megaMfa.trim() || null : null,
      });
      await Promise.all([
        settings.set(settings.KEY_MEGA_SESSION, r.session),
        settings.set(settings.KEY_MEGA_EMAIL, r.email),
      ]);
      setMegaLoggedIn(true);
      setMegaLoggedInEmail(r.email);
      setMegaEmail(r.email);
      setMegaPassword('');
      setMegaMfa('');
      setMegaNeedsMfa(false);
      setMegaVerify({
        state: 'done',
        result: { valid: true, message: r.message, email: r.email },
      });
    } catch (err) {
      if (isBackendError(err) && err.code === 'two_factor_required') {
        setMegaNeedsMfa(true);
        await dialog.alert(t('settings.hosts.megaMfaRequired'), { kind: 'warning' });
      } else {
        await dialog.alert(formatError(err), { kind: 'error' });
      }
    } finally {
      setBusy(null);
    }
  }

  async function onClearMegaSession() {
    setBusy('mega-clear');
    try {
      await Promise.all([
        settings.remove(settings.KEY_MEGA_SESSION),
        settings.remove(settings.KEY_MEGA_EMAIL),
      ]);
      await ipc.setMegaSession({ session: null });
      setMegaPassword('');
      setMegaMfa('');
      setMegaNeedsMfa(false);
      setMegaLoggedIn(false);
      setMegaLoggedInEmail(null);
      setMegaEmail('');
      setMegaVerify({ state: 'idle' });
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onVerifyMegaSession() {
    if (!(await requireOnlineForHostAction())) return;
    setMegaVerify({ state: 'verifying' });
    try {
      const r = await ipc.verifyMegaSession();
      setMegaVerify({
        state: 'done',
        result: { valid: r.valid, message: r.message, email: r.email },
      });
    } catch (err) {
      setMegaVerify({
        state: 'done',
        result: { valid: false, message: formatError(err) },
      });
    }
  }

  async function onUhLogin() {
    const emailNext = uhEmail.trim();
    if (!emailNext || !uhPassword) {
      await dialog.alert(t('settings.hosts.uhLoginMissing'), { kind: 'warning' });
      return;
    }
    setBusy('uh-login');
    try {
      const r = await ipc.loginUploadhaven({ email: emailNext, password: uhPassword });
      await Promise.all([
        settings.set(settings.KEY_UPLOADHAVEN_COOKIES, r.cookieHeader),
        settings.set(settings.KEY_UPLOADHAVEN_EMAIL, r.email),
        settings.set(settings.KEY_UPLOADHAVEN_IS_PRO, r.isPro ? '1' : '0'),
      ]);
      setUhLoggedIn(true);
      setUhLoggedInEmail(r.email);
      setUhIsPro(r.isPro);
      setUhEmail(r.email);
      setUhPassword('');
      setUhVerify({
        state: 'done',
        result: { valid: true, isPro: r.isPro, message: r.message, email: r.email },
      });
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onClearUhSession() {
    setBusy('uh-clear');
    try {
      await Promise.all([
        settings.remove(settings.KEY_UPLOADHAVEN_COOKIES),
        settings.remove(settings.KEY_UPLOADHAVEN_EMAIL),
        settings.remove(settings.KEY_UPLOADHAVEN_IS_PRO),
      ]);
      await ipc.setUploadhavenSession({ cookieHeader: null });
      setUhPassword('');
      setUhLoggedIn(false);
      setUhLoggedInEmail(null);
      setUhIsPro(false);
      setUhEmail('');
      setUhVerify({ state: 'idle' });
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onVerifyUhSession() {
    if (!(await requireOnlineForHostAction())) return;
    setUhVerify({ state: 'verifying' });
    try {
      const r = await ipc.verifyUploadhavenSession();
      if (r.valid) {
        await Promise.all([
          settings.set(settings.KEY_UPLOADHAVEN_IS_PRO, r.isPro ? '1' : '0'),
          ...(r.cookieHeader
            ? [settings.set(settings.KEY_UPLOADHAVEN_COOKIES, r.cookieHeader)]
            : []),
        ]);
        setUhIsPro(r.isPro);
      }
      setUhVerify({
        state: 'done',
        result: { valid: r.valid, isPro: r.isPro, message: r.message, email: r.email },
      });
    } catch (err) {
      setUhVerify({
        state: 'done',
        result: { valid: false, isPro: false, message: formatError(err) },
      });
    }
  }

  async function onSaveBuzzheavierAccount() {
    const next = bhAccountId.trim();
    setBusy('bh-save');
    try {
      await settings.set(settings.KEY_BUZZHEAVIER_ACCOUNT_ID, next || null);
      await ipc.setBuzzheavierAccount({ accountId: next || null });
      setBhSaved(next || null);
      setBhVerify({ state: 'idle' });
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onClearBuzzheavierAccount() {
    setBusy('bh-clear');
    try {
      await settings.remove(settings.KEY_BUZZHEAVIER_ACCOUNT_ID);
      await ipc.setBuzzheavierAccount({ accountId: null });
      setBhAccountId('');
      setBhSaved(null);
      setBhVerify({ state: 'idle' });
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onVerifyBuzzheavierAccount() {
    if (!(await requireOnlineForHostAction())) return;
    setBhVerify({ state: 'verifying' });
    try {
      const r = await ipc.verifyBuzzheavierAccount();
      setBhVerify({
        state: 'done',
        result: {
          valid: r.valid,
          message: r.message,
          email: r.email,
          storageUsed: r.storageUsed,
          storageLimit: r.storageLimit,
        },
      });
    } catch (err) {
      setBhVerify({
        state: 'done',
        result: { valid: false, message: formatError(err) },
      });
    }
  }

  async function onSaveDatanodesKey() {
    const next = dnApiKey.trim();
    setBusy('dn-save');
    try {
      await settings.set(settings.KEY_DATANODES_API_KEY, next || null);
      await ipc.setDatanodesKey({ key: next || null });
      setDnSaved(next || null);
      setDnVerify({ state: 'idle' });
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onClearDatanodesKey() {
    setBusy('dn-clear');
    try {
      await settings.remove(settings.KEY_DATANODES_API_KEY);
      await ipc.setDatanodesKey({ key: null });
      setDnApiKey('');
      setDnSaved(null);
      setDnVerify({ state: 'idle' });
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onVerifyDatanodesKey() {
    if (!(await requireOnlineForHostAction())) return;
    setDnVerify({ state: 'verifying' });
    try {
      const r = await ipc.verifyDatanodesKey();
      setDnVerify({
        state: 'done',
        result: { valid: r.valid, message: r.message, email: r.email },
      });
    } catch (err) {
      setDnVerify({
        state: 'done',
        result: { valid: false, message: formatError(err) },
      });
    }
  }

  const refreshLibs = useCallback(async () => {
    setLibsLoading(true);
    try {
      const rows = await libraries.listWithDisk();
      setLibs(rows);
    } catch (err) {
      console.warn('[settings] failed to load install libraries', err);
    } finally {
      setLibsLoading(false);
    }
  }, []);

  async function refreshCounts() {
    try {
      const [games, dls, sessions] = await Promise.all([
        query<{ n: number }>('SELECT COUNT(*) AS n FROM games_cache'),
        query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM downloads WHERE state IN ('completed','cancelled','failed','needs_browser')`,
        ),
        query<{ n: number }>('SELECT COUNT(*) AS n FROM play_sessions'),
      ]);
      setCounts({
        games: games[0]?.n ?? 0,
        finishedDownloads: dls[0]?.n ?? 0,
        sessions: sessions[0]?.n ?? 0,
      });
    } catch (err) {
      console.warn('[settings] failed to count cache', err);
    }
  }

  async function clearGamesCache() {
    const ok = await dialog.confirm(t('settings.maintenance.confirmCache'), {
      title: t('common.clear'),
      kind: 'warning',
    });
    if (!ok) return;
    setBusy('games');
    try {
      await execute('DELETE FROM games_cache');
      await refreshCounts();
    } finally {
      setBusy(null);
    }
  }

  async function clearFinishedDownloads() {
    const ok = await dialog.confirm(t('settings.maintenance.confirmFinished'), {
      title: t('common.clear'),
      kind: 'warning',
    });
    if (!ok) return;
    setBusy('downloads');
    try {
      await downloads.clearFinished();
      await refreshCounts();
    } finally {
      setBusy(null);
    }
  }

  async function onRevealLibrary(path: string) {
    try {
      await ipc.revealInExplorer(path);
    } catch (err) {
      await dialog.alert(String(err), { kind: 'error' });
    }
  }

  async function onAddLibrary() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: t('settings.libraries.pick'),
    });
    if (!picked || typeof picked !== 'string') return;
    setBusy('add-lib');
    try {
      await libraries.add({ label: '', path: picked });
      await refreshLibs();
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onSetDefaultLibrary(id: number) {
    setBusy(`default-${id}`);
    try {
      await libraries.setDefault(id);
      await refreshLibs();
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onRemoveLibrary(lib: InstallLibraryWithDisk) {
    const ok = await dialog.confirm(
      t('settings.libraries.confirmRemove', { label: lib.label, path: lib.path }),
      { title: t('settings.libraries.confirmRemoveTitle'), kind: 'warning' },
    );
    if (!ok) return;
    setBusy(`remove-${lib.id}`);
    try {
      await libraries.remove(lib.id);
      await refreshLibs();
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onRenameLibrary(lib: InstallLibraryWithDisk) {
    const next = await dialog.prompt(t('common.rename'), {
      title: t('common.rename'),
      defaultValue: lib.label,
    });
    if (!next || next.trim() === lib.label) return;
    setBusy(`rename-${lib.id}`);
    try {
      await libraries.setLabel(lib.id, next.trim());
      await refreshLibs();
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  function formatError(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message: string }).message);
    }
    return String(err);
  }

  function isBackendError(err: unknown): err is { code: string; message: string } {
    return (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      typeof (err as { code: unknown }).code === 'string'
    );
  }

  async function onPickTheme(id: ThemeId) {
    setActiveTheme(id);
    try {
      await theme.setTheme(id);
    } catch (err) {
      console.warn('[theme] persist failed', err);
    }
  }

  async function onPickLocale(id: Locale) {
    try {
      await setLocale(id);
    } catch (err) {
      console.warn('[i18n] persist failed', err);
    }
  }

  async function onRevealDatabase() {
    if (!info) return;
    try {
      await ipc.revealInExplorer(info.databaseDir);
    } catch (err) {
      await dialog.alert(String(err), { kind: 'error' });
    }
  }

  async function onLogout() {
    const ok = await dialog.confirm(t('settings.account.confirmLogout'), {
      title: t('settings.account.confirmLogoutTitle'),
      kind: 'warning',
    });
    if (!ok) return;
    setBusy('logout');
    try {
      await Promise.all([ipc.logout(), clearCredentials()]);
      await ipc.restartToLogin();
    } catch (err) {
      console.error('[logout] failed', err);
      await dialog.alert(t('settings.account.logoutFailed', { error: formatError(err) }), {
        kind: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  function scrollToSection(id: SettingsSectionId) {
    setActiveSection(id);
    pauseScrollSpy();
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const gofileDirty =
    gofileToken.trim() !== (gofileSaved.token ?? '') ||
    gofileAccountId.trim() !== (gofileSaved.accountId ?? '');
  const megaCanLogin = megaEmail.trim().length > 0 && megaPassword.length > 0;
  const uhCanLogin = uhEmail.trim().length > 0 && uhPassword.length > 0;
  const bhDirty = bhAccountId.trim() !== (bhSaved ?? '');
  const dnDirty = dnApiKey.trim() !== (dnSaved ?? '');

  return (
    <div className="settings-page">
      <header className="settings-top">
        <div className="settings-top-text">
          <h1 className="settings-title">{t('settings.title')}</h1>
          <p className="settings-subtitle">{t('settings.subtitle')}</p>
        </div>
        {info && (
          <div className="settings-version-badge" title={t('settings.about.appLine', { name: info.name, version: info.version })}>
            v{info.version}
          </div>
        )}
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item${activeSection === item.id ? ' settings-nav-item-active' : ''}`}
              onClick={() => scrollToSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <section id="settings-appearance" className="settings-section">
            <SectionHeader title={t('settings.nav.appearance')} />

            <div className="settings-card">
              <h3 className="settings-card-title">{t('settings.language.section')}</h3>
              <p className="settings-card-hint">{t('settings.language.hint')}</p>
              <div className="settings-locale-grid">
                {LOCALES.map((l) => {
                  const selected = l.id === locale;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className={`settings-locale-card${selected ? ' settings-locale-card-active' : ''}`}
                      onClick={() => onPickLocale(l.id)}
                      title={l.englishLabel}
                    >
                      <span className="settings-locale-flag" aria-hidden>
                        {l.flag}
                      </span>
                      <span className="settings-locale-label">{l.label}</span>
                      {selected && <span className="settings-pill">{t('settings.theme.active')}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-card">
              <h3 className="settings-card-title">{t('settings.theme.section')}</h3>
              <p className="settings-card-hint">{t('settings.theme.hint')}</p>
              <div className="settings-theme-grid">
                {theme.THEMES.map((th) => {
                  const selected = th.id === activeTheme;
                  return (
                    <button
                      key={th.id}
                      type="button"
                      className={`settings-theme-card${selected ? ' settings-theme-card-active' : ''}`}
                      onClick={() => onPickTheme(th.id)}
                      title={th.description}
                    >
                      <div
                        className="settings-theme-swatch"
                        style={{
                          background: th.preview.bg,
                          border: `1px solid ${th.preview.surface}`,
                        }}
                      >
                        <div
                          className="settings-theme-swatch-inner"
                          style={{ background: th.preview.surface }}
                        >
                          <span style={{ color: th.preview.text }}>Aa</span>
                          <span
                            className="settings-theme-swatch-accent"
                            style={{ background: th.preview.accent }}
                          />
                        </div>
                      </div>
                      <div className="settings-theme-meta">
                        <strong>{th.label}</strong>
                        {selected && <span className="settings-pill">{t('settings.theme.active')}</span>}
                      </div>
                      <span className="settings-theme-desc">{th.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-card">
              <h3 className="settings-card-title">{t('settings.store.section')}</h3>
              <p className="settings-card-hint">{t('settings.store.hint')}</p>
              <div className="settings-store-scroll-grid">
                {(['infinite', 'pagination'] as const satisfies readonly StoreScrollMode[]).map(
                  (mode) => {
                    const selected = storeSettings.scrollMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        className={`settings-store-scroll-card${selected ? ' settings-store-scroll-card-active' : ''}`}
                        onClick={() => void updateStoreSettings({ scrollMode: mode })}
                      >
                        <span className="settings-store-scroll-icon" aria-hidden>
                          {mode === 'infinite' ? '∞' : '#'}
                        </span>
                        <span className="settings-store-scroll-label">
                          {mode === 'infinite'
                            ? t('settings.store.infinite')
                            : t('settings.store.pagination')}
                        </span>
                        <span className="settings-store-scroll-desc">
                          {mode === 'infinite'
                            ? t('settings.store.infiniteHint')
                            : t('settings.store.paginationHint')}
                        </span>
                        {selected && <span className="settings-pill">{t('settings.theme.active')}</span>}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          </section>

          <section id="settings-storage" className="settings-section">
            <SectionHeader
              title={t('settings.libraries.section')}
              hint={t('settings.libraries.hint')}
              action={
                <button
                  type="button"
                  className="settings-toolbar-btn settings-toolbar-btn-accent"
                  disabled={busy !== null}
                  onClick={onAddLibrary}
                >
                  {busy === 'add-lib' ? t('settings.libraries.adding') : t('settings.libraries.add')}
                </button>
              }
            />

            <div className="settings-panel">
              {libsLoading && (
                <LoadingState label={t('settings.libraries.loading')} variant="compact" />
              )}
              {!libsLoading && libs.length === 0 && (
                <div className="settings-panel-empty">{t('settings.libraries.empty')}</div>
              )}
              {!libsLoading &&
                libs.map((lib, index) => (
                  <LibraryRow
                    key={lib.id}
                    lib={lib}
                    busy={busy}
                    isLast={index === libs.length - 1}
                    canRemove={!lib.isDefault && libs.length > 1}
                    t={t}
                    onReveal={() => onRevealLibrary(lib.path)}
                    onRename={() => onRenameLibrary(lib)}
                    onSetDefault={() => onSetDefaultLibrary(lib.id)}
                    onRemove={() => onRemoveLibrary(lib)}
                  />
                ))}
            </div>
          </section>

          <section id="settings-downloads" className="settings-section">
            <SectionHeader
              title={t('settings.downloads.section')}
              hint={t('settings.downloads.hint')}
            />
            <div className="settings-card">
              <div className="settings-checklist">
                <label className="settings-check-row">
                  <input
                    type="checkbox"
                    checked={dlSettings.autoExtract}
                    onChange={(e) => updateDlSettings({ autoExtract: e.target.checked })}
                  />
                  <span>{t('settings.downloads.autoExtract')}</span>
                </label>
                <label className="settings-check-row">
                  <input
                    type="checkbox"
                    checked={dlSettings.speedInMbps}
                    onChange={(e) => updateDlSettings({ speedInMbps: e.target.checked })}
                  />
                  <span>{t('settings.downloads.speedMbps')}</span>
                </label>
                <label className="settings-check-row">
                  <input
                    type="checkbox"
                    checked={dlSettings.deleteArchiveAfterExtract}
                    onChange={(e) =>
                      updateDlSettings({ deleteArchiveAfterExtract: e.target.checked })
                    }
                  />
                  <span>{t('settings.downloads.deleteArchive')}</span>
                </label>
                <label className="settings-check-row">
                  <input
                    type="checkbox"
                    checked={dlSettings.createShortcuts}
                    onChange={(e) => updateDlSettings({ createShortcuts: e.target.checked })}
                  />
                  <span>{t('settings.downloads.createShortcuts')}</span>
                </label>
              </div>
            </div>
          </section>

          <section id="settings-hosts" className="settings-section">
            <SectionHeader title={t('settings.hosts.section')} hint={t('settings.hosts.hint')} />

            <div className="settings-host-panel">
              <div className="settings-host-panel-head">
                <div className="settings-host-brand">
                  <span className="settings-host-logo" aria-hidden>
                    GF
                  </span>
                  <div>
                    <h3 className="settings-host-title">GoFile</h3>
                    <p className="settings-host-desc">{t('settings.hosts.gofileDesc')}</p>
                  </div>
                </div>
                <div className="settings-host-status">
                  {gofileSaved.token ? (
                    <span className="settings-status-chip settings-status-chip-ok">
                      {t('settings.hosts.configured')}
                    </span>
                  ) : (
                    <span className="settings-status-chip settings-status-chip-muted">
                      {t('settings.hosts.guestBadge')}
                    </span>
                  )}
                  {gofileVerify.state === 'done' && gofileVerify.result && (
                    <span
                      className={`settings-status-chip${
                        gofileVerify.result.valid
                          ? gofileVerify.result.tier === 'premium'
                            ? ' settings-status-chip-warn'
                            : ' settings-status-chip-info'
                          : ' settings-status-chip-err'
                      }`}
                      title={gofileVerify.result.message}
                    >
                      {gofileVerify.result.valid
                        ? (gofileVerify.result.tier ?? 'OK').toUpperCase()
                        : t('settings.hosts.invalid')}
                    </span>
                  )}
                </div>
              </div>

              <div className="settings-host-form">
                <label className="settings-host-field">
                  <span className="settings-host-field-label">{t('settings.hosts.token')}</span>
                  <div className="settings-host-input-wrap">
                    <input
                      type={gofileTokenVisible ? 'text' : 'password'}
                      value={gofileToken}
                      onChange={(e) => setGofileToken(e.target.value)}
                      placeholder={t('settings.hosts.tokenPlaceholder')}
                      className="settings-host-input"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="settings-host-input-toggle"
                      onClick={() => setGofileTokenVisible((v) => !v)}
                      title={gofileTokenVisible ? t('common.hide') : t('common.show')}
                      aria-label={gofileTokenVisible ? t('common.hide') : t('common.show')}
                    >
                      {gofileTokenVisible ? (
                        <EyeOffIcon />
                      ) : (
                        <EyeIcon />
                      )}
                    </button>
                  </div>
                </label>

                <label className="settings-host-field">
                  <span className="settings-host-field-label">{t('settings.hosts.accountId')}</span>
                  <input
                    type="text"
                    value={gofileAccountId}
                    onChange={(e) => setGofileAccountId(e.target.value)}
                    placeholder={t('settings.hosts.accountIdPlaceholder')}
                    className="settings-host-input"
                    autoComplete="off"
                  />
                </label>
              </div>

              {gofileVerify.state === 'done' && gofileVerify.result && (
                <div
                  className={`settings-host-feedback${
                    gofileVerify.result.valid
                      ? ' settings-host-feedback-ok'
                      : ' settings-host-feedback-err'
                  }`}
                  role="status"
                >
                  {gofileVerify.result.message}
                </div>
              )}

              <div className="settings-host-toolbar">
                <details className="settings-host-help">
                  <summary>{t('settings.hosts.help')}</summary>
                  <ol>
                    <li>
                      {t('settings.hosts.help.intro', { url: '' })}{' '}
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          openUrl('https://gofile.io/myProfile');
                        }}
                      >
                        gofile.io/myProfile
                      </a>
                    </li>
                    <li>{t('settings.hosts.help.profile')}</li>
                    <li>{t('settings.hosts.help.save')}</li>
                  </ol>
                </details>
                <div className="settings-host-toolbar-actions">
                  {gofileSaved.token && (
                    <button
                      type="button"
                      className="settings-toolbar-btn settings-toolbar-btn-ghost"
                      disabled={busy !== null}
                      onClick={onClearGofileCreds}
                    >
                      {t('common.clear')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-toolbar-btn"
                    disabled={
                      busy !== null || !gofileSaved.token || gofileVerify.state === 'verifying'
                    }
                    onClick={onVerifyGofileCreds}
                  >
                    {gofileVerify.state === 'verifying'
                      ? t('settings.hosts.verifying')
                      : t('common.verify')}
                  </button>
                  <button
                    type="button"
                    className="settings-toolbar-btn settings-toolbar-btn-accent"
                    disabled={busy !== null || !gofileDirty}
                    onClick={onSaveGofileCreds}
                  >
                    {busy === 'gofile-save' ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-host-panel" style={{ marginTop: 16 }}>
              <div className="settings-host-panel-head">
                <div className="settings-host-brand">
                  <span className="settings-host-logo" aria-hidden style={{ background: '#d9272e' }}>
                    M
                  </span>
                  <div>
                    <h3 className="settings-host-title">MEGA</h3>
                    <p className="settings-host-desc">{t('settings.hosts.megaDesc')}</p>
                  </div>
                </div>
                <div className="settings-host-status">
                  {megaLoggedIn ? (
                    <span className="settings-status-chip settings-status-chip-ok">
                      {t('settings.hosts.configured')}
                    </span>
                  ) : (
                    <span className="settings-status-chip settings-status-chip-muted">
                      {t('settings.hosts.guestBadge')}
                    </span>
                  )}
                  {megaLoggedInEmail && (
                    <span className="settings-status-chip settings-status-chip-info" title={megaLoggedInEmail}>
                      {megaLoggedInEmail}
                    </span>
                  )}
                  {megaVerify.state === 'done' && megaVerify.result && (
                    <span
                      className={`settings-status-chip${
                        megaVerify.result.valid
                          ? ' settings-status-chip-info'
                          : ' settings-status-chip-err'
                      }`}
                      title={megaVerify.result.message}
                    >
                      {megaVerify.result.valid ? 'OK' : t('settings.hosts.invalid')}
                    </span>
                  )}
                </div>
              </div>

              <div className="settings-host-form">
                <label className="settings-host-field">
                  <span className="settings-host-field-label">{t('settings.hosts.megaEmail')}</span>
                  <input
                    type="email"
                    value={megaEmail}
                    onChange={(e) => setMegaEmail(e.target.value)}
                    placeholder={t('settings.hosts.megaEmailPlaceholder')}
                    className="settings-host-input"
                    autoComplete="email"
                    disabled={megaLoggedIn}
                  />
                </label>
                {!megaLoggedIn && (
                  <label className="settings-host-field">
                    <span className="settings-host-field-label">{t('settings.hosts.megaPassword')}</span>
                    <div className="settings-host-input-wrap">
                      <input
                        type={megaPasswordVisible ? 'text' : 'password'}
                        value={megaPassword}
                        onChange={(e) => setMegaPassword(e.target.value)}
                        placeholder={t('settings.hosts.megaPasswordPlaceholder')}
                        className="settings-host-input"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="settings-host-input-toggle"
                        onClick={() => setMegaPasswordVisible((v) => !v)}
                        title={megaPasswordVisible ? t('common.hide') : t('common.show')}
                        aria-label={megaPasswordVisible ? t('common.hide') : t('common.show')}
                      >
                        {megaPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </label>
                )}
                {!megaLoggedIn && megaNeedsMfa && (
                  <label className="settings-host-field">
                    <span className="settings-host-field-label">{t('settings.hosts.megaMfa')}</span>
                    <input
                      type="text"
                      value={megaMfa}
                      onChange={(e) => setMegaMfa(e.target.value)}
                      placeholder={t('settings.hosts.megaMfaPlaceholder')}
                      className="settings-host-input"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                    />
                  </label>
                )}
              </div>

              {megaVerify.state === 'done' && megaVerify.result && (
                <div
                  className={`settings-host-feedback${
                    megaVerify.result.valid
                      ? ' settings-host-feedback-ok'
                      : ' settings-host-feedback-err'
                  }`}
                >
                  {megaVerify.result.message}
                </div>
              )}

              <div className="settings-host-toolbar">
                <details className="settings-host-help">
                  <summary>{t('settings.hosts.megaHelp')}</summary>
                  <ol>
                    <li>{t('settings.hosts.megaHelp.intro')}</li>
                    <li>{t('settings.hosts.megaHelp.login')}</li>
                    <li>{t('settings.hosts.megaHelp.optional')}</li>
                  </ol>
                </details>
                <div className="settings-host-toolbar-actions">
                  {megaLoggedIn && (
                    <button
                      type="button"
                      className="settings-toolbar-btn settings-toolbar-btn-ghost"
                      disabled={busy !== null}
                      onClick={onClearMegaSession}
                    >
                      {t('settings.hosts.megaLogout')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-toolbar-btn"
                    disabled={
                      busy !== null || !megaLoggedIn || megaVerify.state === 'verifying'
                    }
                    onClick={onVerifyMegaSession}
                  >
                    {megaVerify.state === 'verifying'
                      ? t('settings.hosts.verifying')
                      : t('common.verify')}
                  </button>
                  {!megaLoggedIn && (
                    <button
                      type="button"
                      className="settings-toolbar-btn settings-toolbar-btn-accent"
                      disabled={busy !== null || !megaCanLogin}
                      onClick={onMegaLogin}
                    >
                      {busy === 'mega-login' ? t('settings.hosts.megaLoggingIn') : t('settings.hosts.megaLogin')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="settings-host-panel" style={{ marginTop: 16 }}>
              <div className="settings-host-panel-head">
                <div className="settings-host-brand">
                  <span className="settings-host-logo" aria-hidden style={{ background: '#888888' }}>
                    UH
                  </span>
                  <div>
                    <h3 className="settings-host-title">UploadHaven</h3>
                    <p className="settings-host-desc">{t('settings.hosts.uhDesc')}</p>
                  </div>
                </div>
                <div className="settings-host-status">
                  {uhLoggedIn ? (
                    <span className="settings-status-chip settings-status-chip-ok">
                      {t('settings.hosts.configured')}
                    </span>
                  ) : (
                    <span className="settings-status-chip settings-status-chip-muted">
                      {t('settings.hosts.guestBadge')}
                    </span>
                  )}
                  {uhLoggedIn && uhIsPro && (
                    <span className="settings-status-chip settings-status-chip-warn">PRO</span>
                  )}
                  {uhLoggedInEmail && (
                    <span className="settings-status-chip settings-status-chip-info" title={uhLoggedInEmail}>
                      {uhLoggedInEmail}
                    </span>
                  )}
                  {uhVerify.state === 'done' && uhVerify.result && (
                    <span
                      className={`settings-status-chip${
                        uhVerify.result.valid
                          ? uhVerify.result.isPro
                            ? ' settings-status-chip-warn'
                            : ' settings-status-chip-info'
                          : ' settings-status-chip-err'
                      }`}
                      title={uhVerify.result.message}
                    >
                      {uhVerify.result.valid
                        ? uhVerify.result.isPro
                          ? 'PRO'
                          : 'OK'
                        : t('settings.hosts.invalid')}
                    </span>
                  )}
                </div>
              </div>

              <div className="settings-host-form">
                <label className="settings-host-field">
                  <span className="settings-host-field-label">{t('settings.hosts.uhEmail')}</span>
                  <input
                    type="email"
                    value={uhEmail}
                    onChange={(e) => setUhEmail(e.target.value)}
                    placeholder={t('settings.hosts.uhEmailPlaceholder')}
                    className="settings-host-input"
                    autoComplete="email"
                    disabled={uhLoggedIn}
                  />
                </label>
                {!uhLoggedIn && (
                  <label className="settings-host-field">
                    <span className="settings-host-field-label">{t('settings.hosts.uhPassword')}</span>
                    <div className="settings-host-input-wrap">
                      <input
                        type={uhPasswordVisible ? 'text' : 'password'}
                        value={uhPassword}
                        onChange={(e) => setUhPassword(e.target.value)}
                        placeholder={t('settings.hosts.uhPasswordPlaceholder')}
                        className="settings-host-input"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="settings-host-input-toggle"
                        onClick={() => setUhPasswordVisible((v) => !v)}
                        title={uhPasswordVisible ? t('common.hide') : t('common.show')}
                        aria-label={uhPasswordVisible ? t('common.hide') : t('common.show')}
                      >
                        {uhPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </label>
                )}
              </div>

              {uhVerify.state === 'done' && uhVerify.result && (
                <div
                  className={`settings-host-feedback${
                    uhVerify.result.valid
                      ? ' settings-host-feedback-ok'
                      : ' settings-host-feedback-err'
                  }`}
                >
                  {uhVerify.result.message}
                </div>
              )}

              <div className="settings-host-toolbar">
                <details className="settings-host-help">
                  <summary>{t('settings.hosts.uhHelp')}</summary>
                  <ol>
                    <li>{t('settings.hosts.uhHelp.intro')}</li>
                    <li>{t('settings.hosts.uhHelp.login')}</li>
                    <li>{t('settings.hosts.uhHelp.pro')}</li>
                  </ol>
                </details>
                <div className="settings-host-toolbar-actions">
                  {uhLoggedIn && (
                    <button
                      type="button"
                      className="settings-toolbar-btn settings-toolbar-btn-ghost"
                      disabled={busy !== null}
                      onClick={onClearUhSession}
                    >
                      {t('settings.hosts.uhLogout')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-toolbar-btn"
                    disabled={busy !== null || !uhLoggedIn || uhVerify.state === 'verifying'}
                    onClick={onVerifyUhSession}
                  >
                    {uhVerify.state === 'verifying'
                      ? t('settings.hosts.verifying')
                      : t('common.verify')}
                  </button>
                  {!uhLoggedIn && (
                    <button
                      type="button"
                      className="settings-toolbar-btn settings-toolbar-btn-accent"
                      disabled={busy !== null || !uhCanLogin}
                      onClick={onUhLogin}
                    >
                      {busy === 'uh-login' ? t('settings.hosts.uhLoggingIn') : t('settings.hosts.uhLogin')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="settings-host-panel" style={{ marginTop: 16 }}>
              <div className="settings-host-panel-head">
                <div className="settings-host-brand">
                  <span className="settings-host-logo" aria-hidden style={{ background: '#a87a2a' }}>
                    BH
                  </span>
                  <div>
                    <h3 className="settings-host-title">BuzzHeavier</h3>
                    <p className="settings-host-desc">{t('settings.hosts.buzzheavierDesc')}</p>
                  </div>
                </div>
                <div className="settings-host-status">
                  {bhSaved ? (
                    <span className="settings-status-chip settings-status-chip-ok">
                      {t('settings.hosts.configured')}
                    </span>
                  ) : (
                    <span className="settings-status-chip settings-status-chip-muted">
                      {t('settings.hosts.guestBadge')}
                    </span>
                  )}
                  {bhVerify.state === 'done' && bhVerify.result && (
                    <span
                      className={`settings-status-chip${
                        bhVerify.result.valid
                          ? ' settings-status-chip-info'
                          : ' settings-status-chip-err'
                      }`}
                      title={bhVerify.result.message}
                    >
                      {bhVerify.result.valid ? 'OK' : t('settings.hosts.invalid')}
                    </span>
                  )}
                </div>
              </div>

              <div className="settings-host-form">
                <label className="settings-host-field">
                  <span className="settings-host-field-label">{t('settings.hosts.buzzheavierAccountId')}</span>
                  <div className="settings-host-input-wrap">
                    <input
                      type={bhAccountVisible ? 'text' : 'password'}
                      value={bhAccountId}
                      onChange={(e) => setBhAccountId(e.target.value)}
                      placeholder={t('settings.hosts.buzzheavierAccountIdPlaceholder')}
                      className="settings-host-input"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="settings-host-input-toggle"
                      onClick={() => setBhAccountVisible((v) => !v)}
                      title={bhAccountVisible ? t('common.hide') : t('common.show')}
                      aria-label={bhAccountVisible ? t('common.hide') : t('common.show')}
                    >
                      {bhAccountVisible ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </label>
              </div>

              {bhVerify.state === 'done' && bhVerify.result && (
                <div
                  className={`settings-host-feedback${
                    bhVerify.result.valid
                      ? ' settings-host-feedback-ok'
                      : ' settings-host-feedback-err'
                  }`}
                  role="status"
                >
                  {bhVerify.result.message}
                  {bhVerify.result.valid &&
                    bhVerify.result.storageUsed &&
                    bhVerify.result.storageLimit && (
                      <>
                        {' '}
                        ({bhVerify.result.storageUsed} / {bhVerify.result.storageLimit})
                      </>
                    )}
                </div>
              )}

              <div className="settings-host-toolbar">
                <details className="settings-host-help">
                  <summary>{t('settings.hosts.buzzheavierHelp')}</summary>
                  <ol>
                    <li>{t('settings.hosts.buzzheavierHelp.intro')}</li>
                    <li>
                      {t('settings.hosts.buzzheavierHelp.account', { url: '' })}{' '}
                      <button
                        type="button"
                        className="settings-inline-link"
                        onClick={() => openUrl('https://buzzheavier.com/account')}
                      >
                        buzzheavier.com/account
                      </button>
                    </li>
                    <li>{t('settings.hosts.buzzheavierHelp.paid')}</li>
                  </ol>
                </details>
                <div className="settings-host-toolbar-actions">
                  {bhSaved && (
                    <button
                      type="button"
                      className="settings-toolbar-btn settings-toolbar-btn-ghost"
                      disabled={busy !== null}
                      onClick={onClearBuzzheavierAccount}
                    >
                      {t('common.clear')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-toolbar-btn"
                    disabled={busy !== null || !bhSaved || bhVerify.state === 'verifying'}
                    onClick={onVerifyBuzzheavierAccount}
                  >
                    {bhVerify.state === 'verifying'
                      ? t('settings.hosts.verifying')
                      : t('common.verify')}
                  </button>
                  <button
                    type="button"
                    className="settings-toolbar-btn settings-toolbar-btn-accent"
                    disabled={busy !== null || !bhDirty}
                    onClick={onSaveBuzzheavierAccount}
                  >
                    {busy === 'bh-save' ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-host-panel" style={{ marginTop: 16 }}>
              <div className="settings-host-panel-head">
                <div className="settings-host-brand">
                  <span className="settings-host-logo" aria-hidden style={{ background: '#1f6feb' }}>
                    DN
                  </span>
                  <div>
                    <h3 className="settings-host-title">DataNodes</h3>
                    <p className="settings-host-desc">{t('settings.hosts.datanodesDesc')}</p>
                  </div>
                </div>
                <div className="settings-host-status">
                  {dnSaved ? (
                    <span className="settings-status-chip settings-status-chip-ok">
                      {t('settings.hosts.configured')}
                    </span>
                  ) : (
                    <span className="settings-status-chip settings-status-chip-muted">
                      {t('settings.hosts.guestBadge')}
                    </span>
                  )}
                  {dnVerify.state === 'done' && dnVerify.result && (
                    <span
                      className={`settings-status-chip${
                        dnVerify.result.valid
                          ? ' settings-status-chip-info'
                          : ' settings-status-chip-err'
                      }`}
                      title={dnVerify.result.message}
                    >
                      {dnVerify.result.valid ? 'OK' : t('settings.hosts.invalid')}
                    </span>
                  )}
                </div>
              </div>

              <div className="settings-host-form">
                <label className="settings-host-field">
                  <span className="settings-host-field-label">{t('settings.hosts.datanodesKey')}</span>
                  <div className="settings-host-input-wrap">
                    <input
                      type={dnKeyVisible ? 'text' : 'password'}
                      value={dnApiKey}
                      onChange={(e) => setDnApiKey(e.target.value)}
                      placeholder={t('settings.hosts.datanodesKeyPlaceholder')}
                      className="settings-host-input"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="settings-host-input-toggle"
                      onClick={() => setDnKeyVisible((v) => !v)}
                      title={dnKeyVisible ? t('common.hide') : t('common.show')}
                      aria-label={dnKeyVisible ? t('common.hide') : t('common.show')}
                    >
                      {dnKeyVisible ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </label>
              </div>

              {dnVerify.state === 'done' && dnVerify.result && (
                <div
                  className={`settings-host-feedback${
                    dnVerify.result.valid
                      ? ' settings-host-feedback-ok'
                      : ' settings-host-feedback-err'
                  }`}
                  role="status"
                >
                  {dnVerify.result.message}
                </div>
              )}

              <div className="settings-host-toolbar">
                <details className="settings-host-help">
                  <summary>{t('settings.hosts.datanodesHelp')}</summary>
                  <ol>
                    <li>{t('settings.hosts.datanodesHelp.intro')}</li>
                    <li>
                      {t('settings.hosts.datanodesHelp.key')}{' '}
                      <button
                        type="button"
                        className="settings-inline-link"
                        onClick={() => openUrl('https://datanodes.to/account')}
                      >
                        datanodes.to/account
                      </button>
                    </li>
                    <li>{t('settings.hosts.datanodesHelp.note')}</li>
                  </ol>
                </details>
                <div className="settings-host-toolbar-actions">
                  {dnSaved && (
                    <button
                      type="button"
                      className="settings-toolbar-btn settings-toolbar-btn-ghost"
                      disabled={busy !== null}
                      onClick={onClearDatanodesKey}
                    >
                      {t('common.clear')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-toolbar-btn"
                    disabled={busy !== null || !dnSaved || dnVerify.state === 'verifying'}
                    onClick={onVerifyDatanodesKey}
                  >
                    {dnVerify.state === 'verifying'
                      ? t('settings.hosts.verifying')
                      : t('common.verify')}
                  </button>
                  <button
                    type="button"
                    className="settings-toolbar-btn settings-toolbar-btn-accent"
                    disabled={busy !== null || !dnDirty}
                    onClick={onSaveDatanodesKey}
                  >
                    {busy === 'dn-save' ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section id="settings-system" className="settings-section">
            <SectionHeader title={t('settings.nav.system')} />

            {runtime && (
              <>
                <div className="settings-card">
                  <h3 className="settings-card-title">{t('settings.updates.section')}</h3>
                  <p className="settings-card-hint">{t('settings.updates.hint')}</p>
                  <div className="settings-checklist">
                    <label className="settings-check-row">
                      <input
                        type="checkbox"
                        checked={runtime.autoUpdateEnabled}
                        onChange={(e) =>
                          void saveAppRuntimeSettings({ autoUpdateEnabled: e.target.checked })
                        }
                      />
                      <span>{t('settings.updates.auto')}</span>
                    </label>
                  </div>
                  <div className="settings-offline-actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="settings-btn"
                      disabled={updateBusy || isOffline}
                      onClick={() => {
                        setUpdateBusy(true);
                        void checkForAppUpdateInteractive(t).finally(() => setUpdateBusy(false));
                      }}
                    >
                      {updateBusy ? t('settings.updates.checking') : t('settings.updates.checkNow')}
                    </button>
                  </div>
                </div>

                <div className="settings-card">
                  <h3 className="settings-card-title">{t('settings.tray.section')}</h3>
                  <p className="settings-card-hint">{t('settings.tray.hint')}</p>
                  <div className="settings-checklist">
                    <label className="settings-check-row">
                      <input
                        type="checkbox"
                        checked={runtime.trayIconEnabled}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          void saveAppRuntimeSettings({ trayIconEnabled: enabled }).then(() =>
                            syncTrayIcon(t),
                          );
                        }}
                      />
                      <span>{t('settings.tray.enabled')}</span>
                    </label>
                  </div>
                </div>
              </>
            )}

            <div id="settings-offline" className="settings-card">
              <h3 className="settings-card-title">{t('settings.offline.section')}</h3>
              <p className="settings-card-hint">{t('settings.offline.hint')}</p>
              <label className="settings-check-row">
                <input
                  type="checkbox"
                  checked={manualOffline}
                  onChange={(e) => void setManualOffline(e.target.checked)}
                />
                <span>{t('settings.offline.manual')}</span>
              </label>
              {isOffline && offlineReason && offlineReason !== 'manual' && (
                <p className="settings-card-hint settings-offline-reason">
                  {t(
                    offlineReason === 'f95'
                      ? 'settings.offline.reasonF95'
                      : 'settings.offline.reasonNetwork',
                  )}
                </p>
              )}
              <div className="settings-offline-actions">
                <button
                  type="button"
                  className="settings-btn"
                  disabled={probing}
                  onClick={() => void refreshConnectivity()}
                >
                  {probing ? t('offline.retrying') : t('settings.offline.test')}
                </button>
                {lastCheckedAt != null && (
                  <span className="settings-offline-last">
                    {t('settings.offline.lastCheck', {
                      time: new Date(lastCheckedAt).toLocaleString(),
                    })}
                  </span>
                )}
              </div>
            </div>

            <div className="settings-card">
              <h3 className="settings-card-title">{t('settings.database.section')}</h3>
              <ActionRow
                label={t('settings.database.location')}
                value={info?.databaseDir ?? '…'}
                mono
                action={
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={onRevealDatabase}
                    disabled={!info}
                  >
                    {t('common.open')}
                  </button>
                }
              />
            </div>

            {isDevDebugPanelAvailable() && devDebug && (
              <div className="settings-card">
                <h3 className="settings-card-title">{t('settings.dev.section')}</h3>
                <p className="settings-card-hint">{t('settings.dev.panelHint')}</p>
                <div className="settings-checklist">
                  <label className="settings-check-row">
                    <input
                      type="checkbox"
                      checked={devDebug.panelEnabled}
                      onChange={(e) =>
                        void saveDevDebugSettings({ panelEnabled: e.target.checked })
                      }
                    />
                    <span>{t('settings.dev.panel')}</span>
                  </label>
                </div>
                {devDebug.panelEnabled && (
                  <p className="settings-card-hint">{t('settings.dev.panelLayout')}</p>
                )}
              </div>
            )}

            <div className="settings-card">
              <h3 className="settings-card-title">{t('settings.maintenance.section')}</h3>
              <ActionRow
                label={t('settings.maintenance.cache')}
                value={
                  counts
                    ? t('settings.maintenance.cacheEntries', { count: counts.games })
                    : '…'
                }
                action={
                  <button
                    type="button"
                    className="settings-btn"
                    disabled={busy !== null}
                    onClick={clearGamesCache}
                  >
                    {busy === 'games' ? t('common.clearing') : t('common.clear')}
                  </button>
                }
              />
              <ActionRow
                label={t('settings.maintenance.finished')}
                value={
                  counts
                    ? t('settings.maintenance.finishedEntries', { count: counts.finishedDownloads })
                    : '…'
                }
                action={
                  <button
                    type="button"
                    className="settings-btn"
                    disabled={busy !== null}
                    onClick={clearFinishedDownloads}
                  >
                    {busy === 'downloads' ? t('common.clearing') : t('common.clear')}
                  </button>
                }
              />
              <ActionRow
                label={t('settings.maintenance.sessions')}
                value={counts ? String(counts.sessions) : '…'}
                hint={t('settings.maintenance.sessionsHint')}
              />
            </div>

            <div className="settings-card settings-about-card">
              <h3 className="settings-card-title">{t('settings.about.section')}</h3>
              <dl className="settings-about-dl">
                <div>
                  <dt>{t('settings.about.app')}</dt>
                  <dd>
                    {info
                      ? t('settings.about.appLine', { name: info.name, version: info.version })
                      : '…'}
                  </dd>
                </div>
                <div>
                  <dt>{t('settings.about.tauri')}</dt>
                  <dd>{info?.tauriVersion ?? '…'}</dd>
                </div>
              </dl>
            </div>

            <div className="settings-card">
              <h3 className="settings-card-title">{t('settings.changelog.section')}</h3>
              <p className="settings-card-hint">{t('settings.changelog.hint')}</p>
              <div className="settings-changelog">
                {(changelogExpanded ? changelogEntries : changelogEntries.slice(0, 3)).map(
                  (entry) => (
                    <article key={`${entry.version}-${entry.date ?? 'na'}`} className="settings-changelog-entry">
                      <header className="settings-changelog-head">
                        <h4 className="settings-changelog-version">
                          {entry.version === 'Unreleased'
                            ? t('settings.changelog.unreleased')
                            : `v${entry.version.replace(/^v/i, '')}`}
                        </h4>
                        {entry.date && (
                          <time className="settings-changelog-date" dateTime={entry.date}>
                            {entry.date}
                          </time>
                        )}
                      </header>
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
                  ),
                )}
              </div>
              {changelogEntries.length > 3 && (
                <button
                  type="button"
                  className="settings-toolbar-btn settings-toolbar-btn-ghost"
                  style={{ marginTop: 12 }}
                  onClick={() => setChangelogExpanded((v) => !v)}
                >
                  {changelogExpanded
                    ? t('settings.changelog.showLess')
                    : t('settings.changelog.showMore')}
                </button>
              )}
            </div>
          </section>

          <section id="settings-experimental" className="settings-section">
            <SectionHeader
              title={t('settings.experimental.section')}
              hint={t('settings.experimental.banner')}
            />

            {experimental && (
              <>
                <div className="settings-card settings-experimental-banner">
                  <p className="settings-card-hint">{t('settings.experimental.fullscreenHint')}</p>
                </div>

                <div className="settings-card">
                  <h3 className="settings-card-title">{t('settings.experimental.overlay')}</h3>
                  <p className="settings-card-hint">{t('settings.experimental.overlayHint')}</p>
                  <div className="settings-checklist">
                    <label className="settings-check-row">
                      <input
                        type="checkbox"
                        checked={experimental.overlayEnabled}
                        onChange={(e) => {
                          void saveExperimentalSettings({ overlayEnabled: e.target.checked }).then(
                            () =>
                              syncOverlayHotkey().then(() =>
                                setOverlayHotkeyOk(isOverlayHotkeyRegistered()),
                              ),
                          );
                        }}
                      />
                      <span>{t('settings.experimental.overlayEnabled')}</span>
                    </label>
                  </div>

                  {experimental.overlayEnabled && (
                    <div className="settings-experimental-sub">
                      <label className="settings-field">
                        <span className="settings-field-label">
                          {t('settings.experimental.hotkey')}
                        </span>
                        <div className="settings-field-row">
                          <input
                            type="text"
                            className="settings-input"
                            value={experimental.overlayHotkey}
                            onChange={(e) =>
                              setExperimental({ ...experimental, overlayHotkey: e.target.value })
                            }
                            onBlur={() => {
                              void saveExperimentalSettings({
                                overlayHotkey: experimental.overlayHotkey.trim() || DEFAULT_OVERLAY_HOTKEY,
                              }).then(() =>
                                syncOverlayHotkey().then(() =>
                                  setOverlayHotkeyOk(isOverlayHotkeyRegistered()),
                                ),
                              );
                            }}
                          />
                          <button
                            type="button"
                            className="settings-btn"
                            onClick={() => {
                              void saveExperimentalSettings({
                                overlayHotkey: DEFAULT_OVERLAY_HOTKEY,
                              }).then(() =>
                                syncOverlayHotkey().then(() =>
                                  setOverlayHotkeyOk(isOverlayHotkeyRegistered()),
                                ),
                              );
                            }}
                          >
                            {t('settings.experimental.hotkeyReset')}
                          </button>
                        </div>
                        {!overlayHotkeyOk && (
                          <p className="settings-card-hint settings-hotkey-warn">
                            {getOverlayHotkeyRegistrationMessage() ??
                              t('settings.experimental.hotkeyConflict')}
                          </p>
                        )}
                        {overlayHotkeyOk &&
                          experimental.overlayHotkey.toLowerCase().includes('shift') &&
                          experimental.overlayHotkey.toLowerCase().includes('tab') && (
                            <p className="settings-card-hint">
                              {t('settings.experimental.hotkeySteamNote')}
                            </p>
                          )}
                      </label>

                      <fieldset className="settings-field">
                        <legend className="settings-field-label">
                          {t('settings.experimental.displayMode')}
                        </legend>
                        <label className="settings-check-row">
                          <input
                            type="radio"
                            name="overlay-display"
                            checked={experimental.overlayDisplayMode === 'fullscreen'}
                            onChange={() =>
                              void saveExperimentalSettings({ overlayDisplayMode: 'fullscreen' })
                            }
                          />
                          <span>{t('settings.experimental.displayFullscreen')}</span>
                        </label>
                        <label className="settings-check-row">
                          <input
                            type="radio"
                            name="overlay-display"
                            checked={experimental.overlayDisplayMode === 'compact'}
                            onChange={() =>
                              void saveExperimentalSettings({ overlayDisplayMode: 'compact' })
                            }
                          />
                          <span>{t('settings.experimental.displayCompact')}</span>
                        </label>
                      </fieldset>

                      {experimental.overlayDisplayMode === 'fullscreen' && (
                        <label className="settings-field">
                          <span className="settings-field-label">
                            {t('settings.experimental.backdropOpacity')}:{' '}
                            {Math.round(experimental.overlayBackdropOpacity * 100)}%
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={Math.round(experimental.overlayBackdropOpacity * 100)}
                            onChange={(e) =>
                              void saveExperimentalSettings({
                                overlayBackdropOpacity: Number(e.target.value) / 100,
                              })
                            }
                          />
                        </label>
                      )}

                      {experimental.overlayDisplayMode === 'compact' && (
                        <div className="settings-experimental-geom">
                          <p className="settings-card-hint">
                            {t('settings.experimental.compactGeom')}
                          </p>
                          <div className="settings-field-row">
                            <input
                              type="number"
                              className="settings-input settings-input-narrow"
                              value={experimental.overlayCompactGeom.w}
                              min={400}
                              onChange={(e) =>
                                setExperimental({
                                  ...experimental,
                                  overlayCompactGeom: {
                                    ...experimental.overlayCompactGeom,
                                    w: Number(e.target.value),
                                  },
                                })
                              }
                              onBlur={() =>
                                void saveExperimentalSettings({
                                  overlayCompactGeom: experimental.overlayCompactGeom,
                                })
                              }
                            />
                            <span>×</span>
                            <input
                              type="number"
                              className="settings-input settings-input-narrow"
                              value={experimental.overlayCompactGeom.h}
                              min={280}
                              onChange={(e) =>
                                setExperimental({
                                  ...experimental,
                                  overlayCompactGeom: {
                                    ...experimental.overlayCompactGeom,
                                    h: Number(e.target.value),
                                  },
                                })
                              }
                              onBlur={() =>
                                void saveExperimentalSettings({
                                  overlayCompactGeom: experimental.overlayCompactGeom,
                                })
                              }
                            />
                          </div>
                          <p className="settings-card-hint">
                            {t('settings.experimental.compactPosition')}
                          </p>
                          <div className="settings-field-row">
                            <input
                              type="number"
                              className="settings-input settings-input-narrow"
                              value={experimental.overlayCompactGeom.x}
                              onChange={(e) =>
                                setExperimental({
                                  ...experimental,
                                  overlayCompactGeom: {
                                    ...experimental.overlayCompactGeom,
                                    x: Number(e.target.value),
                                  },
                                })
                              }
                              onBlur={() =>
                                void saveExperimentalSettings({
                                  overlayCompactGeom: experimental.overlayCompactGeom,
                                })
                              }
                            />
                            <input
                              type="number"
                              className="settings-input settings-input-narrow"
                              value={experimental.overlayCompactGeom.y}
                              onChange={(e) =>
                                setExperimental({
                                  ...experimental,
                                  overlayCompactGeom: {
                                    ...experimental.overlayCompactGeom,
                                    y: Number(e.target.value),
                                  },
                                })
                              }
                              onBlur={() =>
                                void saveExperimentalSettings({
                                  overlayCompactGeom: experimental.overlayCompactGeom,
                                })
                              }
                            />
                            <button
                              type="button"
                              className="settings-btn"
                              onClick={() =>
                                void saveExperimentalSettings({
                                  overlayCompactGeom: { ...DEFAULT_COMPACT_GEOM },
                                })
                              }
                            >
                              {t('settings.experimental.resetCompactGeom')}
                            </button>
                          </div>
                        </div>
                      )}

                      <label className="settings-field">
                        <span className="settings-field-label">
                          {t('settings.experimental.browserHomeUrl')}
                        </span>
                        <input
                          type="url"
                          className="settings-input"
                          value={experimental.browserHomeUrl}
                          onChange={(e) =>
                            setExperimental({ ...experimental, browserHomeUrl: e.target.value })
                          }
                          onBlur={() =>
                            void saveExperimentalSettings({
                              browserHomeUrl: experimental.browserHomeUrl,
                            })
                          }
                        />
                      </label>

                      <ActionRow
                        label={t('settings.experimental.testOverlay')}
                        value={
                          overlayAnchorProbe
                            ? `${t('settings.experimental.anchorStatus')}: ${overlayAnchorProbe}`
                            : runningCount > 0
                              ? t('settings.experimental.testOverlayHint')
                              : t('settings.experimental.noGameRunning')
                        }
                        action={
                          <button
                            type="button"
                            className="settings-btn"
                            disabled={runningCount === 0}
                            onClick={() => {
                              void (async () => {
                                console.info('[overlay] teste: overlayShow()');
                                try {
                                  const st = await ipc.overlayShow();
                                  console.info('[overlay] teste: ok', st);
                                  setOverlayAnchorProbe(formatOverlayAnchorStatus(st, t));
                                } catch (err) {
                                  const msg = formatIpcError(err);
                                  console.warn('[overlay] teste: falhou', msg);
                                  setOverlayAnchorProbe(msg);
                                }
                              })();
                            }}
                          >
                            {t('settings.experimental.testOverlay')}
                          </button>
                        }
                      />
                    </div>
                  )}
                </div>

                <div className="settings-card">
                  <h3 className="settings-card-title">{t('settings.experimental.features')}</h3>
                  <div className="settings-checklist">
                    {(
                      [
                        ['notes', 'settings.experimental.featureNotes'],
                        ['guides', 'settings.experimental.featureGuides'],
                        ['browser', 'settings.experimental.featureBrowser'],
                        ['achievements', 'settings.experimental.featureAchievements'],
                      ] as const
                    ).map(([key, labelKey]) => (
                      <label key={key} className="settings-check-row">
                        <input
                          type="checkbox"
                          checked={experimental.features[key]}
                          onChange={(e) =>
                            void saveExperimentalSettings({
                              features: {
                                ...experimental.features,
                                [key]: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>{t(labelKey)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>

          <section id="settings-account" className="settings-section settings-section-danger">
            <SectionHeader title={t('settings.account.section')} />
            <div className="settings-card settings-account-card">
              <p className="settings-card-hint">{t('settings.account.confirmLogout')}</p>
              <button
                type="button"
                className="settings-btn settings-btn-logout"
                disabled={busy !== null}
                onClick={onLogout}
              >
                {busy === 'logout' ? t('settings.account.loggingOut') : t('settings.account.logout')}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="settings-section-head">
      <div>
        <h2 className="settings-section-title">{title}</h2>
        {hint && <p className="settings-section-hint">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

function ActionRow({
  label,
  value,
  hint,
  mono,
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="settings-action-row">
      <div className="settings-action-row-text">
        <span className="settings-action-row-label">{label}</span>
        <span className={`settings-action-row-value${mono ? ' settings-action-row-value-mono' : ''}`}>
          {value}
        </span>
        {hint && <span className="settings-action-row-hint">{hint}</span>}
      </div>
      {action}
    </div>
  );
}

function LibraryRow({
  lib,
  busy,
  isLast,
  canRemove,
  t,
  onReveal,
  onRename,
  onSetDefault,
  onRemove,
}: {
  lib: InstallLibraryWithDisk;
  busy: string | null;
  isLast: boolean;
  canRemove: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onReveal: () => void;
  onRename: () => void;
  onSetDefault: () => void;
  onRemove: () => void;
}) {
  const diskOk = lib.disk.available;
  const spaceLevel = diskSpaceLevel(lib.disk.freeBytes, diskOk);
  const drive = driveLetter(lib.path);

  return (
    <article
      className={`settings-lib-item${lib.isDefault ? ' settings-lib-item-default' : ''}${
        !isLast ? ' settings-lib-item-divider' : ''
      }`}
    >
      <div className="settings-lib-main">
        <span
          className={`settings-lib-drive${!diskOk ? ' settings-lib-drive-offline' : ''}`}
          aria-hidden
        >
          {drive}
        </span>
        <div className="settings-lib-info">
          <div className="settings-lib-title-row">
            <h3 className="settings-lib-name">{lib.label}</h3>
            {lib.isDefault && (
              <span className="settings-status-chip settings-status-chip-ok">
                {t('settings.libraries.default')}
              </span>
            )}
            {!diskOk && (
              <span className="settings-status-chip settings-status-chip-err">
                {t('settings.libraries.offline')}
              </span>
            )}
          </div>
          <code className="settings-lib-path" title={lib.path}>
            {lib.path}
          </code>
          <div className={`settings-lib-space settings-lib-space-${spaceLevel}`}>
            <span className="settings-lib-space-dot" aria-hidden />
            <span>
              {diskOk
                ? t('settings.libraries.free', {
                    amount: libraries.formatFreeSpace(lib.disk.freeBytes),
                  })
                : t('settings.libraries.unavailable')}
            </span>
          </div>
        </div>
      </div>
      <div className="settings-lib-toolbar">
        <button type="button" className="settings-link-btn" onClick={onReveal}>
          {t('common.open')}
        </button>
        <span className="settings-lib-toolbar-sep" aria-hidden />
        <button type="button" className="settings-link-btn" onClick={onRename}>
          {t('common.rename')}
        </button>
        {!lib.isDefault && (
          <>
            <span className="settings-lib-toolbar-sep" aria-hidden />
            <button
              type="button"
              className="settings-link-btn"
              disabled={busy !== null}
              onClick={onSetDefault}
            >
              {t('settings.libraries.setDefault')}
            </button>
          </>
        )}
        {canRemove && (
          <>
            <span className="settings-lib-toolbar-sep" aria-hidden />
            <button
              type="button"
              className="settings-link-btn settings-link-btn-danger"
              disabled={busy !== null}
              onClick={onRemove}
            >
              {t('common.remove')}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function driveLetter(path: string): string {
  const match = /^([A-Za-z]):/.exec(path);
  return match ? match[1].toUpperCase() : '∿';
}

function diskSpaceLevel(freeBytes: number, available: boolean): 'ok' | 'mid' | 'low' | 'offline' {
  if (!available) return 'offline';
  const gb5 = 5 * 1024 * 1024 * 1024;
  const gb20 = 20 * 1024 * 1024 * 1024;
  if (freeBytes < gb5) return 'low';
  if (freeBytes < gb20) return 'mid';
  return 'ok';
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 3l18 18M10.5 10.7A3 3 0 0 0 12 15a3 3 0 0 0 2.3-1M6.7 6.8C4.6 8.4 3 10.5 2 12c0 0 3.5 7 10 7 1.8 0 3.4-.5 4.8-1.2M17.3 17.2C19.4 15.6 21 13.5 22 12c0 0-3.5-7-10-7-1.3 0-2.5.3-3.6.7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
