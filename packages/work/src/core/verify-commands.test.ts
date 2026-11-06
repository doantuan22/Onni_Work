import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverVerifyCommands } from './verify-commands.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('discoverVerifyCommands', () => {
  it('turns the repo verification scripts into exact lines, in stable order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onni-verify-'));
    roots.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', build: 'tsc', dev: 'vite', lint: 'eslint .' } }));
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\n');

    expect(discoverVerifyCommands(dir)).toEqual([
      'npm test', 'npm run build', 'npm run lint', 'cargo check', 'cargo test',
    ]);
  });

  it('returns no commands without a cwd or a manifest', () => {
    expect(discoverVerifyCommands(undefined)).toEqual([]);
    expect(discoverVerifyCommands(join(tmpdir(), 'onni-verify-no-such-dir'))).toEqual([]);
  });

  it('ignores an unreadable package manifest and still discovers cargo checks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onni-verify-'));
    roots.push(dir);
    writeFileSync(join(dir, 'package.json'), '{ not valid JSON');
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\n');

    expect(discoverVerifyCommands(dir)).toEqual(['cargo check', 'cargo test']);
  });
});
