import { existsSync } from 'node:fs';
import { lstat as lstatPath, stat as statPath, symlink as symlinkPath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  VERIFY_COMMAND_TIMEOUT_MS,
  VERIFY_MAX_RUNS_PER_WORKER,
  VERIFY_TOTAL_TIMEOUT_MS,
  type DispatchVerifyBaseline,
  type DispatchVerifyInput,
  type DispatchVerifyResult,
} from '@onni/contract';
import { BASH_MISSING_MESSAGE } from '../../core/bash-path.ts';
import { diskFloorRefusal } from '../../disk-space.ts';
import {
  requireRootManager,
  requireSameTree,
  resolveRunRef,
} from '../../dispatch/access.ts';
import { baselineVerdict, classifyBaselineFailure, VERIFY_BASELINE_METHOD } from '../../dispatch/baseline.ts';
import {
  assembleCommandResults,
  buildVerifyEnv,
  capWarnings,
  resolveVerifyCommands,
  verifyStateOf,
  verifySummary,
  type RawCommandRun,
} from '../../dispatch/verify.ts';
import {
  appendLedger,
  appendReportSection,
} from '../../dispatch/tree-fs.ts';
import { isTerminalStatus } from '../../dispatch/engine.ts';
import {
  removeDetachedWorktree,
  resolveReadOnlyDiffBase,
  withBaselineWorktree,
  worktreeChangedFilesReadOnly,
  worktreeHeadShort,
} from '../../git-worktree.ts';
import type { RunRecord } from '../../runs/store.ts';
import type { VerifyContext } from './internal-types.ts';
export async function verifyFor(
  context: VerifyContext,
  callerId: string,
  input: DispatchVerifyInput,
): Promise<DispatchVerifyResult | { denied: string; status: 400 | 403 | 404 | 409 }> {
  const caller = context.store.getRun(callerId);
  const callerAccess = requireRootManager(caller, 'verify a worker');
  if (!callerAccess.ok) return { denied: callerAccess.denied, status: callerAccess.status };
  if (!caller) return { denied: `no such run: ${callerId}`, status: 404 };

  const target = resolveRunRef(context.store.listRuns(), input.target);
  if (target === 'none') return { denied: `no such run: ${input.target}`, status: 404 };
  if (target === 'ambiguous') return { denied: `ambiguous id "${input.target}" — give more characters`, status: 409 };
  const sameTree = requireSameTree(caller, target);
  if (!sameTree.ok) return { denied: sameTree.denied, status: sameTree.status };
  const id8 = target.id.slice(0, 8);
  if (target.id === caller.id || target.dispatch?.rootRunId !== caller.id) {
    return { denied: 'verify checks a worker of this task, not the manager itself', status: 409 };
  }
  if (!isTerminalStatus(target.status) || context.isActive(target.id)) {
    return { denied: `worker ${id8} is still ${target.status} — verify runs only on a settled worker`, status: 409 };
  }
  const used = target.dispatch?.verify?.runs ?? 0;
  if (used >= VERIFY_MAX_RUNS_PER_WORKER) {
    const last = target.dispatch?.verify?.last?.state;
    return {
      denied: `${used} of ${VERIFY_MAX_RUNS_PER_WORKER} verify runs used for ${id8}${last ? `; last: ${last}` : ''}`,
      status: 409,
    };
  }
  if (context.verifying.has(caller.id)) {
    return { denied: 'another verify is running for this task tree', status: 409 };
  }
  // Claimed before the first await: two simultaneous calls must not both pass the check above.
  const controller = new AbortController();
  context.verifying.set(caller.id, controller);
  const totalTimer = setTimeout(() => controller.abort('verify-total-timeout'), VERIFY_TOTAL_TIMEOUT_MS);
  try {
    const resolved = await resolveVerifyCommands({
      repoRoot: context.repoRoot,
      ...(caller.worktreePath ? { managerWorktree: caller.worktreePath } : {}),
      ...(input.only ? { only: input.only } : {}),
      redact: (text) => context.store.redactRunText(target.id, text),
    });
    if ('error' in resolved) return { denied: resolved.error, status: 400 };
    return await runVerify(context, caller, target, resolved, controller, input.baseline === true);
  } finally {
    clearTimeout(totalTimer);
    context.verifying.delete(caller.id);
  }
}

