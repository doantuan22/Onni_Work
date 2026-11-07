import type { DispatchVerifyBaseline, VERIFY_BASELINE_VERDICTS } from '@onni/contract';

export const VERIFY_BASELINE_METHOD = 'heuristic' as const;
export const VERIFY_BASELINE_DISCLAIMER = 'failures are compared by exit code and failing-line text; a flaky or renamed test can be misclassified';
export const FAILURE_SIGNATURES_MAX = 200;
const NEW_SIGNATURES_MAX = 10;

export interface BaselineCommandRun {
  exitCode: number | null;
  timedOut?: boolean;
  aborted?: boolean;
  spawnError?: string;
  output: string;
}

export type BaselineClassification = DispatchVerifyBaseline['results'][number]['classification'];
export type BaselineVerdict = (typeof VERIFY_BASELINE_VERDICTS)[number];

const FAILURE_LINE = /\bFAIL(?:ED)?\b|\bnot ok\b|[✗✖×]|--- FAIL:|\.\.\. FAILED|thread\s+['"].+['"]\s+panicked|error TS\d+:|error\[E\d+\]/i;
const MISSING_MODULE = /cannot find (?:module|package)|module_not_found|no module named|could not find (?:crate|package|module)|no such module|can't resolve|command not found|not recognized as an internal or external command|no such file or directory/i;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceWorktreePaths(line: string, paths: readonly string[]): string {
  let result = line;
  for (const path of paths.filter(Boolean)) {
    const pattern = [...path].map((char) => char === '/' || char === '\\' ? '[\\\\/]' : escapeRegex(char)).join('');
    result = result.replace(new RegExp(pattern, 'gi'), '<wt>');
  }
  return result;
}

function normalizeSignature(line: string, worktreePaths: readonly string[]): string {
  return replaceWorktreePaths(line, worktreePaths)
    .replace(/\\/g, '/')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/gi, '<time>')
    .replace(/\(\d+(?:\.\d+)?\s*m?s\)/gi, '')
    .replace(/:\d+(?::\d+)?\b/g, '')
    .replace(/\b[a-f0-9]{8,}\b/gi, '<hash>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts a bounded, normalized set of test-looking failure lines. This is deliberately heuristic. */
export function failureSignatures(output: string, worktreePaths: readonly string[] = []): string[] {
  const signatures = output
    .replace(ANSI, '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => FAILURE_LINE.test(line))
    .map((line) => normalizeSignature(line, worktreePaths))
    .filter(Boolean);
  return [...new Set(signatures)].sort().slice(0, FAILURE_SIGNATURES_MAX);
}

export function classifyBaselineFailure(
  worker: BaselineCommandRun,
  baseline: BaselineCommandRun,
  options: { workerPath?: string; baselinePath?: string; nodeModulesLinked: boolean },
): { classification: BaselineClassification; newSignatures: string[]; newSignaturesOmitted: number } {
  const workerSignatures = failureSignatures(worker.output, options.workerPath ? [options.workerPath] : []);
  const baselineSignatures = failureSignatures(
    baseline.output,
    [options.workerPath, options.baselinePath].filter((path): path is string => Boolean(path)),
  );
  const inconclusive = (): ReturnType<typeof classifyBaselineFailure> => ({
    classification: 'inconclusive',
    newSignatures: [],
    newSignaturesOmitted: 0,
  });

  if (baseline.timedOut || baseline.aborted || baseline.spawnError || baseline.exitCode === null) return inconclusive();
  if (!options.nodeModulesLinked && MISSING_MODULE.test(baseline.output)) return inconclusive();

  const newSignatures = workerSignatures.filter((signature) => !baselineSignatures.includes(signature));
  if (baseline.exitCode === 0) {
    return {
      classification: 'new-failure',
      newSignatures: newSignatures.slice(0, NEW_SIGNATURES_MAX),
      newSignaturesOmitted: Math.max(0, newSignatures.length - NEW_SIGNATURES_MAX),
    };
  }
  if (workerSignatures.length === 0 && baselineSignatures.length === 0) return inconclusive();
  if (newSignatures.length > 0) {
    return {
      classification: 'new-signatures',
      newSignatures: newSignatures.slice(0, NEW_SIGNATURES_MAX),
      newSignaturesOmitted: Math.max(0, newSignatures.length - NEW_SIGNATURES_MAX),
    };
  }
  if (workerSignatures.length > 0 && workerSignatures.every((signature) => baselineSignatures.includes(signature))) {
    return { classification: 'pre-existing', newSignatures: [], newSignaturesOmitted: 0 };
  }
  return inconclusive();
}

export function baselineVerdict(
  results: readonly Pick<DispatchVerifyBaseline['results'][number], 'classification'>[],
): BaselineVerdict {
  if (results.some(({ classification }) => classification === 'new-failure' || classification === 'new-signatures')) {
    return 'new-failures';
  }
  if (results.some(({ classification }) => classification === 'inconclusive')) return 'inconclusive';
  return 'no-new-failures';
}
