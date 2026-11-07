#!/usr/bin/env node
// Run with `node --import tsx packages/work/scripts/manager-eval.mjs <treeDir>` from the repo root.
import { resolve } from 'node:path';
import { formatManagerEvaluation, scoreManagerTree } from '../src/manager-eval/scorer.ts';

const treeDir = process.argv[2];
if (!treeDir || process.argv.length !== 3) {
  process.stderr.write('usage: node --import tsx packages/work/scripts/manager-eval.mjs <treeDir>\n');
  process.exitCode = 2;
} else {
  const result = scoreManagerTree(resolve(treeDir));
  process.stdout.write(`${formatManagerEvaluation(result)}\n`);
  if (result.criteria.some((criterion) => criterion.status === 'fail')) process.exitCode = 1;
}
