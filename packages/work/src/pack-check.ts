/** Tarball bundle check — the pure half of `scripts/check-pack.mjs`.
 *
 *  Phase R1 of the cockpit redesign shipped an npm tarball with no UI in it
 *  (`files` listed the sources, not the Vite build). This module pins that bug
 *  class: given the file list `npm pack --dry-run --json` reports, decide
 *  whether the package would ship a working cockpit. Kept dependency-free and
 *  side-effect-free so the decision is unit-testable; the script owns the
 *  `npm pack` invocation and the exit code.
 */

/** One package's entry in `npm pack --json` output. */
export interface PackReport {
  filename?: string;
  files?: { path: string }[];
}

const LEGACY_DIST_BASES = [
  'dist/feature-telemetry',
  'dist/telemetry',
  'dist/telemetry-cli',
  'dist/install-as-command',
  'dist/skills-update',
  'dist/runs/agent-error-telemetry',
  'dist/server/provider-telemetry',
  'dist/server/star-count',
  'dist/server/tracker/config',
  'dist/webhooks/discord',
  'dist/webhooks/slack',
  'dist/self-update/enabled',
  'dist/self-update/installer',
  'dist/self-update/launcher',
  'dist/self-update/pulls',
  'dist/self-update/registry',
  'dist/self-update/restart',
  'dist/self-update/service',
] as const;

const DIST_OUTPUT_SUFFIXES = ['.js.map', '.d.ts', '.js'] as const;

function legacyDistOutput(file: string): boolean {
  return LEGACY_DIST_BASES.some((base) => DIST_OUTPUT_SUFFIXES.some((suffix) => file === `${base}${suffix}`));
}

function sourceForDistOutput(file: string): string | undefined {
  if (!file.startsWith('dist/')) return undefined;

  const output = file.slice('dist/'.length);
  const isContract = output.startsWith('contract/');
  const relativeOutput = isContract ? output.slice('contract/'.length) : output;
  const suffix = DIST_OUTPUT_SUFFIXES.find((candidate) => relativeOutput.endsWith(candidate));
  if (!suffix) return undefined;

  const stem = relativeOutput.slice(0, -suffix.length);
  const sourceRoot = isContract ? '../contract/src' : 'src';
  return `${sourceRoot}/${stem}.ts`;
}

/** Find stale or denied compiler outputs in `dist/`, given the source files a clean build may emit. */
export function findDistGaps(distFiles: readonly string[], sourceFiles: readonly string[]): string[] {
  const sources = new Set(sourceFiles.map((file) => file.replaceAll('\\', '/')));
  const gaps: string[] = [];

  for (const file of distFiles) {
    if (!file.startsWith('dist/')) continue;
    if (legacyDistOutput(file)) {
      gaps.push(`${file} is denied legacy output`);
      continue;
    }

    const source = sourceForDistOutput(file);
    if (!source) {
      gaps.push(`${file} has no source mapping`);
    } else if (!sources.has(source)) {
      gaps.push(`${file} has no matching source (${source})`);
    }
  }

  return gaps;
}

/** The first package report from `npm pack --json`, whatever npm's shape: an
 *  array up to npm 11, an object keyed by package name from npm 12. */
export function firstPackReport(packJson: unknown): PackReport | undefined {
  if (!packJson || typeof packJson !== 'object') return undefined;
  return (Array.isArray(packJson) ? packJson : Object.values(packJson))[0] as PackReport | undefined;
}

/** Human-readable problems with a would-be tarball; empty array = publishable.
 *
 *  Requirements (spec `.ai/specs/2026-07-14-cockpit-ui-redesign.md`, Serving):
 *  - `web/dist/index.html` — the built shell every GET serves.
 *  - at least one `web/dist/assets/*` file — the hashed JS/CSS bundles; an
 *    index.html alone renders a blank page.
 */
export function findPackGaps(packedFiles: readonly string[]): string[] {
  const gaps: string[] = [];
  if (!packedFiles.includes('web/dist/index.html')) {
    gaps.push('web/dist/index.html is missing — the tarball would ship no UI shell (run `npm run build:web`)');
  }
  if (!packedFiles.some((f) => f.startsWith('web/dist/assets/') && f.length > 'web/dist/assets/'.length)) {
    gaps.push('no web/dist/assets/* bundle in the tarball — the shell would load with no JS/CSS');
  }
  return gaps;
}
