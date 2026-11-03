/**
 * The small durable-state primitive shared by project memory (`#9`) and the tree plan (`#6A`)
 * (plan v2 §5 H2). Both are read-modify-write files under `.ai/onni/`, so both need the same
 * three things: an atomic replace, a content revision to detect a concurrent writer, and one
 * in-process queue per path. Reusing the workspace config's rename policy keeps Windows' transient
 * sharing violations from turning a save into a lost update.
 */
import { createHash } from 'node:crypto';
import { open, mkdir, readFile, rm } from 'node:fs/promises';
import { chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { renameWithRetry } from '../fs-rename.ts';
import { atomicTmpPath, serializedByPath } from '../workspace/config.ts';

/** UTF-8 content hash, first eight hex characters. An absent file is revision `"0"`. */
export function revisionOf(content: string | undefined): string {
  if (content === undefined) return '0';
  return createHash('sha1').update(content, 'utf8').digest('hex').slice(0, 8);
}

export interface StateFileRead {
  /** Absent when the file is missing or unreadable — never an exception. */
  content?: string;
  revision: string;
}

/** Read a state file. A missing, unreadable or empty file degrades to "nothing there" (§1.7). */
export async function readStateFile(path: string): Promise<StateFileRead> {
  try {
    const content = await readFile(path, 'utf8');
    return { content, revision: revisionOf(content) };
  } catch {
    return { revision: '0' };
  }
}

/**
 * Replace a text file atomically: per-writer tmp, fsync, rename with the Windows retry policy.
 * POSIX gets mode `0600`; on Windows the mode is advisory and `rename` is what protects readers.
 */
export async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = atomicTmpPath(path);
  try {
    const handle = await open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(content, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  try {
    chmodSync(path, 0o600); // best-effort outside POSIX
  } catch {
    // a filesystem without modes is not a failed write
  }
}

/** Serialize every read-modify-write of one path inside this process. */
export function withPathLock<T>(path: string, task: () => Promise<T>): Promise<T> {
  return serializedByPath(path, task);
}
