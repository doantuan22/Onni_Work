import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';

/**
 * Remove a test's temporary directory once nothing holds it any more.
 *
 * Why not `rmSync(dir, { recursive: true, force: true })`: a run leaves short-lived children
 * behind it for a few hundred milliseconds after the manager says it is done — the
 * `git diff --shortstat` of turn-end bookkeeping, an agent process that was just told to stop —
 * and their working directory is inside the temp repository. POSIX unlinks a directory that is
 * some process's cwd; Windows refuses (`EBUSY`/`EPERM`) until that process has exited.
 *
 * Why the promise API rather than `rmSync(..., { maxRetries })`: `rmSync` does retry EPERM, but
 * its loop blocks the event loop and its budget is short. Measured on Node 24.21 against a child
 * holding the directory as its cwd: no retries fails in ~100 ms; `maxRetries: 5, retryDelay: 100`
 * succeeds for a 400 ms holder but still fails against a 2000 ms one (after ~2.1 s); the promise
 * call with `maxRetries: 10, retryDelay: 100` succeeds against the same 2000 ms holder. Blocking
 * also means a handle held by THIS process — an unsettled stream, a closing server — can never
 * close while the retries run, so the synchronous loop can exhaust its budget waiting on itself.
 *
 * The promise wait is bounded and linear (`retryDelay * attempt`): about 5.5 s in total at the
 * values below, and a directory that is free — every POSIX run, and most Windows ones — is removed
 * on the first attempt with no delay at all. A holder that outlives the bound is a real leak and
 * still fails the test, which is the point: this absorbs a process that is on its way out, it
 * does not hide one that never leaves. (Two such leaks were found this way and fixed at the
 * source instead: a namer launched by a disposed manager, and tests that started the developer's
 * real agent CLI — see `no-real-namer.testkit.ts`.) A test that leaves live sessions behind
 * must end them first: {@link stopRuns}.
 */
export async function removeTempDir(...dirs: Array<string | undefined>): Promise<void> {
  for (const dir of dirs) {
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/**
 * Kill a session's process tree the way the OS does when its owner dies.
 *
 * A case that simulates a restart disposes the old manager with a live session on purpose
 * (`dispose()` ends no session), then lets a new manager adopt the persisted record. In a real
 * restart the old backend is gone; in-process it is an orphan whose cwd is the fixture root, so
 * the teardown cannot delete it. Capture `session.pid` before disposing and pass it here.
 */
export function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone: the fixture root is free either way.
  }
}

/** The slice of `RunManager` / `RunStore` that {@link stopRuns} needs — structural, so this
 *  file imports nothing from the engine it helps to test. */
interface StoppableManager {
  cancel(runId: string): boolean;
  isActive(runId: string): boolean;
  dispose(): void;
}
interface ListableStore {
  listRuns(): Array<{ id: string }>;
}

/**
 * End every run a manager still owns, wait for the cancellations to settle, then dispose it —
 * the teardown a suite needs before {@link removeTempDir} when its runs can outlive their test
 * (a session parked at `waiting` is a live agent process whose cwd is the temp repository).
 *
 * Disposing alone is not enough: `dispose()` deliberately ends no session. Never throws — a run
 * that refuses to stop shows up as the directory that cannot be removed afterwards, which names
 * the leak better than a second error would.
 */
export async function stopRuns(manager: StoppableManager, store: ListableStore, timeoutMs = 8_000): Promise<void> {
  try {
    const ids = store.listRuns().map(({ id }) => id);
    for (const id of ids) manager.cancel(id);
    const deadline = Date.now() + timeoutMs;
    while (ids.some((id) => manager.isActive(id)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    manager.dispose();
  }
}
