import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordingProcessJobs } from '../../test-fixtures/process-jobs.testkit.ts';
import type { PtyBinding, PtyProcess } from './pty-module.ts';
import { TerminalSessions } from './sessions.ts';

/** Stop means the TREE (spec §6): every process group under the shell, not just the shell's. */
const SHELL = 4242;
/** Windows has no process groups: the session's Job Object terminate is the stop, and `signalTree`
 *  still delegates to the binding's own kill as the fallback. Each POSIX group assertion below
 *  therefore has its Windows counterpart — "the binding was killed, no group signal was sent" —
 *  rather than a skip. */
const win = process.platform === 'win32';

class FakePty implements PtyProcess {
  readonly pid = SHELL;
  killed: Array<string | undefined> = [];
  onData() { return { dispose: () => {} }; }
  onExit() { return { dispose: () => {} }; }
  write() {}
  resize() {}
  kill(signal?: string) { this.killed.push(signal); }
}

type Row = { pid: number; ppid: number; pgid: number };

/** bash with a background job (own group), and a pipeline whose child forked a third group. */
const tree = (): Row[] => [
  { pid: 1, ppid: 0, pgid: 1 },
  { pid: process.pid, ppid: 1, pgid: process.pid },
  { pid: SHELL, ppid: process.pid, pgid: SHELL },
  { pid: 5000, ppid: SHELL, pgid: 5000 },
  { pid: 5001, ppid: 5000, pgid: 5000 },
  { pid: 6000, ppid: 5001, pgid: 6000 },
  { pid: 9000, ppid: 1, pgid: 9000 }, // somebody else's
];

