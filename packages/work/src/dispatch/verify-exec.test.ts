import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveBash } from '../core/bash-path.ts';
import { buildVerifyEnv } from './verify.ts';
import { runVerifyCommand } from './verify-exec.ts';

/** Spawns real bash; each test guards itself with a capability check instead of being skipped. */
describe('runVerifyCommand', () => {
  const bash = resolveBash();
  let cwd: string;
  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'onni-verify-exec-'));
  });
  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
  const exec = (command: string, extra: Partial<Parameters<typeof runVerifyCommand>[0]> = {}) =>
    runVerifyCommand({
      bashPath: bash!.path, pathDirs: bash!.pathDirs, command, cwd, env: buildVerifyEnv(process.env), timeoutMs: 20_000, ...extra,
    });

  it('reports exit codes and output', async () => {
    if (!bash) return;
    expect(await exec('echo hi')).toMatchObject({ exitCode: 0, timedOut: false, output: expect.stringContaining('hi') });
    expect(await exec('exit 7')).toMatchObject({ exitCode: 7 });
  }, 30_000);

  it('kills at the deadline, even when a grandchild holds the pipe', async () => {
    if (!bash) return;
    const t0 = Date.now();
    const direct = await exec('sleep 30', { timeoutMs: 300 });
    expect(direct).toMatchObject({ timedOut: true, exitCode: null });
    const held = await exec('(sleep 30 &) ; sleep 30', { timeoutMs: 300 });
    expect(held.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 30_000);

  it('bounds captured output', async () => {
    if (!bash) return;
    const result = await exec('yes | head -c 2000000', { captureBytes: 10_000 });
    expect(result.output.length).toBeLessThanOrEqual(10_000);
  }, 30_000);

  it('aborts promptly on a signal', async () => {
    if (!bash) return;
    const controller = new AbortController();
    const pending = exec('sleep 30', { signal: controller.signal });
    setTimeout(() => controller.abort(), 200);
    expect(await pending).toMatchObject({ aborted: true, exitCode: null });
  }, 30_000);

  it('closes stdin and hides ONNI_* from the child', async () => {
    if (!bash) return;
    process.env.ONNI_VERIFY_TEST_SECRET = 'leak';
    try {
      const result = await exec('read x; echo "ci=$CI secret=${ONNI_VERIFY_TEST_SECRET:-none}"');
      expect(result.output).toContain('ci=1 secret=none');
    } finally {
      delete process.env.ONNI_VERIFY_TEST_SECRET;
    }
  }, 30_000);
});