async function runVerify(
  context: VerifyContext,
  caller: RunRecord,
  target: RunRecord,
  resolved: { source: 'required-checks' | 'discovered' | 'none'; commands: string[] },
  controller: AbortController,
  compareBaseline: boolean,
): Promise<DispatchVerifyResult> {
  const startedAt = new Date(context.verifyDeps.now()).toISOString();
  const t0 = context.verifyDeps.now();
  const used = target.dispatch?.verify?.runs ?? 0;
  const redact = (text: string) => context.store.redactRunText(target.id, text);
  const unavailable = (reasonCode: NonNullable<DispatchVerifyResult['reasonCode']>, reason: string): DispatchVerifyResult => {
    const result: DispatchVerifyResult = {
      state: 'unavailable',
      reasonCode,
      reason: reason.slice(0, 400),
      source: resolved.source,
      startedAt,
      durationMs: 0,
      results: [],
      runsUsed: used,
      runsMax: VERIFY_MAX_RUNS_PER_WORKER,
      warnings: [],
    };
    recordVerify(context, caller, target, result);
    return result;
  };

  if (context.verifyDeps.env().ONNI_DRY_RUN === '1') return unavailable('dry-run', 'ONNI_DRY_RUN=1 — no check is executed');
  const worktree = target.worktreePath;
  if (!worktree || !existsSync(worktree)) {
    return unavailable('no-worktree', "the worker's worktree is gone — it was reclaimed; nothing to run in");
  }
  if (resolved.commands.length === 0) {
    return unavailable('no-commands', 'no required checks are configured and none could be discovered: expected package.json scripts test/build/lint/typecheck/check or a Cargo.toml');
  }
  const bash = context.verifyDeps.resolveBash({ env: context.verifyDeps.env() });
  if (!bash) return unavailable('no-bash', BASH_MISSING_MESSAGE);

  const warnings: string[] = [];
  const [files, headCommit] = await Promise.all([
    worktreeChangedFilesReadOnly(worktree, target.baseBranch ?? 'HEAD', { max: 200 }),
    worktreeHeadShort(worktree),
  ]);
  if (files.files.some((file) => /(^|\/)(package\.json|Cargo\.toml)$/.test(file))) {
    warnings.push('this worker changed package.json or Cargo.toml — verify runs its scripts, so a green result is only as honest as that change');
  }

  const env = buildVerifyEnv(context.verifyDeps.env());
  const raws: RawCommandRun[] = [];
  let counted = false;
  let firstAttempt = true;
  const workerDeadline = t0 + (compareBaseline ? VERIFY_TOTAL_TIMEOUT_MS / 2 : VERIFY_TOTAL_TIMEOUT_MS);
  for (const command of resolved.commands) {
    const remaining = workerDeadline - context.verifyDeps.now();
    if (controller.signal.aborted || remaining <= 0) {
      raws.push({ command, outcome: 'skipped', exitCode: null, durationMs: 0, timedOut: false, output: '' });
      continue;
    }
    if (!counted) {
      // Reserve before the first spawn so a crashed or aborted verify cannot be repeated for free.
      context.updateDispatch(target.id, (d) => ({ ...d, verify: { runs: used + 1, ...(d.verify?.last ? { last: d.verify.last } : {}) } }));
      counted = true;
    }
    const run = await context.verifyDeps.runCommand({
      bashPath: bash.path,
      pathDirs: bash.pathDirs,
      command,
      cwd: worktree,
      env,
      timeoutMs: Math.min(VERIFY_COMMAND_TIMEOUT_MS, remaining),
      signal: controller.signal,
    });
    const wasFirstAttempt = firstAttempt;
    firstAttempt = false;
    if (run.spawnError) {
      if (wasFirstAttempt && run.spawnErrorCode === 'ENOENT') {
        // POSIX resolveBash returns a command name; ENOENT is the first proof bash is absent.
        context.updateDispatch(target.id, (d) => {
          const runs = Math.max(0, (d.verify?.runs ?? used + 1) - 1);
          if (runs === 0 && !d.verify?.last) {
            const restored = { ...d };
            delete restored.verify;
            return restored;
          }
          return { ...d, verify: { runs, ...(d.verify?.last ? { last: d.verify.last } : {}) } };
        });
        counted = false;
        return unavailable('no-bash', BASH_MISSING_MESSAGE);
      }
      // A spawn failure (a POSIX box without bash) is not a verdict on the worker's code.
      raws.push({ command, outcome: 'skipped', exitCode: null, durationMs: run.durationMs, timedOut: false, output: '' });
      warnings.push(`could not start "${command.slice(0, 80)}": ${run.spawnError}`);
      continue;
    }
    const outcome: RawCommandRun['outcome'] = run.timedOut ? 'timed-out' : run.aborted ? 'skipped' : run.exitCode === 0 ? 'passed' : 'failed';
    raws.push({ command, outcome, exitCode: run.exitCode, durationMs: run.durationMs, timedOut: run.timedOut, output: run.output });
  }
  const baseline = compareBaseline
    ? await runVerifyBaseline(context, target, raws.filter((raw) => raw.outcome === 'failed' || raw.outcome === 'timed-out'), env, bash, controller, t0, warnings, redact)
    : undefined;
  const results = assembleCommandResults(raws, redact);
  const result: DispatchVerifyResult = {
    state: verifyStateOf(results),
    source: resolved.source,
    ...(headCommit ? { headCommit } : {}),
    startedAt,
    durationMs: Math.max(0, context.verifyDeps.now() - t0),
    results,
    ...(baseline ? { baseline } : {}),
    runsUsed: used + (counted ? 1 : 0),
    runsMax: VERIFY_MAX_RUNS_PER_WORKER,
    warnings: capWarnings(warnings.map(redact)),
  };
  const lastSource = resolved.source === 'none' ? undefined : resolved.source;
  if (lastSource && counted) {
    context.updateDispatch(target.id, (d) => ({
      ...d,
      verify: {
        runs: d.verify?.runs ?? used + 1,
        last: {
          at: startedAt,
          ...(headCommit ? { headCommit } : {}),
          state: result.state === 'failed' ? 'failed' : 'passed',
          source: lastSource,
          results: results.map(({ command, outcome, exitCode }) => ({ command, outcome, exitCode })),
        },
      },
    }));
  }
  recordVerify(context, caller, target, result);
  return result;
}

