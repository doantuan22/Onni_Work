// The desktop build version: 0.1, 0.2, … 0.9, 1.0, 1.1 — one tenth per build, written as
// `major.minor.0` because Cargo, Tauri and NSIS all require three numeric parts.
// `npm run build:windows` owns the bump; nothing edits these files by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** `0.3.0` → 3 (tenths). A legacy `0.1.11` counts as 0.1, so the next build is 0.2. */
export function buildCounter(version) {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(version);
  if (!match) throw new Error(`build-version: not a major.minor[.patch] version: ${version}`);
  return Number(match[1]) * 10 + Number(match[2]);
}

export function versionForCounter(counter) {
  return `${Math.floor(counter / 10)}.${counter % 10}.0`;
}

/** The version the next build gets: current + 0.1. */
export function nextBuildVersion(current) {
  return versionForCounter(buildCounter(current) + 1);
}

/** A short label for logs and UI: `0.1.0` → `0.1`. */
export function displayVersion(version) {
  return version.replace(/\.0$/, '');
}

// Each file is edited as text so its line endings and layout survive (Cargo files are CRLF).
const EDITS = [
  ['package.json', /("version":\s*")[^"]+(")/],
  ['package-lock.json', /("name":\s*"@onni\/desktop",\s*"version":\s*")[^"]+(")/g],
  [path.join('src-tauri', 'tauri.conf.json'), /("version":\s*")[^"]+(")/],
  [path.join('src-tauri', 'Cargo.toml'), /(\[package\]\r?\nname = "onni-desktop"\r?\nversion = ")[^"]+(")/],
  [path.join('src-tauri', 'Cargo.lock'), /(name = "onni-desktop"\r?\nversion = ")[^"]+(")/],
];

export function writeBuildVersion(packageRoot, version) {
  for (const [file, pattern] of EDITS) {
    const target = path.join(packageRoot, file);
    const before = readFileSync(target, 'utf8');
    const after = before.replace(pattern, `$1${version}$2`);
    if (after === before && !before.includes(`"${version}"`)) {
      throw new Error(`build-version: no version field found in ${file}`);
    }
    writeFileSync(target, after);
  }
}
