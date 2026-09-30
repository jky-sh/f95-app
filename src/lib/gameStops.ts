import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

/** Sent when a window other than the main one (the overlay) stops a game. */
const USER_STOP_EVENT = 'game:user-stop';

/**
 * Games the user asked to stop from this window. Stopping kills the process
 * with a non-zero exit code, which would otherwise look like a crash.
 */
const stopped = new Set<string>();

export function noteUserStop(threadId: string): void {
  stopped.add(threadId);
}

/** True (once) when the last exit of this game was a stop the user asked for. */
export function consumeUserStop(threadId: string): boolean {
  return stopped.delete(threadId);
}

/** From another window: tell the main window this exit is not a crash. */
export async function announceUserStop(threadId: string): Promise<void> {
  noteUserStop(threadId);
  await emit(USER_STOP_EVENT, { threadId }).catch(() => {});
}

/** Main window: remember stops announced by the overlay. */
export function listenForUserStops(): Promise<UnlistenFn> {
  return listen<{ threadId: string }>(USER_STOP_EVENT, (e) => noteUserStop(e.payload.threadId));
}
