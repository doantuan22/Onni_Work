import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeLifecycleCommand, probeLifecycleProcess, type LifecycleExecutorOutput } from './executor.ts';
import { fakeProgram } from '../test-fixtures/fake-program.testkit.ts';

let cwd: string;
beforeEach(async () => { cwd = await mkdtemp(join(tmpdir(), 'lifecycle-executor-')); vi.stubEnv('ONNI_DRY_RUN', '0'); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(cwd, { recursive: true, force: true }); });
describe('supervised lifecycle executor', () => {
  it('runs in the given cwd, closes stdin, and emits stdout/stderr', async () => {
    const frames: LifecycleExecutorOutput[] = [];
    // `touch here` proves the cwd portably: `pwd` prints Git Bash's /tmp form on Windows.
    const result = await executeLifecycleCommand({ command: 'touch here; pwd; echo err >&2; read ignored || echo closed', cwd, onOutput: frame => { frames.push(frame); } });
    expect(result).toMatchObject({ state: 'succeeded', exitCode: 0, quiescent: true });
    await expect(readFile(join(cwd, 'here'))).resolves.toBeDefined();
    expect(frames.map(frame => frame.text).join('')).toContain(basename(cwd));
    expect(frames).toContainEqual({ stream: 'stderr', text: 'err\n' });
    expect(frames.map(frame => frame.text).join('')).toContain('closed');
    // Windows never re-signals a persisted PID, so it reports `unknown` by design.
    expect(await probeLifecycleProcess(result.identity!)).toBe(process.platform === 'win32' ? 'unknown' : 'quiescent');
  });
  it('does not execute the command until its start identity is durably saved', async () => {
    const result = await executeLifecycleCommand({ command: 'echo unsafe > marker', cwd, onStart: async () => { throw new Error('read-only state'); } });
    expect(result).toMatchObject({ state: 'failed', quiescent: true });
    await expect(readFile(join(cwd, 'marker'))).rejects.toThrow();
  });
  it('records nonzero exit and missing Bash without throwing', async () => {
    expect(await executeLifecycleCommand({ command: 'exit 7', cwd })).toMatchObject({ state: 'failed', exitCode: 7 });
    expect(await executeLifecycleCommand({ command: 'true', cwd, bashPath: '/missing/onni-bash' })).toMatchObject({ state: 'failed', quiescent: true });
  });
  it('times out silent children and confirms process-group quiescence', async () => {
    const result = await executeLifecycleCommand({ command: 'sleep 30 & wait', cwd, timeoutSeconds: 1 });
    expect(result).toMatchObject({ state: 'interrupted' });
    expect(result.reason).toContain('timeout');
    // Process-group signalling is POSIX-only; the taskkill fixture below covers the
    // Windows supervision path, which cannot confirm an escaped Git Bash child (C-05).
    if (process.platform !== 'win32') expect(result.quiescent).toBe(true);
  });
  it('stops on abort and dry-run never launches commands', async () => {
    const controller = new AbortController();
    const running = executeLifecycleCommand({ command: 'sleep 30', cwd, signal: controller.signal, onStart: async () => { setTimeout(() => controller.abort(), 100); } });
    const result = await running;
    expect(result).toMatchObject({ state: 'interrupted' });
    if (process.platform !== 'win32') expect(result.quiescent).toBe(true);
    expect(await executeLifecycleCommand({ command: 'touch marker', cwd, dryRun: true })).toMatchObject({ state: 'succeeded' });
    await expect(readFile(join(cwd, 'marker'))).rejects.toThrow();
  });
  it('redacts known secrets and token patterns split across pipe frames', async () => {
    const secret = 'a-very-private-secret-value'; vi.stubEnv('LIFECYCLE_TEST_TOKEN', secret);
    const frames: LifecycleExecutorOutput[] = [];
    const result = await executeLifecycleCommand({ command: "printf a-very-private-; sleep 0.15; printf 'secret-value\\n'; printf ghp_abcdefghijk; sleep 0.15; printf 'lmnopqrstuvwxyz\\n'", cwd, onOutput: frame => { frames.push(frame); } });
    expect(result.state).toBe('succeeded');
    const output = frames.map(frame => frame.text).join('');
    expect(output).not.toContain(secret); expect(output).not.toContain('ghp_');
    expect(output).toContain('[REDACTED]');
  });
  it('reports output persistence failure after exit without leaving a timer', async () => {
    const result = await executeLifecycleCommand({ command: 'echo output', cwd, onOutput: async () => { throw new Error('disk full'); } });
    expect(result).toMatchObject({ state: 'failed', quiescent: true, reason: 'Could not persist lifecycle output' });
  });
  it('bounds output while draining chatty processes and overlong lines', async () => {
    const frames: LifecycleExecutorOutput[] = [];
    const result = await executeLifecycleCommand({ command: "head -c 1800000 /dev/zero | tr '\\0' x; echo; yes short | head -n 200000", cwd, onOutput: frame => { frames.push(frame); } });
    expect(result).toMatchObject({ state: 'succeeded', truncated: true, quiescent: true });
    expect(frames.every(frame => Buffer.byteLength(frame.text) <= 16384)).toBe(true);
    expect(frames.reduce((sum, frame) => sum + Buffer.byteLength(frame.text), 0)).toBeLessThanOrEqual(1048700);
  });
});


