import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { fakeProgram } from './fake-program.testkit.ts';
import { removeTempDir } from './remove-temp-dir.testkit.ts';

let dir: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await removeTempDir(dir);
  dir = undefined;
});

/** The Windows path is deliberately not a shell script; this pins that `execFile` reaches
 *  the fake on both platforms instead of the real program (or ENOENT/EINVAL). */
it('puts a fake on PATH that execFile really starts, argv intact', () => {
  dir = mkdtempSync(join(tmpdir(), 'fake-program-'));
  const record = join(dir, 'argv');
  fakeProgram('gh', {
    dir,
    body: `require('node:fs').writeFileSync(${JSON.stringify(record)}, args.join('\\n'));`,
  }).use();

  const stdout = execFileSync('gh', ['pr', 'create', '--draft'], { encoding: 'utf8' });

  expect(stdout).toBe('');
  expect(readFileSync(record, 'utf8')).toBe('pr\ncreate\n--draft');
});

it('preserves the exit code and stderr the body produces', () => {
  dir = mkdtempSync(join(tmpdir(), 'fake-program-'));
  fakeProgram('gh', {
    dir,
    body: `process.stderr.write('GraphQL: refused\\n');\nprocess.exit(3);`,
  }).use();

  const result = spawnSync('gh', ['pr', 'list'], { encoding: 'utf8' });

  expect(result.status).toBe(3);
  expect(result.stderr.trim()).toBe('GraphQL: refused');
});

it('clears GitHub credentials and config for the duration of the test', () => {
  dir = mkdtempSync(join(tmpdir(), 'fake-program-'));
  vi.stubEnv('GH_TOKEN', 'real-token');
  vi.stubEnv('GITHUB_TOKEN', 'real-token');

  fakeProgram('gh', { dir, body: '' }).use();

  expect(process.env.GH_TOKEN).toBe('');
  expect(process.env.GITHUB_TOKEN).toBe('');
  expect(process.env.GH_CONFIG_DIR).toBe(join(dir, 'gh-config'));
});
