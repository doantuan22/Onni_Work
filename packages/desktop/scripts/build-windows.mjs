#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const tempRoot = path.join(repoRoot, '.tmp');
const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim().length > 0;
const revision = `${commit}${dirty ? '-dirty' : ''}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const buildId = `${manifest.version}-${revision}-${stamp}`;

function tempPath(...segments) {
  const target = path.resolve(tempRoot, ...segments);
  const relative = path.relative(tempRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`build:windows: refusing path outside .tmp: ${target}`);
  }
  const repoRelative = path.relative(repoRoot, target).replaceAll('\\', '/');
  execFileSync('git', ['check-ignore', '--quiet', '--', repoRelative], { cwd: repoRoot });
  return target;
}

const buildRoot = tempPath('desktop-builds', buildId);
const artifactRoot = tempPath('desktop-artifacts', buildId);
const npmExecpath = process.env.npm_execpath;
if (!npmExecpath) throw new Error('build:windows must be run with `npm run build:windows`');

// An isolated ignored target avoids patching a release executable the user may have open.
execFileSync(process.execPath, [npmExecpath, 'run', 'tauri', '--', 'build', '--bundles', 'nsis'], {
  cwd: packageRoot,
  env: { ...process.env, CARGO_TARGET_DIR: buildRoot },
  stdio: 'inherit',
});

const nsisRoot = path.join(buildRoot, 'release', 'bundle', 'nsis');
const installers = readdirSync(nsisRoot).filter((name) => /-setup\.exe$/i.test(name));
if (installers.length !== 1) {
  throw new Error(`build:windows expected one NSIS setup in ${nsisRoot}, found ${installers.length}`);
}

mkdirSync(artifactRoot, { recursive: true });
const artifact = path.join(artifactRoot, installers[0]);
copyFileSync(path.join(nsisRoot, installers[0]), artifact);
console.log(`Windows NSIS artifact: ${artifact}`);
