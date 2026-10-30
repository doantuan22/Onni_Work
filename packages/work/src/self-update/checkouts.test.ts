import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cezarPackageRoot } from './checkouts.ts';
import { activate, activeId, branchSlug, currentEntry, linkCheckout, linkId, listLinks, removeInstalled, versionDir, versionsDir } from './layout.ts';

/** A built cezar monorepo checkout: packages/work with dist/index.js and web/dist/index.html. */
function fakeCheckout(root: string, version = '0.13.0', built = true): string {
  const pkg = join(root, 'packages', 'cezar');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@onni/work', version }));
  if (built) {
    mkdirSync(join(pkg, 'dist'), { recursive: true });
    writeFileSync(join(pkg, 'dist', 'index.js'), '// entry\n');
    mkdirSync(join(pkg, 'web', 'dist'), { recursive: true });
    writeFileSync(join(pkg, 'web', 'dist', 'index.html'), '<!doctype html>');
  }
  return realpathSync(pkg);
}

describe('linked checkouts', () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'cez-link-'));
    env = { ...process.env, CEZ_HOME: join(home, 'cezar-home') };
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('slugs a branch into semver build metadata', () => {
    expect(branchSlug('cez/cb28888e')).toBe('cez-cb28888e');
    expect(branchSlug('feat//weird name!')).toBe('feat-weird-name');
    expect(linkId('0.13.0', 'cez/cb28888e')).toBe('0.13.0+cez-cb28888e');
    expect(linkId('0.13.0', '///')).toBe('0.13.0+checkout');
  });

  it('links a built checkout in place, lists it, activates it, and unlinks without touching it', () => {
    const pkg = fakeCheckout(join(home, 'wt'));
    const result = linkCheckout(pkg, 'cez/cb28888e', env);
    expect(result.id).toBe('0.13.0+cez-cb28888e');
    const link = join(versionDir(result.id, env), 'node_modules', '@onni', 'work');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(pkg);

    const [entry] = listLinks(env);
    expect(entry).toMatchObject({ id: result.id, source: 'link', branch: 'cez/cb28888e', checkout: pkg, version: '0.13.0' });

    activate(result.id, env);
    expect(activeId(env)).toBe(result.id);
    expect(readFileSync(currentEntry(env), 'utf8')).toBe('// entry\n');

    expect(() => removeInstalled(result.id, env)).toThrow(/is active/);
  });

  it('removes the link, never the checkout', () => {
    const pkg = fakeCheckout(join(home, 'wt'));
    const { id } = linkCheckout(pkg, 'main', env);
    removeInstalled(id, env);
    expect(existsSync(versionDir(id, env))).toBe(false);
    expect(existsSync(join(pkg, 'dist', 'index.js'))).toBe(true);
  });

  it('re-linking a checkout replaces its old entry; another checkout with the same id gets its own', () => {
    const pkg = fakeCheckout(join(home, 'a'));
    linkCheckout(pkg, 'feature', env);
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@onni/work', version: '0.14.0' }));
    const again = linkCheckout(pkg, 'feature', env);
    expect(again.id).toBe('0.14.0+feature');
    expect(listLinks(env).map((entry) => entry.id)).toEqual(['0.14.0+feature']);

    const other = fakeCheckout(join(home, 'b'), '0.14.0');
    const second = linkCheckout(other, 'feature', env);
    expect(second.id).toMatch(/^0\.14\.0\+feature\.[0-9a-z]+$/);
    expect(listLinks(env)).toHaveLength(2);
  });

  it('refuses what is not a built cezar package', () => {
    expect(() => linkCheckout(join(home, 'nothing'), 'x', env)).toThrow(/is not a @onni\/work package/);
    const unbuilt = fakeCheckout(join(home, 'raw'), '0.13.0', false);
    expect(() => linkCheckout(unbuilt, 'x', env)).toThrow(/not built/);
  });

  // A link outlives its worktree, so `unlink` can still find and prune it.
  it('keeps a link whose worktree is gone', () => {
    const tree = join(home, 'gone');
    const { id } = linkCheckout(fakeCheckout(tree), 'gone', env);
    rmSync(tree, { recursive: true, force: true });
    expect(listLinks(env).map((entry) => entry.id)).toEqual([id]);
    expect(existsSync(versionsDir(env))).toBe(true);
  });

  it('finds the cezar package root in the monorepo layout and the single-package one', () => {
    const mono = fakeCheckout(join(home, 'mono'));
    expect(cezarPackageRoot(join(home, 'mono'))).toBe(join(home, 'mono', 'packages', 'cezar'));
    expect(realpathSync(cezarPackageRoot(mono)!)).toBe(mono);
    const flat = join(home, 'flat');
    mkdirSync(flat, { recursive: true });
    writeFileSync(join(flat, 'package.json'), JSON.stringify({ name: '@onni/work', version: '0.9.0' }));
    expect(cezarPackageRoot(flat)).toBe(flat);
    expect(cezarPackageRoot(home)).toBeNull();
  });
});
