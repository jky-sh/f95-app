import { execute, query } from './db';
import type { PlaySession } from '../types/session';

interface DbRow {
  id: number;
  thread_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
}

function rowToSession(r: DbRow): PlaySession {
  return {
    id: r.id,
    threadId: r.thread_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSeconds: r.duration_seconds,
  };
}

/** Insert a row representing a freshly-started session. */
export async function create(threadId: string): Promise<number> {
  const res = await execute(
    `INSERT INTO play_sessions (thread_id, started_at) VALUES (?, datetime('now'))`,
    [threadId],
  );
  const id = res.lastInsertId;
  if (id == null || id <= 0) {
    throw new Error('failed to create play_session row');
  }
  return id;
}

/** Mark a session as ended with its duration in seconds. */
export async function close(id: number, durationSeconds: number): Promise<void> {
  await execute(
    `UPDATE play_sessions
        SET ended_at = datetime('now'),
            duration_seconds = ?
        WHERE id = ?`,
    [durationSeconds, id],
  );
}

/**
 * Close any open sessions left dangling by a previous crash/quit. Treats them
 * as zero-duration so accumulated playtime stays honest. Run once at boot.
 */
export async function closeOrphans(): Promise<number> {
  const res = await execute(
    `UPDATE play_sessions
        SET ended_at = started_at, duration_seconds = 0
        WHERE ended_at IS NULL`,
  );
  return res.rowsAffected ?? 0;
}

/** Every session recorded for the game (`recent` only returns the last few). */
export async function count(threadId: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM play_sessions WHERE thread_id = ?`,
    [threadId],
  );
  return rows[0]?.n ?? 0;
}

export async function recent(threadId: string, limit = 20): Promise<PlaySession[]> {
  const rows = await query<DbRow>(
    `SELECT * FROM play_sessions WHERE thread_id = ? ORDER BY id DESC LIMIT ?`,
    [threadId, limit],
  );
  return rows.map(rowToSession);
}
