#!/usr/bin/env node
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(packageRoot, 'dist');

if (path.dirname(dist) !== packageRoot || path.basename(dist) !== 'dist') {
  throw new Error(`clean-dist: refusing unexpected output path: ${dist}`);
}

rmSync(dist, { recursive: true, force: true });
