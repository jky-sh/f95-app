import { execute, query } from './db';
import * as ipc from './ipc';
import * as libraries from './libraries';
import type { DownloadRow, DownloadState } from '../types/download';

interface DbRow {
  id: number;
  thread_id: string;
  host: string;
  source_url: string;
  resolved_url: string | null;
  dest_path: string | null;
  state: string;
  bytes_total: number | null;
  bytes_done: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  game_version: string | null;
  library_path?: string | null;
  platform_group?: string | null;
}

function rowToDownload(r: DbRow): DownloadRow {
  return {
    id: r.id,
    threadId: r.thread_id,
    host: r.host,
    sourceUrl: r.source_url,
    resolvedUrl: r.resolved_url,
    destPath: r.dest_path,
    state: r.state as DownloadState,
    bytesTotal: r.bytes_total,
    bytesDone: r.bytes_done ?? 0,
    errorMessage: r.error_message,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    gameVersion: r.game_version,
    libraryPath: r.library_path ?? null,
    platformGroup: r.platform_group ?? null,
  };
}

export interface CreateInput {
  threadId: string;
  host: string;
  sourceUrl: string;
  /** Version F95Zone was showing when the user clicked Baixar. Applied to the
   * library row after extraction succeeds. */
  gameVersion?: string | null;
  /** Library the user picked; kept so Retry lands in the same place. */
  libraryPath?: string | null;
  /** F95 section label of the link, for picking the PC file on retry. */
  platformGroup?: string | null;
}

/**
 * Creates a `pending` row and returns it. Same source URL on the same thread
 * is deduped — if a row already exists with state in {pending, resolving,
 * downloading}, that row is returned instead of inserting a new one.
 */
export async function create(input: CreateInput): Promise<DownloadRow> {
  const existing = await query<DbRow>(
    `SELECT * FROM downloads
       WHERE thread_id = ? AND source_url = ?
         AND state IN ('pending','resolving','awaiting_choice','downloading')
       LIMIT 1`,
    [input.threadId, input.sourceUrl],
  );
  if (existing[0]) return rowToDownload(existing[0]);

  // tauri-plugin-sql uses a connection pool, so a follow-up
  // `SELECT last_insert_rowid()` lands on a different connection and returns 0
  // (or a stale value from another tx). Use the lastInsertId that `execute()`
  // already returns from the inserting connection.
  const res = await execute(
    `INSERT INTO downloads
       (thread_id, host, source_url, state, started_at, game_version, library_path, platform_group)
       VALUES (?, ?, ?, 'pending', datetime('now'), ?, ?, ?)`,
    [
      input.threadId,
      input.host,
      input.sourceUrl,
      input.gameVersion ?? null,
      input.libraryPath ?? null,
      input.platformGroup ?? null,
    ],
  );
  const id = res.lastInsertId;
  if (id == null || id <= 0) {
    throw new Error(`insert returned no lastInsertId (rowsAffected=${res.rowsAffected})`);
  }
  const created = await get(id);
  if (!created) throw new Error(`download row ${id} disappeared after insert`);
  return created;
}

export async function get(id: number): Promise<DownloadRow | null> {
  const rows = await query<DbRow>(`SELECT * FROM downloads WHERE id = ?`, [id]);
  return rows[0] ? rowToDownload(rows[0]) : null;
}

export async function list(): Promise<DownloadRow[]> {
  const rows = await query<DbRow>(
    `SELECT * FROM downloads ORDER BY id DESC`,
  );
  return rows.map(rowToDownload);
}

export async function listByThread(threadId: string): Promise<DownloadRow[]> {
  const rows = await query<DbRow>(
    `SELECT * FROM downloads WHERE thread_id = ? ORDER BY id DESC`,
    [threadId],
  );
  return rows.map(rowToDownload);
}

export async function remove(id: number): Promise<void> {
  const row = await get(id);
  if (row) {
    await closeVerifyWindow(row);
    await deleteRowFiles(row);
  }
  await execute(`DELETE FROM downloads WHERE id = ?`, [id]);
}

/** Remove finished/cancelled/failed/needs_browser rows from history. */
export async function clearFinished(): Promise<void> {
  const rows = await query<DbRow>(
    `SELECT * FROM downloads WHERE state IN ('completed','cancelled','failed','needs_browser')`,
  );
  for (const row of rows) {
    const download = rowToDownload(row);
    await closeVerifyWindow(download);
    await deleteRowFiles(download);
  }
  await execute(
    `DELETE FROM downloads WHERE state IN ('completed','cancelled','failed','needs_browser')`,
  );
}

/** A removed row must not leave its always-on-top verification window open. */
async function closeVerifyWindow(row: DownloadRow): Promise<void> {
  if (row.state === 'completed') return;
  try {
    await ipc.closeCaptchaWindow(row.id);
  } catch (err) {
    console.warn('[downloads] failed to close verification window', row.id, err);
  }
}

