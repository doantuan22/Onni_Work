/**
 * The little semver the managed layout needs — dependency-free on purpose (the CLI's runtime
 * deps are six packages and this is not worth a seventh). Handles what cezar publishes:
 * `0.11.1`, `0.11.1-nightly.20260924.49`, `0.9.2-pr743.1156.2`, `0.1.5-develop.124`.
 */

export interface ParsedVersion {
  core: [number, number, number];
  /** Prerelease identifiers after the `-`; empty for a release. Build metadata (`+…`) is dropped. */
  pre: string[];
}

export function parseVersion(raw: string): ParsedVersion | null {
  const withoutBuild = raw.trim().replace(/^v/, '').split('+')[0] ?? '';
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(withoutBuild);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

/** How a version built from a source checkout is shown: `0.15.2` → `0.15.2-dev`. Display only. */
export function devVersion(raw: string): string {
  const parsed = parseVersion(raw);
  return `${parsed ? parsed.core.join('.') : raw.trim()}-dev`;
}