describe('Windows supervision with a taskkill fixture', () => {
  async function taskkillFixture(fail = false): Promise<void> {
    const record = join(cwd, 'taskkill-args');
    // A real executable on both platforms: on Windows the fake must be started without a
    // shell, so it terminates the native tree through the system taskkill, not by name
    // (the fake is first on PATH).
    fakeProgram('taskkill', {
      dir: cwd,
      body: `require('node:fs').writeFileSync(${JSON.stringify(record)}, args.join('\\n') + '\\n');
${fail ? 'process.exit(1);' : `if (process.platform === 'win32') {
  const path = require('node:path');
  require('node:child_process').execFileSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe'), ['/PID', args[1], '/T', '/F'], { stdio: 'ignore' });
} else {
  process.kill(-Number(args[1]), 'SIGKILL');
}`}`,
    }).use();
  }
  it('terminates the captured live supervisor tree and preserves the command exit code', async () => {
    await taskkillFixture();
    const frames: LifecycleExecutorOutput[] = [];
    const result = await executeLifecycleCommand({command: 'echo command; exit 7', cwd, platform: 'win32', onOutput: frame => { frames.push(frame); }});
    expect(result).toMatchObject({state: 'failed', exitCode: 7, quiescent: true});
    expect((await readFile(join(cwd, 'taskkill-args'), 'utf8')).trim().split('\n')).toEqual(['/PID', String(result.identity!.pid), '/T', '/F']);
    expect(frames.map(frame => frame.text).join('')).toContain('command');
    expect(frames.map(frame => frame.text).join('')).not.toContain('__onni_');
  });
  it('returns uncertain quiescence when native taskkill fails', async () => {
    await taskkillFixture(true);
    const result = await executeLifecycleCommand({command: 'true', cwd, platform: 'win32'});
    expect(result).toMatchObject({state: 'failed', quiescent: false});
    expect(result.reason).toContain('directory retained');
  });
  it('uses tree termination on stop while the Bash command is running', async () => {
    await taskkillFixture();
    const controller = new AbortController();
    const result = await executeLifecycleCommand({command: 'sleep 30', cwd, platform: 'win32', signal: controller.signal, onStart: async () => { setTimeout(() => controller.abort(), 100); }});
    expect(result).toMatchObject({state: 'interrupted'});
    // C-05: on Windows `taskkill /T` can miss Git Bash's re-exec'd children; the escapee
    // keeps the stdio pipes open, so the executor (correctly) refuses to claim quiescence.
    if (process.platform !== 'win32') expect(result).toMatchObject({quiescent: true});
  });
});
