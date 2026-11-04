import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveBash } from '../core/bash-path.ts';
import { runShellCheck } from './landing.ts';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'onni-check-timeout-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

/**
 * A landing check that hangs (a test waiting on input, a dev server) must be ended by the timeout.
 * It used to only `kill` the bash leader: the child kept the stdout pipe open, `close` never fired,
 * and the "10 minute" bound held a landing for as long as the child lived.
 */
describe('runShellCheck timeout', () => {
  it('settles at the timeout and kills the command the check started', async () => {
    if (!resolveBash()) return; // a host with no bash cannot run a check at all
    const pidFile = join(dir, 'pid').split(sep).join('/');
    const command = `node -e "require('fs').writeFileSync('${pidFile}', String(process.pid)); setTimeout(() => {}, 60000)"; echo unreachable`;
    const started = Date.now();
    const result = await runShellCheck(command, dir, undefined, 1_500);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('timed out');

    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    for (let i = 0; i < 40 && alive(pid); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(pid)).toBe(false);
  }, 30_000);

  // Decoding each pipe chunk on its own turns a character split across two chunks into two U+FFFD.
  it.each(['ệ', '😀'])('keeps %s intact when the output spans many pipe chunks', async (char) => {
    if (!resolveBash()) return;
    const result = await runShellCheck(`node -e "process.stdout.write('${char}'.repeat(60000))"`, dir);
    expect(result.ok).toBe(true);
    expect(result.output).not.toContain('�');
    expect(new Set(result.output)).toEqual(new Set([...char]));
  }, 30_000);

  it('still reports a check that finishes in time', async () => {
    if (!resolveBash()) return;
    expect(await runShellCheck('echo fine', dir)).toMatchObject({ ok: true, output: 'fine' });
    expect(await runShellCheck('echo broken >&2; exit 3', dir)).toMatchObject({ ok: false, output: 'broken' });
  });
});
