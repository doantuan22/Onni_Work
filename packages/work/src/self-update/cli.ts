/**
 * `cezar link | unlink` — the terminal side of the managed layout: register a built checkout
 * under `~/.cezar/versions` so the desktop shell's `current` runs it. Local only: no registry,
 * no npm, no server.
 */

import { resolve } from 'node:path';

import { branchOf, cezarPackageRoot } from './checkouts.ts';
import { activate, activeId, linkCheckout, listLinks, removeInstalled } from './layout.ts';

export interface SelfUpdateCliOptions {
  /** `link --use`: activate the linked checkout right away. */
  use?: boolean;
}

export async function runSelfUpdateCommand(command: string, args: string[], opts: SelfUpdateCliOptions): Promise<number> {
  switch (command) {
    case 'link':
      return linkCommand(args[0], opts.use === true);
    case 'unlink':
      return unlinkCommand(args[0]);
    default:
      return 1;
  }
}

async function linkCommand(dir: string | undefined, use: boolean): Promise<number> {
  const target = resolve(dir ?? process.cwd());
  const packageRoot = cezarPackageRoot(target);
  if (!packageRoot) {
    console.error(`  ✗ ${target} is not a cezar checkout (no @onni/work package.json there or in packages/work)`);
    return 1;
  }
  try {
    const branch = await branchOf(target);
    const result = linkCheckout(packageRoot, branch);
    console.log(`\n  ✓ linked ${result.id}  → ${packageRoot}`);
    if (use) {
      activate(result.id);
      console.log(`  ✓ now using ${result.id}`);
      console.log('    the desktop app picks it up on its next start — a running cockpit keeps its version');
    } else {
      console.log('    switch with: cezar link --use  ·  desktop: Cezar ▸ Versions');
    }
    console.log('    rebuild the checkout (npm run build) and restart to run new code — the link needs no refresh\n');
    return 0;
  } catch (error) {
    console.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function unlinkCommand(id: string | undefined): Promise<number> {
  if (!id) {
    console.error('  usage: cezar unlink <id|checkout-path>');
    return 1;
  }
  const match = listLinks().find((entry) => entry.id === id || entry.checkout === resolve(id));
  if (!match) {
    console.error(`  ✗ ${id} is not a linked checkout`);
    return 1;
  }
  if (match.id === activeId()) {
    console.error(`  ✗ ${match.id} is the active version — link another checkout with --use first`);
    return 1;
  }
  removeInstalled(match.id);
  console.log(`  ✓ unlinked ${match.id} (${match.checkout ?? 'checkout'} is untouched)`);
  return 0;
}
