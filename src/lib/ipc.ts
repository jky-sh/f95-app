import { invoke } from '@tauri-apps/api/core';
import type { ProfileDto } from '../types';
import type { SamFilters, SamOptionsResult, SamPage, SamTag } from '../types/sam';
import type { SamCategory } from '../types/sam';
import type { GameDetail } from '../types/game';
import type { CbzPreviewResult, InstallMediaIndex } from '../types/media';
import type { F95AlertsListResult, F95AlertsPopupResult } from '../types/alerts';
import type { FollowedUser, MemberProfileDto } from '../types/social';
import type { RssFeed, RssFeedOptions } from '../types/rss';
import type { RunningInfo } from '../types/session';
import type {
  OverlayAnchorStatus,
  OverlayCompactGeom,
  OverlayContext,
  OverlayLayout,
} from '../types/overlay';
import * as settings from './settings';
import {
  getExperimentalSettings,
  loadExperimentalSettings,
} from './experimentalSettings';

export async function login(username: string, password: string): Promise<void> {
  await invoke<void>('login', { username, password });
}

export async function isLoggedIn(): Promise<boolean> {
  return invoke<boolean>('is_logged_in');
}

export async function hasLocalSession(): Promise<boolean> {
  return invoke<boolean>('has_local_session');
}

export interface NetworkStatus {
  internet: boolean;
  f95Reachable: boolean;
}

export async function checkNetwork(): Promise<NetworkStatus> {
  return invoke<NetworkStatus>('check_network');
}

export async function logout(): Promise<void> {
  await invoke<void>('logout');
}

export async function samList(filters: SamFilters): Promise<SamPage> {
  return invoke<SamPage>('sam_list', { filters });
}

export async function samTagSearch(category: SamCategory, search: string): Promise<SamTag[]> {
  return invoke<SamTag[]>('sam_tag_search', { category, search });
}

export async function samOptions(category: SamCategory): Promise<SamOptionsResult> {
  return invoke<SamOptionsResult>('sam_options', { category });
}

export async function gameDetail(threadId: string): Promise<GameDetail> {
  return invoke<GameDetail>('game_detail', { threadId });
}

export async function getFollowing(): Promise<FollowedUser[]> {
  return invoke<FollowedUser[]>('get_following');
}

export async function getProfile(): Promise<ProfileDto> {
  return invoke<ProfileDto>('get_profile');
}

export async function getMemberProfile(userId: string): Promise<MemberProfileDto> {
  return invoke<MemberProfileDto>('get_member_profile', { userId });
}

export async function fetchRssFeed(options: RssFeedOptions = {}): Promise<RssFeed> {
  return invoke<RssFeed>('fetch_rss_feed', {
    category: options.category ?? 'games',
  });
}

export async function fetchAlertsPopup(): Promise<F95AlertsPopupResult> {
  return invoke<F95AlertsPopupResult>('fetch_alerts_popup');
}

export async function fetchAlertsList(page = 1): Promise<F95AlertsListResult> {
  return invoke<F95AlertsListResult>('fetch_alerts_list', { page });
}

async function ensureUploadhavenSession(): Promise<void> {
  const [cookies, email, isPro] = await Promise.all([
    settings.get(settings.KEY_UPLOADHAVEN_COOKIES),
    settings.get(settings.KEY_UPLOADHAVEN_EMAIL),
    settings.get(settings.KEY_UPLOADHAVEN_IS_PRO),
  ]);
  if (!cookies) return;
  await setUploadhavenSession({
    cookieHeader: cookies,
    email: email ?? undefined,
    isPro: isPro === '1' || isPro === 'true',
  });
}

async function ensureBuzzheavierAccount(): Promise<void> {
  const accountId = await settings.get(settings.KEY_BUZZHEAVIER_ACCOUNT_ID);
  if (!accountId) return;
  await setBuzzheavierAccount({ accountId });
}

export async function downloadStart(args: {
  id: number;
  sourceUrl: string;
  threadId: string;
  libraryPath?: string | null;
  /** F95 section label, e.g. "Win/Linux" — helps pick the PC file in multi-build folders. */
  platformGroup?: string | null;
}): Promise<void> {
  await ensureUploadhavenSession();
  await ensureBuzzheavierAccount();
  return invoke('download_start', args);
}

export async function downloadContinueChoice(args: {
  id: number;
  choiceId: string;
  threadId: string;
  libraryPath?: string | null;
}): Promise<void> {
  return invoke('download_continue_choice', args);
}

