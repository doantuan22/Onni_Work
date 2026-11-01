import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BASH_MISSING_MESSAGE, resolveBash, withBashPath } from './bash-path.ts';

let root: string;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

function touch(path: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
  return path;
}

describe('resolveBash', () => {
  it('uses bash from PATH on posix hosts', () => {
    expect(resolveBash({ platform: 'linux', env: {} })).toEqual({ path: 'bash', pathDirs: [] });
  });

  it('prefers a bash already on PATH on Windows', () => {
    root = mkdtempSync(join(tmpdir(), 'onni-bash-'));
    const bash = touch(join(root, 'custom', 'bash.exe'));
    expect(resolveBash({ platform: 'win32', env: { PATH: join(root, 'custom') } })).toEqual({
      path: bash,
      pathDirs: [join(root, 'custom')],
    });
  });

  it('derives Git for Windows bash from git.exe on PATH (Git\\cmd → Git\\bin)', () => {
    root = mkdtempSync(join(tmpdir(), 'onni-bash-'));
    const git = touch(join(root, 'Git', 'cmd', 'git.exe'));
    const bash = touch(join(root, 'Git', 'bin', 'bash.exe'));
    touch(join(root, 'Git', 'usr', 'bin', 'bash.exe'));
    const resolved = resolveBash({ platform: 'win32', env: { PATH: dirnameOf(git) } });
    expect(resolved?.path).toBe(bash);
    expect(resolved?.pathDirs).toEqual([join(root, 'Git', 'bin'), join(root, 'Git', 'usr', 'bin')]);
  });

  it('derives bash from the ucrt64 git layout (Git\\ucrt64\\bin → Git\\bin)', () => {
    root = mkdtempSync(join(tmpdir(), 'onni-bash-'));
    const git = touch(join(root, 'Git', 'ucrt64', 'bin', 'git.exe'));
    const bash = touch(join(root, 'Git', 'bin', 'bash.exe'));
    expect(resolveBash({ platform: 'win32', env: { PATH: dirnameOf(git) } })?.path).toBe(bash);
  });

  it('falls back to the standard install roots when git itself is off PATH', () => {
    root = mkdtempSync(join(tmpdir(), 'onni-bash-'));
    const bash = touch(join(root, 'Git', 'usr', 'bin', 'bash.exe'));
    const resolved = resolveBash({ platform: 'win32', env: { PATH: '', ProgramFiles: root } });
    expect(resolved?.path).toBe(bash);
    expect(resolved?.pathDirs).toEqual([join(root, 'Git', 'usr', 'bin')]);
  });

  it('answers null when a Windows host has no Git for Windows, and names the requirement', () => {
    expect(resolveBash({ platform: 'win32', env: { PATH: '' } })).toBeNull();
    expect(BASH_MISSING_MESSAGE).toContain('Git for Windows');
  });
});

describe('withBashPath', () => {
  it('prepends the shell directories to the child PATH', () => {
    const env = withBashPath({ PATH: 'C:\\Windows' }, { path: 'C:\\Git\\bin\\bash.exe', pathDirs: ['C:\\Git\\bin', 'C:\\Git\\usr\\bin'] });
    expect(env.PATH).toBe('C:\\Git\\bin;C:\\Git\\usr\\bin;C:\\Windows');
  });

  it('leaves a posix env alone', () => {
    const env = { PATH: '/usr/bin' };
    expect(withBashPath(env, { path: 'bash', pathDirs: [] })).toBe(env);
  });
});

function dirnameOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')));
}
