/**
 * Finding cezar's own checkout — what `cezar link` needs to turn a directory into a version the
 * desktop shell can run: the `@onni/work` package root inside it and the branch it is
 * on. The switch itself is `linkCheckout` in layout.ts.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { PACKAGE_NAME } from './layout.ts';

const exec = promisify(execFile);

function packageVersion(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown };
    return pkg.name === PACKAGE_NAME && typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/** The cezar package root inside a checkout, or null when the tree is not cezar's. */
export function cezarPackageRoot(worktree: string): string | null {
  for (const dir of [join(worktree, 'packages', 'cezar'), worktree]) {
    if (packageVersion(dir)) return dir;
  }
  return null;
}

/** The branch a checkout is on, else its directory name. */
export async function branchOf(worktree: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: worktree, timeout: 5_000 });
    if (stdout.trim()) return stdout.trim();
  } catch {
    // detached HEAD, or not a repo
  }
  return worktree.split(/[\\/]/).filter(Boolean).pop() ?? 'checkout';
}
