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
