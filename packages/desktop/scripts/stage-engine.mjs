#!/usr/bin/env node
// Builds the engine folder that goes INSIDE the installer, so one setup.exe is the whole app:
//   <stage>/engine/node.exe                                  the Node runtime that runs the engine
//   <stage>/engine/node_modules/@onni/work/dist/index.js     the engine, production dependencies only
// The shell finds it next to its own executable (`bundled_engine_dir` in src-tauri/src/lib.rs) when
// no `ONNI_DESKTOP_ENTRY` and no `onni link` version is present.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '..', '..');

/** Stages `<stageRoot>/engine` from the built `packages/work`; returns the engine folder. */
export function stageEngine(stageRoot) {
  const npmExecpath = process.env.npm_execpath;
  if (!npmExecpath) throw new Error('stage-engine: run it through npm (npm run build:windows)');
  const work = path.join(repoRoot, 'packages', 'work');
  for (const required of ['dist/index.js', 'web/dist/index.html']) {
    if (!existsSync(path.join(work, required))) {
      throw new Error(`stage-engine: ${required} is missing — run \`npm run build\` at the repository root first`);
    }
  }

  const packDir = path.join(stageRoot, 'pack');
  const engineDir = path.join(stageRoot, 'engine');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(engineDir, { recursive: true });

  // The same tarball `npm run test:package` verifies, installed like a consumer would: production
  // dependencies only, no lifecycle scripts (the PTY binding ships prebuilt per platform).
  // `npm run` re-exports the developer's npm config as npm_config_* variables; a `~/.npmrc` with
  // allow-scripts arrives at the nested npm as the cli/env layer, which npm 11 refuses for a
  // project install (EALLOWSCRIPTS) even beside --ignore-scripts. This verifies the tarball, not
  // the developer's install policy, so the nested calls drop it (the same as `npm run test:package`).
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts'));
  const npm = (args, cwd) => execFileSync(process.execPath, [npmExecpath, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const packed = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], work));
  const tarball = path.join(packDir, packed[0].filename);
  writeFileSync(path.join(engineDir, 'package.json'), '{"private":true}\n');
  npm(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball], engineDir);

  const entry = path.join(engineDir, 'node_modules', '@onni', 'work', 'dist', 'index.js');
  if (!existsSync(entry)) throw new Error(`stage-engine: the installed engine has no ${entry}`);

  // The runtime that built it: the engine needs Node 20+ and the installer must not depend on one.
  const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
  copyFileSync(process.execPath, path.join(engineDir, nodeExe));
  writeFileSync(
    path.join(engineDir, 'NOTICE-node.txt'),
    `This folder bundles the Node.js ${process.version} runtime (${nodeExe}), unmodified.\n` +
      'Node.js is MIT-licensed: https://github.com/nodejs/node/blob/main/LICENSE\n',
  );
  return engineDir;
}

export function describeStage(engineDir) {
  const count = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
  return `${count(engineDir)} files`;
}
