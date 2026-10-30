import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertOnniHomeWriteIsSandboxed, workspaceConfigPath } from '../paths.ts';
import { atomicWriteJsonSync, loadWorkspaceConfig, mergeWriteWorkspaceConfig } from './config.ts';

/**
 * The registry-clobber regression. A onni test run used to be able to replace
 * the developer's real `~/.onni/config.json` with a fixture's projects: the
 * `ONNI_HOME` pin lives in `process.env`, a timing-out test drops it in
 * `afterEach` while a merge-write is still in flight, and the write then
 * resolved a different home than the read. These cases lock in the two
 * defences — one resolved path per merge-write, and a hard refusal to write
 * into the real onni home from a test process.
 */
describe('onni home write safety', () => {
  const originalCezHome = process.env.ONNI_HOME;
  const originalHome = process.env.HOME;
  let pinned: string;
  let elsewhere: string;
  let fakeUserHome: string;

  beforeEach(() => {
    const base = realpathSync(tmpdir());
    pinned = mkdtempSync(join(base, 'onni-home-safety-pinned-'));
    elsewhere = mkdtempSync(join(base, 'onni-home-safety-elsewhere-'));
    fakeUserHome = mkdtempSync(join(base, 'onni-home-safety-user-'));
    process.env.ONNI_HOME = pinned;
  });

  afterEach(() => {
    if (originalCezHome === undefined) delete process.env.ONNI_HOME;
    else process.env.ONNI_HOME = originalCezHome;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    for (const dir of [pinned, elsewhere, fakeUserHome]) rmSync(dir, { recursive: true, force: true });
  });

  it('keeps a merge-write inside one file when ONNI_HOME moves mid-flight', async () => {
    await mergeWriteWorkspaceConfig((config) => {
      // Exactly what a test's afterEach does to an orphaned write: the pin is
      // gone by the time the write runs. The write must still land where the
      // read came from.
      process.env.ONNI_HOME = elsewhere;
      config.projects.push({
        id: 'shop',
        root: '/tmp/shop',
        name: 'shop',
        addedAt: '',
        lastOpenedAt: '',
        source: 'local',
      });
    });

    const written: unknown = JSON.parse(readFileSync(join(pinned, 'config.json'), 'utf8'));
    expect(written).toMatchObject({ projects: [{ id: 'shop' }] });
    expect(existsSync(join(elsewhere, 'config.json'))).toBe(false);
  });

  it('reads back what the mid-flight write stored, from the same file', async () => {
    await mergeWriteWorkspaceConfig((config) => {
      config.projects.push({
        id: 'shop',
        root: '/tmp/shop',
        name: 'shop',
        addedAt: '',
        lastOpenedAt: '',
        source: 'local',
      });
    });
    process.env.ONNI_HOME = pinned;
    expect((await loadWorkspaceConfig()).projects.map((p) => p.id)).toEqual(['shop']);
  });

  it('refuses a write into the real onni home while running under vitest', () => {
    process.env.HOME = fakeUserHome;
    delete process.env.ONNI_HOME;
    const target = workspaceConfigPath();

    expect(target).toBe(join(fakeUserHome, '.onni', 'config.json'));
    expect(() => atomicWriteJsonSync(target, { projects: [] })).toThrow(/ONNI_HOME is not pinned/);
    expect(existsSync(join(fakeUserHome, '.onni'))).toBe(false);
  });

  it('leaves an existing real-home registry byte-for-byte intact when a leaked write is refused', () => {
    process.env.HOME = fakeUserHome;
    delete process.env.ONNI_HOME;
    const target = workspaceConfigPath();
    const existing = '{"projects":[{"id":"real","root":"/repos/real"}]}\n';
    mkdirSync(join(fakeUserHome, '.onni'), { recursive: true });
    writeFileSync(target, existing);

    expect(() => atomicWriteJsonSync(target, { projects: [] })).toThrow(/refusing to write/);
    expect(readFileSync(target, 'utf8')).toBe(existing);
  });

  it('survives a real, timing-out suite run: the home registry is never created', () => {
    // The reproduction from the bug report, run for real: part of the workspace
    // CLI suite with a timeout short enough that every case is killed mid-write,
    // pointed at a throwaway HOME and started with no ONNI_HOME at all — the way
    // `npm test` runs on a developer's machine. Run against the code as it was
    // before this change, that command wrote `<home>/.onni/config.json` holding
    // the fixture's projects on 5 runs out of 5; the `remove` cases are the
    // cheapest set that does it (~1s, against ~40s for the whole file).
    //
    // The nested run picks up this package's own vitest config, so it exercises
    // all three defences together (one path per merge-write, the sandbox pin,
    // the write guard) — which is the claim that matters here: `npm test` does
    // not touch the user's registry. The per-layer cases above are what fail if
    // any single defence is removed.
    const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
    const vitestBin = join(packageRoot, '..', '..', 'node_modules', '.bin', 'vitest');
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: fakeUserHome };
    delete env.ONNI_HOME;
    delete env.VITEST;

    const run = spawnSync(
      vitestBin,
      ['run', 'src/workspace/projects-cli.test.ts', '--testTimeout=15', '-t', 'remove'],
      { cwd: packageRoot, env, encoding: 'utf8' },
    );

    // The nested suite is EXPECTED to fail — 15ms cannot finish a `git init`.
    // What matters is what it left behind outside its sandbox.
    expect(run.error).toBeUndefined();
    expect(existsSync(join(fakeUserHome, '.onni'))).toBe(false);
  }, 180_000);

  it('allows writes outside the real onni home, and is inert outside vitest', () => {
    process.env.HOME = fakeUserHome;
    const sandboxed = join(pinned, 'config.json');

    expect(() => assertOnniHomeWriteIsSandboxed(sandboxed)).not.toThrow();
    expect(() =>
      assertOnniHomeWriteIsSandboxed(join(homedir(), '.onni', 'config.json'), { VITEST: undefined }),
    ).not.toThrow();
  });
});
