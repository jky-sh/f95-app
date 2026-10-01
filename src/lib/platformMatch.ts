/**
 * Mirrors `src-tauri/src/download/platform.rs` for modal UI (pre-select + sort).
 * Keep scoring rules in sync when changing either file.
 */

export type OsKind = 'windows' | 'mac' | 'android' | 'linux';

function containsToken(hay: string, token: string): boolean {
  return hay.split(/[^a-z0-9]+/).some((part) => part === token);
}

function segmentHas(hay: string, seg: string): boolean {
  return hay.split(/[.\-_]/).some((part) => part === seg);
}

function fileOsScores(fileName: string): Record<OsKind, number> {
  const n = fileName.toLowerCase();
  const s: Record<OsKind, number> = { windows: 0, mac: 0, android: 0, linux: 0 };

  const add = (os: OsKind, pts: number) => {
    s[os] += pts;
  };
  const penalizeOthers = (os: OsKind, pts: number) => {
    for (const k of Object.keys(s) as OsKind[]) {
      if (k !== os) s[k] -= pts;
    }
  };

  if (
    n.endsWith('.apk') ||
    n.endsWith('.aab') ||
    n.endsWith('.xapk') ||
    n.includes('.apk.') ||
    containsToken(n, 'android') ||
    containsToken(n, 'arm64-v8a') ||
    containsToken(n, 'armv7')
  ) {
    add('android', 140);
    penalizeOthers('android', 40);
  }

  if (
    n.endsWith('.dmg') ||
    n.endsWith('.pkg') ||
    containsToken(n, 'macos') ||
    containsToken(n, 'osx') ||
    containsToken(n, 'darwin') ||
    containsToken(n, 'apple-silicon') ||
    containsToken(n, 'universal-mac') ||
    segmentHas(n, 'mac') ||
    n.includes('-mac.') ||
    n.includes('_mac.') ||
    n.includes('.mac.') ||
    n.endsWith('-mac.zip') ||
    n.endsWith('-mac.7z')
  ) {
    add('mac', 130);
    penalizeOthers('mac', 35);
  }

  if (
    n.endsWith('.appimage') ||
    n.endsWith('.deb') ||
    n.endsWith('.rpm') ||
    n.endsWith('.run') ||
    containsToken(n, 'linux') ||
    containsToken(n, 'ubuntu') ||
    containsToken(n, 'debian') ||
    containsToken(n, 'fedora') ||
    containsToken(n, 'steamdeck') ||
    segmentHas(n, 'linux') ||
    n.includes('-linux.') ||
    n.includes('_linux.')
  ) {
    add('linux', 120);
    penalizeOthers('linux', 30);
  }

  if (
    n.endsWith('.exe') ||
    n.endsWith('.msi') ||
    containsToken(n, 'windows') ||
    containsToken(n, 'win64') ||
    containsToken(n, 'win32') ||
    containsToken(n, 'win10') ||
    containsToken(n, 'win11') ||
    (containsToken(n, 'x64') &&
      (containsToken(n, 'win') || containsToken(n, 'windows') || segmentHas(n, 'pc'))) ||
    segmentHas(n, 'pc') ||
    segmentHas(n, 'win') ||
    n.includes('-pc.') ||
    n.includes('_pc.') ||
    n.includes('.pc.') ||
    n.endsWith('-pc.zip') ||
    n.endsWith('-pc.7z') ||
    n.endsWith('-pc.rar')
  ) {
    add('windows', 130);
    penalizeOthers('windows', 35);
  }

  return s;
}

function targetOsFromGroup(group: string): OsKind[] {
  const g = group.toLowerCase();
  const targets: OsKind[] = [];
  const mentionsWin = g.includes('win') || g.includes('windows');
  const mentionsLinux = g.includes('linux');
  const mentionsMac = g.includes('mac') || g.includes('osx') || g.includes('apple');
  const mentionsAndroid = g.includes('android') || g.includes('apk') || g.includes('mobile');

  if (mentionsWin) targets.push('windows');
  if (mentionsLinux) targets.push('linux');
  if (mentionsMac) targets.push('mac');
  if (mentionsAndroid) targets.push('android');
  if (targets.length === 0 && (g.includes('pc') || g.includes('computer'))) {
    targets.push('windows');
  }
  return targets;
}

/** The system the app runs on, from the webview's user agent. */
export function currentOs(): OsKind {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS|Macintosh/i.test(ua)) return 'mac';
  return 'linux';
}

/** Whether a thread's download section ("Win/Linux", "PC", "Mac") is meant for `os`. */
export function groupFitsOs(group: string, os: OsKind): boolean {
  return targetOsFromGroup(group).includes(os);
}

export function inferPlatformLabel(fileName: string): string | null {
  const scores = fileOsScores(fileName);
  let best: { os: OsKind; score: number } | null = null;
  for (const [os, score] of Object.entries(scores) as [OsKind, number][]) {
    if (score <= 0) continue;
    if (!best || score > best.score) best = { os, score };
  }
  if (!best) return null;
  const labels: Record<OsKind, string> = {
    windows: 'Windows',
    mac: 'macOS',
    android: 'Android',
    linux: 'Linux',
  };
  return labels[best.os];
}

export function scoreForPlatformGroup(fileName: string, platformGroup: string | null): number {
  if (!platformGroup?.trim()) return 0;
  const targets = targetOsFromGroup(platformGroup);
  if (targets.length === 0) return 0;
  const scores = fileOsScores(fileName);
  let best = Number.MIN_SAFE_INTEGER;
  for (const t of targets) {
    best = Math.max(best, scores[t]);
  }
  return best;
}

export function pickRecommendedFileId(
  files: Array<{ id: string; fileName: string }>,
  platformGroup: string | null,
  serverRecommendedId?: string | null,
): string | null {
  if (serverRecommendedId && files.some((f) => f.id === serverRecommendedId)) {
    return serverRecommendedId;
  }
  if (files.length === 0) return null;
  if (!platformGroup?.trim()) return files[0].id;

  const scored = files
    .map((f) => ({ id: f.id, score: scoreForPlatformGroup(f.fileName, platformGroup) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1]?.score ?? Number.MIN_SAFE_INTEGER;
  if (best.score >= 70 && best.score - second >= 20) return best.id;
  return files[0].id;
}

/** Sort so the best match for the section appears first in the modal. */
export function sortFilesForGroup<T extends { fileName: string }>(
  files: T[],
  platformGroup: string | null,
): T[] {
  if (!platformGroup?.trim()) return files;
  return [...files].sort(
    (a, b) =>
      scoreForPlatformGroup(b.fileName, platformGroup) -
      scoreForPlatformGroup(a.fileName, platformGroup),
  );
}