/** Delete the downloaded archive/file (and any `.part` sibling) for a row. */
async function deleteRowFiles(row: DownloadRow): Promise<void> {
  if (!row.destPath) return;

  const safeRoots = await libraries.allPaths();
  const paths = [row.destPath, `${row.destPath}.part`];

  for (const path of paths) {
    try {
      await ipc.deleteInstallDir({ path, safeRoots });
    } catch (err) {
      console.warn('[downloads] failed to delete file', path, err);
    }
  }
}

// ---- state transitions (called by useDownloads as it consumes events) ------

export async function markResolving(id: number): Promise<void> {
  // "resolving" is a weak transition: only apply it while the row is still in
  // an early state. The backend fires `download:resolving` immediately followed
  // by a terminal event (e.g. `download:needs-browser`). When resolution is
  // instantaneous — like a DataNodes link with no API key — the two events race,
  // and the Tauri SQL pool may run this UPDATE *after* the terminal one. Scoping
  // it to early states stops it from clobbering an already-advanced row and
  // leaving the download stuck on "RESOLVING".
  await execute(
    `UPDATE downloads
        SET state = 'resolving', error_message = NULL
        WHERE id = ? AND state IN ('pending', 'resolving')`,
    [id],
  );
}

export async function markResolved(
  id: number,
  args: { resolvedUrl: string; destPath: string; bytesTotal: number | null },
): Promise<void> {
  await execute(
    `UPDATE downloads
        SET state = 'downloading',
            resolved_url = ?,
            dest_path = ?,
            bytes_total = ?
        WHERE id = ?`,
    [args.resolvedUrl, args.destPath, args.bytesTotal, id],
  );
}

export async function markAwaitingChoice(id: number): Promise<void> {
  await execute(
    `UPDATE downloads
        SET state = 'awaiting_choice', error_message = NULL
        WHERE id = ?`,
    [id],
  );
}

export async function markNeedsBrowser(
  id: number,
  args: { host: string; url: string },
): Promise<void> {
  await execute(
    `UPDATE downloads
        SET state = 'needs_browser',
            host = COALESCE(NULLIF(?, ''), host),
            resolved_url = ?,
            dest_path = NULL,
            finished_at = datetime('now')
        WHERE id = ?`,
    [args.host, args.url, id],
  );
}

export async function markDone(
  id: number,
  args: { bytes: number; filePath: string },
): Promise<void> {
  await execute(
    `UPDATE downloads
        SET state = 'completed',
            bytes_done = ?,
            dest_path = ?,
            finished_at = datetime('now')
        WHERE id = ?`,
    [args.bytes, args.filePath, id],
  );
}

export async function markError(
  id: number,
  message: string,
  bytesDone?: number | null,
): Promise<void> {
  // Persist current bytes_done so a future "Tentar de novo" can resume from
  // the same .part offset without the progress bar resetting to 0 in the UI.
  if (bytesDone != null && bytesDone > 0) {
    await execute(
      `UPDATE downloads
          SET state = 'failed',
              error_message = ?,
              bytes_done = ?,
              finished_at = datetime('now')
          WHERE id = ?`,
      [message, bytesDone, id],
    );
  } else {
    await execute(
      `UPDATE downloads
          SET state = 'failed',
              error_message = ?,
              finished_at = datetime('now')
          WHERE id = ?`,
      [message, id],
    );
  }
}

export async function markCancelled(
  id: number,
  bytesDone?: number | null,
): Promise<void> {
  if (bytesDone != null && bytesDone > 0) {
    await execute(
      `UPDATE downloads
          SET state = 'cancelled',
              bytes_done = ?,
              finished_at = datetime('now')
          WHERE id = ?`,
      [bytesDone, id],
    );
  } else {
    await execute(
      `UPDATE downloads
          SET state = 'cancelled',
              finished_at = datetime('now')
          WHERE id = ?`,
      [id],
    );
  }
}

/**
 * Rows left in progress by an earlier run of the app (it was closed or
 * crashed mid-download) become `failed` with `message`, so they offer Retry
 * instead of a Cancel that does nothing. `activeIds` are the downloads the
 * backend is still working on; those are left alone.
 */
export async function failInterrupted(activeIds: number[], message: string): Promise<number> {
  const rows = await query<{ id: number }>(
    `SELECT id FROM downloads
       WHERE state IN ('pending','resolving','awaiting_choice','downloading')`,
  );
  const active = new Set(activeIds);
  const stale = rows.map((r) => r.id).filter((id) => !active.has(id));
  for (const id of stale) {
    await execute(
      `UPDATE downloads
          SET state = 'failed',
              error_message = ?,
              finished_at = datetime('now')
          WHERE id = ? AND state IN ('pending','resolving','awaiting_choice','downloading')`,
      [message, id],
    );
  }
  return stale.length;
}

/**
 * Flip a failed/cancelled row back to `pending` so the backend can resume.
 * Preserves `bytes_done` (the .part file on disk is the source of truth) so
 * the UI shows the right starting position until the first progress event.
 */
export async function markRetry(id: number): Promise<void> {
  await execute(
    `UPDATE downloads
        SET state = 'pending',
            error_message = NULL,
            finished_at = NULL
        WHERE id = ?`,
    [id],
  );
}