/** Re-run only failed worker checks at its read-only fork point; every path exits through link-first cleanup. */
async function runVerifyBaseline(
  context: VerifyContext,
  target: RunRecord,
  failedCommands: RawCommandRun[],
  env: NodeJS.ProcessEnv,
  bash: { path: string; pathDirs: string[] },
  controller: AbortController,
  startedAt: number,
  warnings: string[],
  redact: (text: string) => string,
): Promise<DispatchVerifyBaseline> {
  const empty = (cleanup: DispatchVerifyBaseline['cleanup'] = 'removed'): DispatchVerifyBaseline => ({
    method: VERIFY_BASELINE_METHOD,
    state: 'compared',
    verdict: 'no-new-failures',
    results: [],
    newCount: 0,
    preExistingCount: 0,
    inconclusiveCount: 0,
    cleanup,
  });
  if (failedCommands.length === 0) return empty();

  const worktree = target.worktreePath!;
  const baseRemaining = Math.max(1, startedAt + VERIFY_TOTAL_TIMEOUT_MS - context.verifyDeps.now());
  const baseSha = await resolveReadOnlyDiffBase(worktree, target.baseBranch ?? 'HEAD', {
    ...(target.branch ? { taskBranch: target.branch } : {}),
    ...(target.startedAt ? { runStartedAt: target.startedAt } : {}),
    signal: controller.signal,
    timeoutMs: Math.min(3_000, baseRemaining),
  });
  if (!baseSha || !/^[0-9a-f]{40,64}$/i.test(baseSha)) {
    return {
      method: VERIFY_BASELINE_METHOD,
      state: 'unavailable',
      reason: 'no reliable diff base for this worker',
      results: [],
      newCount: 0,
      preExistingCount: 0,
      inconclusiveCount: 0,
      cleanup: 'removed',
    };
  }
  const diskRefusal = diskFloorRefusal('verify baseline', context.repoRoot);
  if (diskRefusal) {
    return {
      method: VERIFY_BASELINE_METHOD,
      state: 'unavailable',
      reason: redact(`low disk: ${diskRefusal}`).slice(0, 300),
      baseRef: baseSha.slice(0, 12),
      results: [],
      newCount: 0,
      preExistingCount: 0,
      inconclusiveCount: 0,
      cleanup: 'removed',
    };
  }

  const baselineRuns = new Map<string, { exitCode: number | null; timedOut: boolean; aborted: boolean; spawnError?: string; output: string }>();
  let nodeModulesLinked = false;
  const remaining = Math.max(1, startedAt + VERIFY_TOTAL_TIMEOUT_MS - context.verifyDeps.now());
  const baselineController = new AbortController();
  const forwardAbort = () => baselineController.abort();
  controller.signal.addEventListener('abort', forwardAbort, { once: true });
  const deadlineTimer = setTimeout(forwardAbort, remaining);
  const temp = await withBaselineWorktree(
    context.repoRoot,
    target.id,
    baseSha,
    async (baselinePath, signal) => {
      const workerModules = join(worktree, 'node_modules');
      const baselineModules = join(baselinePath, 'node_modules');
      try {
        if ((await statPath(workerModules)).isDirectory()) {
          try {
            await lstatPath(baselineModules);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            await symlinkPath(workerModules, baselineModules, process.platform === 'win32' ? 'junction' : 'dir');
            nodeModulesLinked = true;
            warnings.push("baseline shares the worker's node_modules");
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          warnings.push('could not link the worker node_modules into the baseline worktree');
        }
      }

      const deadline = startedAt + VERIFY_TOTAL_TIMEOUT_MS;
      for (const workerRun of failedCommands) {
        const commandRemaining = deadline - context.verifyDeps.now();
        if (signal.aborted || controller.signal.aborted || commandRemaining <= 0) {
          baselineRuns.set(workerRun.command, { exitCode: null, timedOut: true, aborted: signal.aborted || controller.signal.aborted, output: '' });
          continue;
        }
        const run = await context.verifyDeps.runCommand({
          bashPath: bash.path,
          pathDirs: bash.pathDirs,
          command: workerRun.command,
          cwd: baselinePath,
          env,
          timeoutMs: Math.min(VERIFY_COMMAND_TIMEOUT_MS, commandRemaining),
          signal,
        });
        baselineRuns.set(workerRun.command, {
          exitCode: run.exitCode,
          timedOut: run.timedOut,
          aborted: run.aborted,
          ...(run.spawnError ? { spawnError: run.spawnError } : {}),
          output: run.output,
        });
      }
    },
    { signal: baselineController.signal, timeoutMs: Math.min(context.verifyDeps.baselineTimeoutMs, remaining) },
  ).finally(() => {
    clearTimeout(deadlineTimer);
    controller.signal.removeEventListener('abort', forwardAbort);
  });

  if (temp.cleanup === 'left-behind') {
    context.baselineTrees.add(temp.worktreePath);
    warnings.push(`baseline cleanup left a temp worktree at ${temp.worktreePath}`);
    if (context.isDisposed()) retryBaselineCleanup(context, temp.worktreePath);
  } else {
    context.baselineTrees.delete(temp.worktreePath);
  }
  if (temp.state === 'unavailable' || temp.state === 'failed') {
    return {
      method: VERIFY_BASELINE_METHOD,
      state: 'unavailable',
      reason: redact(temp.reason ?? 'baseline worktree could not be used').slice(0, 300),
      baseRef: baseSha.slice(0, 12),
      results: [],
      newCount: 0,
      preExistingCount: 0,
      inconclusiveCount: 0,
      cleanup: temp.cleanup,
    };
  }

  const results = failedCommands.map((workerRun) => {
    const baselineRun = baselineRuns.get(workerRun.command) ?? {
      exitCode: null,
      timedOut: temp.state === 'timeout',
      aborted: temp.state === 'timeout',
      output: '',
    };
    const classified = classifyBaselineFailure(
      { exitCode: workerRun.exitCode, timedOut: workerRun.timedOut, output: workerRun.output },
      baselineRun,
      { workerPath: worktree, baselinePath: temp.worktreePath, nodeModulesLinked },
    );
    return {
      command: redact(workerRun.command).slice(0, 300),
      classification: classified.classification,
      workerExitCode: workerRun.exitCode,
      baselineExitCode: baselineRun.exitCode,
      newSignatures: classified.newSignatures.map((signature) => redact(signature).slice(0, 200)),
      newSignaturesOmitted: classified.newSignaturesOmitted,
    };
  });
  if (temp.state === 'timeout') warnings.push('baseline comparison timed out; unfinished commands are inconclusive');
  const newCount = results.filter(({ classification }) => classification === 'new-failure' || classification === 'new-signatures').length;
  const preExistingCount = results.filter(({ classification }) => classification === 'pre-existing').length;
  const inconclusiveCount = results.filter(({ classification }) => classification === 'inconclusive').length;
  return {
    method: VERIFY_BASELINE_METHOD,
    state: 'compared',
    baseRef: baseSha.slice(0, 12),
    verdict: baselineVerdict(results),
    results,
    newCount,
    preExistingCount,
    inconclusiveCount,
    cleanup: temp.cleanup,
  };
}

export function retryBaselineCleanup(context: VerifyContext, path: string): void {
  void removeDetachedWorktree(context.repoRoot, path).then((result) => {
    if (result.cleanup === 'removed') context.baselineTrees.delete(path);
  }).catch(() => undefined);
}

/** Ledger line (numbers only), a note on the manager and on the worker, and the report-file section. */
function recordVerify(context: VerifyContext, caller: RunRecord, target: RunRecord, result: DispatchVerifyResult): void {
  const id8 = target.id.slice(0, 8);
  const rootRunId = target.dispatch?.rootRunId ?? caller.id;
  const failed = result.results.filter((entry) => entry.outcome === 'failed' || entry.outcome === 'timed-out').length;
  appendLedger(context.dataDir, rootRunId, {
    type: 'verify',
    runId: caller.id,
    targetRunId: target.id,
    state: result.state,
    source: result.source,
    commands: result.results.length,
    failed,
    ...(result.headCommit ? { headCommit: result.headCommit } : {}),
    durationMs: result.durationMs,
    runsUsed: result.runsUsed,
  });
  const redact = (text: string) => context.store.redactRunText(target.id, text);
  const detail = result.state === 'unavailable'
    ? `unavailable: ${result.reason ?? result.reasonCode}`
    : `${result.state} — ${verifySummary(result.results)} (${result.runsUsed} of ${result.runsMax} runs used)`;
  context.store.appendEvent(caller.id, {
    type: 'note',
    stepId: context.currentStepId(caller.id),
    message: redact(`verify ${id8} "${target.title}": ${detail}`),
    ...(result.state === 'failed' ? { tone: 'danger' as const } : {}),
  });
  if (result.state === 'unavailable') return;
  context.store.appendEvent(target.id, {
    type: 'note',
    message: `verified by its manager: ${result.state}${result.headCommit ? ` @ ${result.headCommit}` : ''}`,
  });
  appendReportSection(
    context.dataDir,
    rootRunId,
    target.id,
    'Verification',
    redact(`- ${result.state} @ ${result.headCommit ?? 'unknown head'}, ${result.startedAt}\n- ${verifySummary(result.results)}`),
  );
}