export async function downloadCancel(id: number): Promise<void> {
  return invoke('download_cancel', { id });
}

export async function openCaptchaWindow(args: {
  downloadId: number;
  url: string;
  host: string;
}): Promise<void> {
  return invoke('open_captcha_window', {
    downloadId: args.downloadId,
    url: args.url,
    host: args.host,
  });
}

export async function downloadContinueCaptcha(args: {
  id: number;
  sourceUrl: string;
  pageUrl: string;
  threadId: string;
  libraryPath?: string | null;
}): Promise<void> {
  return invoke('download_continue_captcha', {
    id: args.id,
    sourceUrl: args.sourceUrl,
    pageUrl: args.pageUrl,
    threadId: args.threadId,
    libraryPath: args.libraryPath ?? null,
  });
}

export async function revealInExplorer(path: string): Promise<void> {
  return invoke('reveal_in_explorer', { path });
}

export interface ExtractResult {
  destDir: string;
  exePath: string | null;
}

export async function extractArchive(args: {
  archivePath: string;
  gameTitle: string;
}): Promise<ExtractResult> {
  return invoke<ExtractResult>('extract_archive', args);
}

export async function deletePath(path: string): Promise<void> {
  return invoke('delete_path', { path });
}

export interface CreateShortcutsResult {
  desktop: boolean;
  startMenu: boolean;
  message: string;
}

export async function createGameShortcuts(args: {
  exePath: string;
  title: string;
}): Promise<CreateShortcutsResult> {
  return invoke<CreateShortcutsResult>('create_game_shortcuts', args);
}

export async function scanInstallMedia(args: {
  installPath: string;
  category: string;
}): Promise<InstallMediaIndex> {
  return invoke<InstallMediaIndex>('scan_install_media', args);
}

export async function resolveMediaPreview(args: {
  path: string;
  variant: 'thumb' | 'display';
}): Promise<string> {
  return invoke<string>('resolve_media_preview', args);
}

export async function resolveRemoteImagePreview(args: {
  url: string;
  variant: 'grid';
}): Promise<string> {
  return invoke<string>('resolve_remote_image_preview', args);
}

export async function extractCbzPreview(args: {
  archivePath: string;
  maxPages?: number;
}): Promise<CbzPreviewResult> {
  return invoke<CbzPreviewResult>('extract_cbz_preview', args);
}

export async function launchGame(args: {
  threadId: string;
  title: string;
  exePath: string;
  sessionId: number;
}): Promise<number> {
  return invoke<number>('launch_game', args);
}

export async function stopGame(threadId: string): Promise<void> {
  return invoke('stop_game', { threadId });
}

export async function runningGames(): Promise<RunningInfo[]> {
  return invoke<RunningInfo[]>('running_games');
}

export interface MigrationResult {
  copied: number;
  bytes_copied: number;
  destinations: string[];
}

export async function migrateSaves(args: {
  oldInstallDir: string;
  newInstallDir: string;
}): Promise<MigrationResult> {
  return invoke<MigrationResult>('migrate_saves', args);
}

export async function deleteInstallDir(args: {
  path: string;
  safeRoots?: string[];
}): Promise<boolean> {
  return invoke<boolean>('delete_install_dir', args);
}

export async function defaultDownloadsPath(): Promise<string> {
  return invoke<string>('default_downloads_path');
}

export interface DiskInfo {
  freeBytes: number;
  available: boolean;
}

export async function diskInfo(path: string): Promise<DiskInfo> {
  return invoke<DiskInfo>('disk_info', { path });
}

export interface MoveStartResult {
  destInstallPath: string;
  totalBytes: number;
}

export async function moveInstallStart(args: {
  threadId: string;
  oldInstallPath: string;
  oldExePath: string | null;
  newLibraryPath: string;
}): Promise<MoveStartResult> {
  return invoke<MoveStartResult>('move_install_start', args);
}

export async function moveInstallCancel(threadId: string): Promise<void> {
  return invoke('move_install_cancel', { threadId });
}

export async function setGofileCredentials(args: {
  token: string | null;
  accountId?: string | null;
}): Promise<void> {
  return invoke('set_gofile_credentials', {
    token: args.token ?? null,
    accountId: args.accountId ?? null,
  });
}

export interface GofileVerifyResult {
  valid: boolean;
  tier: string | null;
  email: string | null;
  message: string;
}

