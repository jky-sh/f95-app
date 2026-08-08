/**
 * Steam-style library collections ("folders").
 *
 * Backed by `library_collections` + `library_collection_games` (migration
 * v8). Membership is N:N — a game can live in any number of collections.
 * Every mutation fires COLLECTIONS_CHANGE_EVENT on `window` so live views
 * (Steam library sidebar, LibraryPage filter pills, picker modal) refresh
 * without prop plumbing.
 */
import { execute, query } from './db';

export const COLLECTIONS_CHANGE_EVENT = 'f95:collections-changed';

/** Asks the globally-mounted picker modal (AppShell) to open for a game. */
export const MANAGE_COLLECTIONS_EVENT = 'f95:manage-collections';

export interface LibraryCollection {
  id: number;
  name: string;
  position: number;
}

export interface CollectionMembership {
  collectionId: number;
  threadId: string;
}

export interface ManageCollectionsDetail {
  threadId: string;
  title: string;
}

function emitChanged(): void {
  window.dispatchEvent(new CustomEvent(COLLECTIONS_CHANGE_EVENT));
}

export function openManageCollections(detail: ManageCollectionsDetail): void {
  window.dispatchEvent(new CustomEvent(MANAGE_COLLECTIONS_EVENT, { detail }));
}

interface CollectionRow {
  id: number;
  name: string;
  position: number;
}

interface MembershipRow {
  collection_id: number;
  thread_id: string;
}

export async function listCollections(): Promise<LibraryCollection[]> {
  const rows = await query<CollectionRow>(
    `SELECT id, name, position FROM library_collections ORDER BY position, name COLLATE NOCASE`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, position: r.position }));
}

/** All (collection, game) pairs in one query — group client-side. */
export async function listMemberships(): Promise<CollectionMembership[]> {
  const rows = await query<MembershipRow>(
    `SELECT collection_id, thread_id FROM library_collection_games`,
  );
  return rows.map((r) => ({ collectionId: r.collection_id, threadId: r.thread_id }));
}

export async function collectionIdsForGame(threadId: string): Promise<number[]> {
  const rows = await query<{ collection_id: number }>(
    `SELECT collection_id FROM library_collection_games WHERE thread_id = ?`,
    [threadId],
  );
  return rows.map((r) => r.collection_id);
}

export async function createCollection(name: string): Promise<number | undefined> {
  const res = await execute(
    `INSERT INTO library_collections (name, position)
       VALUES (?, (SELECT IFNULL(MAX(position), 0) + 1 FROM library_collections))`,
    [name.trim()],
  );
  emitChanged();
  return res.lastInsertId;
}

export async function renameCollection(id: number, name: string): Promise<void> {
  await execute(`UPDATE library_collections SET name = ? WHERE id = ?`, [name.trim(), id]);
  emitChanged();
}

/**
 * Deletes a collection. Junction rows are removed explicitly because the
 * SQLite plugin doesn't enable foreign-key enforcement, so ON DELETE
 * CASCADE wouldn't fire. Games themselves are untouched.
 */
export async function deleteCollection(id: number): Promise<void> {
  await execute(`DELETE FROM library_collection_games WHERE collection_id = ?`, [id]);
  await execute(`DELETE FROM library_collections WHERE id = ?`, [id]);
  emitChanged();
}

export async function addGameToCollection(
  collectionId: number,
  threadId: string,
): Promise<void> {
  await execute(
    `INSERT OR IGNORE INTO library_collection_games (collection_id, thread_id) VALUES (?, ?)`,
    [collectionId, threadId],
  );
  emitChanged();
}

export async function removeGameFromCollection(
  collectionId: number,
  threadId: string,
): Promise<void> {
  await execute(
    `DELETE FROM library_collection_games WHERE collection_id = ? AND thread_id = ?`,
    [collectionId, threadId],
  );
  emitChanged();
}