describe('stopping a session signals every process group under its shell', () => {
  let signals: Array<[number, string | number | undefined]>;
  let ptys: FakePty[];

  const open = async (readTree: () => Row[] | null) => {
    const binding = async (): Promise<PtyBinding> => ({
      available: true,
      module: { spawn: () => { const pty = new FakePty(); ptys.push(pty); return pty; } },
    });
    // The third argument is the process-table reader — injected so no test reads the real one.
    const jobs = recordingProcessJobs();
    const sessions = new TerminalSessions(binding, undefined, readTree, jobs);
    const created = await sessions.create({ runId: 'run-1', cwd: '/tmp/wt' });
    if (!created.ok) throw new Error(created.reason);
    return { sessions, id: created.session.id, jobs };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    signals = [];
    ptys = [];
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      signals.push([pid, signal]);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const groups = (signal: string) => signals.filter(([, sent]) => sent === signal).map(([pid]) => pid).sort((a, b) => a - b);

  it('kill(): SIGHUP to every descendant group, then SIGKILL to the same groups after the grace', async () => {
    const { sessions, id } = await open(tree);
    sessions.kill(id);
    if (win) {
      // The job terminate is the stop; the binding's kill is the fallback, once now and once from
      // the deferred force timer.
      expect(signals).toEqual([]);
      expect(ptys[0]!.killed).toEqual([undefined]);
      vi.advanceTimersByTime(2_100);
      expect(ptys[0]!.killed).toEqual([undefined, undefined]);
      sessions.dispose();
      return;
    }
    expect(groups('SIGHUP')).toEqual([-6000, -5000, -SHELL]);
    expect(groups('SIGKILL')).toEqual([]);
    vi.advanceTimersByTime(2_100);
    expect(groups('SIGKILL')).toEqual([-6000, -5000, -SHELL]);
    sessions.dispose();
  });

  it('closeAll(): SIGKILL reaches the backgrounded groups too', async () => {
    const { sessions } = await open(tree);
    sessions.closeAll();
    if (win) {
      expect(signals).toEqual([]);
      expect(ptys[0]!.killed).toEqual([undefined]);
      sessions.dispose();
      return;
    }
    expect(groups('SIGKILL')).toEqual([-6000, -5000, -SHELL]);
    sessions.dispose();
  });

  it('never signals a group the shell does not own, nor onni’s own', async () => {
    const { sessions } = await open(tree);
    sessions.closeAll();
    const touched = signals.map(([pid]) => pid);
    expect(touched).not.toContain(-9000);
    expect(touched).not.toContain(-process.pid);
    expect(touched).not.toContain(-1);
    if (win) expect(signals).toEqual([]);
    sessions.dispose();
  });

  it('walks nothing when the pid is not onni’s own child (a recycled pid)', async () => {
    const recycled = tree().map((row) => (row.pid === SHELL ? { ...row, ppid: 1 } : row));
    const { sessions } = await open(() => recycled);
    sessions.closeAll();
    if (win) {
      // No tree is walked on Windows at all, but the session the binding owns is still stopped.
      expect(signals).toEqual([]);
      expect(ptys[0]!.killed).toEqual([undefined]);
      sessions.dispose();
      return;
    }
    expect(signals.map(([pid]) => pid)).toEqual([-SHELL]);
    sessions.dispose();
  });

  it('falls back to the shell’s own group when the process table cannot be read', async () => {
    const { sessions, id } = await open(() => null);
    sessions.kill(id);
    if (win) {
      expect(signals).toEqual([]);
      expect(ptys[0]!.killed).toEqual([undefined]);
      sessions.dispose();
      return;
    }
    expect(signals).toEqual([[-SHELL, 'SIGHUP']]);
    sessions.dispose();
  });

  it('a reader that throws never breaks a shutdown', async () => {
    const { sessions } = await open(() => { throw new Error('ps exploded'); });
    expect(() => sessions.closeAll()).not.toThrow();
    if (win) {
      expect(signals).toEqual([]);
      expect(ptys[0]!.killed).toEqual([undefined]);
      sessions.dispose();
      return;
    }
    expect(signals).toEqual([[-SHELL, 'SIGKILL']]);
    sessions.dispose();
  });
});

/**
 * C-06: on Windows the binding's own kill reaches the shell only — measured, a `detached: true`
 * grandchild survived both `kill()` and `closeAll()`. The session's Job Object is what reaches it,
 * so creation must assign the shell to one and every explicit stop must terminate that job.
 */
describe('every explicit stop terminates the session job (C-06)', () => {
  const open = async () => {
    const jobs = recordingProcessJobs();
    const binding = async (): Promise<PtyBinding> => ({ available: true, module: { spawn: () => new FakePty() } });
    const sessions = new TerminalSessions(binding, undefined, () => null, jobs);
    const first = await sessions.create({ runId: 'run-1', cwd: '/tmp/wt' });
    const second = await sessions.create({ runId: 'run-1', cwd: '/tmp/wt' });
    if (!first.ok || !second.ok) throw new Error('session refused');
    return { sessions, jobs, ids: [first.session.id, second.session.id] };
  };

  beforeEach(() => {
    // The POSIX path signals the shell's group; never a real pid from a fake binding. Real timers:
    // the assignment settles through microtasks the fake timers would hold back.
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Let the assignment promise and its `terminate` continuation run. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('creation assigns the shell pid to a job of its own', async () => {
    const { sessions, jobs, ids } = await open();
    // A pushed-once assignment per session: a job that never received its shell owns nothing.
    expect(jobs.assignments).toEqual(ids.map((id) => ({ key: `term-${id}`, pid: SHELL })));
    sessions.dispose();
  });

  it('kill() terminates that session job', async () => {
    const { sessions, jobs, ids } = await open();
    sessions.kill(ids[0]!);
    await settle();
    expect(jobs.terminated).toEqual([`term-${ids[0]}`]);
    sessions.dispose();
    await settle();
    expect(jobs.terminated).toEqual([`term-${ids[0]}`, `term-${ids[1]}`]);
  });

  it('closeAll() terminates every session job', async () => {
    const { sessions, jobs, ids } = await open();
    sessions.closeAll();
    await settle();
    expect([...jobs.terminated].sort()).toEqual(ids.map((id) => `term-${id}`).sort());
  });
});

describe('a forgotten session tells its listeners (spec §6 — the WS topic disposes itself)', () => {
  it('fires once more after the entry is gone, on an explicit kill', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const binding = async (): Promise<PtyBinding> => ({ available: true, module: { spawn: () => new FakePty() } });
    const sessions = new TerminalSessions(binding, undefined, () => null, recordingProcessJobs());
    const created = await sessions.create({ runId: 'run-1', cwd: '/tmp/wt' });
    if (!created.ok) throw new Error(created.reason);
    const seen: Array<boolean> = [];
    sessions.subscribe(created.session.id, () => seen.push(sessions.get(created.session.id) === null));
    sessions.kill(created.session.id);
    expect(seen).toEqual([true]);
    sessions.dispose();
    vi.restoreAllMocks();
  });
});