export async function verifyGofileCredentials(): Promise<GofileVerifyResult> {
  return invoke<GofileVerifyResult>('verify_gofile_credentials');
}

export async function setMegaSession(args: { session: string | null }): Promise<void> {
  return invoke('set_mega_session', { session: args.session ?? null });
}

export interface MegaLoginResult {
  session: string;
  email: string;
  message: string;
}

export async function loginMega(args: {
  email: string;
  password: string;
  mfa?: string | null;
}): Promise<MegaLoginResult> {
  return invoke<MegaLoginResult>('login_mega', {
    email: args.email,
    password: args.password,
    mfa: args.mfa ?? null,
  });
}

export interface MegaVerifyResult {
  valid: boolean;
  email: string | null;
  usedBytes: number | null;
  totalBytes: number | null;
  message: string;
}

export async function verifyMegaSession(): Promise<MegaVerifyResult> {
  return invoke<MegaVerifyResult>('verify_mega_session');
}

export async function setUploadhavenSession(args: {
  cookieHeader: string | null;
  email?: string | null;
  isPro?: boolean;
}): Promise<void> {
  return invoke('set_uploadhaven_session', {
    cookieHeader: args.cookieHeader ?? null,
    email: args.email ?? null,
    isPro: args.isPro ?? false,
  });
}

export interface UploadHavenLoginResult {
  cookieHeader: string;
  email: string;
  isPro: boolean;
  message: string;
}

export async function loginUploadhaven(args: {
  email: string;
  password: string;
}): Promise<UploadHavenLoginResult> {
  return invoke<UploadHavenLoginResult>('login_uploadhaven', args);
}

export interface UploadHavenVerifyResult {
  valid: boolean;
  email: string | null;
  isPro: boolean;
  message: string;
  cookieHeader?: string | null;
}

export async function verifyUploadhavenSession(): Promise<UploadHavenVerifyResult> {
  return invoke<UploadHavenVerifyResult>('verify_uploadhaven_session');
}

export async function setBuzzheavierAccount(args: {
  accountId: string | null;
}): Promise<void> {
  return invoke('set_buzzheavier_account', {
    accountId: args.accountId ?? null,
  });
}

export interface BuzzheavierVerifyResult {
  valid: boolean;
  email: string | null;
  storageUsed: string | null;
  storageLimit: string | null;
  message: string;
}

export async function verifyBuzzheavierAccount(): Promise<BuzzheavierVerifyResult> {
  return invoke<BuzzheavierVerifyResult>('verify_buzzheavier_account');
}

export async function setDatanodesKey(args: { key: string | null }): Promise<void> {
  return invoke('set_datanodes_key', { key: args.key ?? null });
}

export interface DatanodesVerifyResult {
  valid: boolean;
  email: string | null;
  storageLeft: string | null;
  premiumExpire: string | null;
  message: string;
}

export async function verifyDatanodesKey(): Promise<DatanodesVerifyResult> {
  return invoke<DatanodesVerifyResult>('verify_datanodes_key');
}

export async function setMixdropCredentials(args: {
  email: string | null;
  apiKey: string | null;
}): Promise<void> {
  return invoke('set_mixdrop_credentials', {
    email: args.email ?? null,
    apiKey: args.apiKey ?? null,
  });
}

export interface MixdropVerifyResult {
  valid: boolean;
  message: string;
}

export async function verifyMixdropCredentials(): Promise<MixdropVerifyResult> {
  return invoke<MixdropVerifyResult>('verify_mixdrop_credentials');
}

/* ── Achievements Steam ────────────────────────────────────────────────── */

export interface SteamAchievementSchemaEntry {
  apiName: string;
  displayName: string;
  description: string;
  iconUrl: string;
  iconGrayUrl: string;
  hidden: boolean;
  globalPercent: number | null;
}

export async function steamFetchAchievementSchema(args: {
  appId: string;
  language: string;
  apiKey?: string | null;
}): Promise<SteamAchievementSchemaEntry[]> {
  return invoke<SteamAchievementSchemaEntry[]>('steam_fetch_achievement_schema', {
    appId: args.appId,
    language: args.language,
    apiKey: args.apiKey ?? null,
  });
}

export interface SteamSearchResult {
  appId: string;
  name: string;
}

export async function steamSearchGames(term: string): Promise<SteamSearchResult[]> {
  return invoke<SteamSearchResult[]>('steam_search_games', { term });
}

