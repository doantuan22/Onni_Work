import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentEntry, activate, activeId, assertSafeId, detectInstallKind, listLinks, runsFromCheckout, versionDir, versionEntry, versionsDir, writeManifest } from './layout.ts';
import { devVersion } from './semver.ts';

describe('semver', () => {
  it('shows a checkout build as -dev of its release', () => {
    expect(devVersion('0.15.2')).toBe('0.15.2-dev');
    expect(devVersion('0.15.2-nightly.20261019.4')).toBe('0.15.2-dev');
    expect(devVersion('0.15.2+cez-abc12345')).toBe('0.15.2-dev');
  });
});

describe('managed layout', () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'cez-self-update-'));
    env = { ...process.env, CEZ_HOME: home };
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const fakeLink = (id: string, version: string, checkout = join(home, 'repo', 'packages', 'cezar')) => {
    const entry = versionEntry(id, env);
    mkdirSync(join(entry, '..'), { recursive: true });
    writeFileSync(entry, '// entry\n');
    writeManifest(id, { version, source: 'link', installedAt: '2026-09-25T10:00:00.000Z', checkout, branch: 'main' }, env);
  };

  it('lists linked checkouts and flips `current` atomically', () => {
    fakeLink('0.11.0+main', '0.11.0');
    fakeLink('0.11.1+dev', '0.11.1');

    expect(listLinks(env).map((entry) => entry.id).sort()).toEqual(['0.11.0+main', '0.11.1+dev']);
    expect(activeId(env)).toBeNull();

    activate('0.11.0+main', env);
    expect(activeId(env)).toBe('0.11.0+main');
    // The link's NAME is the id on every platform; its target is relative on POSIX and
    // absolute on Windows, where `current` is a junction.
    expect(basename(readlinkSync(join(versionsDir(env), 'current')))).toBe('0.11.0+main');
    expect(existsSync(currentEntry(env))).toBe(true);
    expect(listLinks(env).find((entry) => entry.active)?.id).toBe('0.11.0+main');

    activate('0.11.1+dev', env);
    expect(activeId(env)).toBe('0.11.1+dev');
    expect(listLinks(env).find((entry) => entry.active)?.id).toBe('0.11.1+dev');
    // Replacing a link leaves the version it used to point at in place.
    expect(existsSync(currentEntry(env))).toBe(true);
    expect(existsSync(versionEntry('0.11.0+main', env))).toBe(true);
    expect(existsSync(join(versionsDir(env), `.current.${process.pid}.tmp`))).toBe(false);
    expect(() => activate('9.9.9', env)).toThrow(/not installed/);
  });

  // `versionDir` is the path a removal rm -rf's, so an id that climbs out of `versions/` is a
  // wipe of whatever it lands on. The wire schema's charset alone still admits `..`; the layout
  // has to refuse it itself.
  it('refuses a version id that could escape the versions directory', () => {
    for (const id of ['..', '.', '.hidden', '0.11.1/../..', 'a..b', '']) {
      expect(() => assertSafeId(id)).toThrow(/invalid version id/);
      expect(() => versionDir(id, env)).toThrow(/invalid version id/);
    }
    for (const id of ['0.12.0', '0.12.0+local', '0.12.0-nightly.20260927.60', '0.9.2-pr743.1156.2']) {
      expect(assertSafeId(id)).toBe(id);
      expect(versionDir(id, env)).toBe(join(versionsDir(env), id));
    }
  });

  // A bad id must not take the listing down with it: the graceful skip has to come from
  // `readManifest`'s own catch — none of these is dot-prefixed, so the `startsWith('.')` skip
  // cannot be what saves the listing.
  it('skips an unsafe directory name instead of throwing out of listLinks', () => {
    fakeLink('0.11.0+main', '0.11.0');
    for (const junk of ['a..b', '-weird', 'has space', '0.1.0;rm']) {
      mkdirSync(join(versionsDir(env), junk), { recursive: true });
    }
    expect(listLinks(env).map((entry) => entry.id)).toEqual(['0.11.0+main']);
  });

  it('tells install kinds apart by where the entry file lives', () => {
    expect(detectInstallKind(versionEntry('0.11.1', env), env)).toBe('managed');
    expect(detectInstallKind('/Users/x/.npm/_npx/abc123/node_modules/@open-mercato/cezar/dist/index.js', env)).toBe('npx');
    expect(detectInstallKind('/opt/homebrew/lib/node_modules/@open-mercato/cezar/dist/index.js', env)).toBe('global-npm');
    const checkout = join(home, 'repo', 'packages', 'cezar');
    mkdirSync(join(checkout, 'src'), { recursive: true });
    mkdirSync(join(checkout, 'dist'), { recursive: true });
    writeFileSync(join(checkout, 'package.json'), '{}');
    expect(detectInstallKind(join(checkout, 'dist', 'index.js'), env)).toBe('checkout');
    expect(detectInstallKind(join(home, 'elsewhere', 'index.js'), env)).toBe('unknown');
  });

  // A worktree linked into versions/ is `managed` by path, yet runs a checkout's code.
  it('counts a checkout linked as a version as running from a checkout', () => {
    const checkout = join(home, 'repo', 'packages', 'cezar');
    mkdirSync(join(checkout, 'src'), { recursive: true });
    mkdirSync(join(checkout, 'dist'), { recursive: true });
    writeFileSync(join(checkout, 'package.json'), '{}');
    writeFileSync(join(checkout, 'dist', 'index.js'), '');
    const link = join(versionDir('0.15.2+cez-abc12345', env), 'node_modules', '@open-mercato', 'cezar');
    mkdirSync(join(link, '..'), { recursive: true });
    symlinkSync(checkout, link, 'dir');
    const entry = join(link, 'dist', 'index.js');
    expect(detectInstallKind(entry, env)).toBe('managed');
    expect(runsFromCheckout(entry, env)).toBe(true);
    fakeLink('0.15.1+main', '0.15.1');
    expect(runsFromCheckout(versionEntry('0.15.1+main', env), env)).toBe(false);
  });
});

describe('activeId without a symlink', () => {
  it('reads the text-file fallback, and answers null when nothing is there', () => {
    const home = mkdtempSync(join(tmpdir(), 'cez-active-'));
    const env = { ...process.env, CEZ_HOME: home };
    try {
      expect(activeId(env)).toBeNull();
      mkdirSync(versionsDir(env), { recursive: true });
      writeFileSync(join(versionsDir(env), 'current'), '0.11.1\n');
      expect(activeId(env)).toBe('0.11.1');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