export async function steamDetectAppid(args: {
  installPath?: string | null;
  exePath?: string | null;
}): Promise<string | null> {
  return invoke<string | null>('steam_detect_appid', {
    installPath: args.installPath ?? null,
    exePath: args.exePath ?? null,
  });
}

export interface AchievementWatchConfig {
  threadId: string;
  appId: string;
  exePath: string | null;
  installPath?: string | null;
  title?: string | null;
  /** Modo experimental: procurar conquistas nos saves do próprio jogo. */
  saveScan?: boolean;
  /** Nomes do schema (api + display) — necessários quando saveScan ativo. */
  achievementNames?: { apiName: string; displayName: string }[];
}

export async function achievementsConfigure(
  games: AchievementWatchConfig[],
): Promise<void> {
  return invoke('achievements_configure', { games });
}

export async function achievementsScanNow(): Promise<void> {
  return invoke('achievements_scan_now');
}

export interface AchievementToastItem {
  title: string;
  description: string | null;
  iconUrl: string | null;
}

/** Toast estilo Hydra sobre a janela do jogo. Retorna false se o jogo não
 *  está rodando (chamador cai para a notificação do sininho). */
export async function achievementToast(args: {
  threadId: string;
  items: AchievementToastItem[];
  unlockedCount: number;
  totalCount: number;
}): Promise<boolean> {
  return invoke<boolean>('achievement_toast', args);
}

export async function completeLogin(): Promise<void> {
  return invoke('complete_login');
}

export async function restartToLogin(): Promise<void> {
  return invoke('restart_to_login');
}

export async function pingSidecar(): Promise<void> {
  return invoke('ping_sidecar');
}

export function buildOverlayLayout(): OverlayLayout {
  const exp = getExperimentalSettings();
  const layout: OverlayLayout = {
    displayMode: exp.overlayDisplayMode,
  };
  if (exp.overlayDisplayMode === 'compact') {
    layout.geom = { ...exp.overlayCompactGeom };
  }
  return layout;
}

export async function overlayEnsure(): Promise<void> {
  return invoke('overlay_ensure');
}

export async function overlaySetContext(context: OverlayContext): Promise<void> {
  return invoke('overlay_set_context', { context });
}

export async function overlayGetContext(): Promise<OverlayContext | null> {
  return invoke<OverlayContext | null>('overlay_get_context');
}

export async function overlayClearContext(): Promise<void> {
  return invoke('overlay_clear_context');
}

export async function overlayGetAnchorStatus(): Promise<OverlayAnchorStatus> {
  return invoke<OverlayAnchorStatus>('overlay_get_anchor_status');
}

export async function overlayShow(): Promise<OverlayAnchorStatus> {
  await loadExperimentalSettings();
  return invoke<OverlayAnchorStatus>('overlay_show', { layout: buildOverlayLayout() });
}

export async function overlayHide(): Promise<void> {
  return invoke('overlay_hide');
}

export async function overlayToggle(): Promise<boolean> {
  await loadExperimentalSettings();
  return invoke<boolean>('overlay_toggle', { layout: buildOverlayLayout() });
}

export interface OverlaySyncHotkeyResult {
  registered: boolean;
  hotkey: string;
  message: string | null;
}

export async function overlaySyncHotkey(
  enabled: boolean,
  hotkey: string,
): Promise<OverlaySyncHotkeyResult> {
  return invoke<OverlaySyncHotkeyResult>('overlay_sync_hotkey', { enabled, hotkey });
}

export async function overlayIsVisible(): Promise<boolean> {
  return invoke<boolean>('overlay_is_visible');
}

export async function overlayShowGameHint(payload: {
  title: string;
  hotkey: string;
  pid?: number;
}): Promise<void> {
  return invoke('overlay_show_game_hint', payload);
}

export async function overlayGetGameHintPayload(): Promise<{
  title: string;
  hotkey: string;
} | null> {
  return invoke<{ title: string; hotkey: string } | null>('overlay_get_game_hint_payload');
}

export async function overlayHideGameHint(): Promise<void> {
  return invoke('overlay_hide_game_hint');
}

export async function overlayPauseFollow(durationMs: number): Promise<void> {
  return invoke('overlay_pause_follow', { durationMs });
}

export async function overlaySyncCompactFromWindow(): Promise<OverlayCompactGeom> {
  return invoke<OverlayCompactGeom>('overlay_sync_compact_from_window');
}
