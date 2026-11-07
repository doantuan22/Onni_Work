import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_CHECKS_MAX } from '@onni/contract';
import { RUNNER_IDS } from '../core/agent-runner.ts';
import { runTaskCommand, type TaskCliIo } from './task-cli.ts';

function containsRunnerToken(text: string, runner: string): boolean {
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${runner}(?=$|[^A-Za-z0-9_-])`).test(text);
}

/** The `onni task` CLI is a thin client: what is pinned is the request it builds from flags and
 *  env, and how it answers a refusal — never the engine, which has its own tests. */
describe('onni task', () => {
  const env = { ONNI_API_URL: 'http://127.0.0.1:4321/', ONNI_PROJECT_ID: 'proj', ONNI_TASK_ID: 'run-1' };

  const harness = (reply: { status: number; body: unknown }) => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const out: string[] = [];
    const err: string[] = [];
    const io: TaskCliIo = {
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    };
    return { calls, out, err, io };
  };

  /** Like `harness`, but each call gets the next reply — `plan set` reads then writes. */
  const sequence = (replies: Array<{ status: number; body: unknown }>) => {
    let index = 0;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const out: string[] = [];
    const err: string[] = [];
    const io: TaskCliIo = {
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        const reply = replies[Math.min(index, replies.length - 1)]!;
        index += 1;
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    };
    return { calls, out, err, io };
  };

  it('create posts the task order to the parent’s dispatch route, scoped to the project', async () => {
    const h = harness({ status: 201, body: { id: 'child-1', branch: 'onni/child1' } });
    const code = await runTaskCommand(
      ['create', 'Review the login flow', '--title', 'Review login', '--kind', 'review', '--review-of', 'onni/abc', '--budget', '2.5', '--tools', 'Read,Bash', '--scope', 'src/auth/**'],
      env,
      h.io,
    );
    expect(code).toBe(0);
    expect(h.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/dispatch');
    expect(JSON.parse(String(h.calls[0]?.init?.body))).toEqual({
      objective: 'Review the login flow',
      title: 'Review login',
      kind: 'review',
      review_of: ['onni/abc'],
      scope: 'src/auth/**',
      max_cost: 2.5,
      allowed_tools: ['Read', 'Bash'],
    });
    expect(h.out[0]).toContain('dispatched child-1 on branch onni/child1');
  });

  it('create surfaces a refusal with the server’s reason and a non-zero exit', async () => {
    const h = harness({ status: 409, body: { error: 'no budget left' } });
    expect(await runTaskCommand(['create', 'x'], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('dispatch refused — no budget left');
  });

  it('reads a 404 on a route the running server lacks as a version mismatch (H4)', async () => {
    const h = harness({ status: 404, body: { error: 'not found' } });
    expect(await runTaskCommand(['report', '--status', 'done', '--result', 'r'], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('server does not support this command yet — restart Onni (CLI and server versions differ)');
    expect(h.err[0]).not.toContain('not found');
  });

  it('keeps a 403 or 409 refusal prefixed with what was attempted', async () => {
    const forbidden = harness({ status: 403, body: { error: 'only the manager of a manager–worker task can merge' } });
    expect(await runTaskCommand(['merge', 'onni/abc'], env, forbidden.io)).toBe(1);
    expect(forbidden.err[0]).toContain('merge refused — only the manager of a manager–worker task can merge');
    const conflict = harness({ status: 409, body: { error: 'run 1234 belongs to another task tree' } });
    expect(await runTaskCommand(['report', '--status', 'done', '--result', 'r'], env, conflict.io)).toBe(1);
    expect(conflict.err[0]).toContain('report refused — run 1234 belongs to another task tree');
  });

  it('turns an unreachable cockpit into one line, not a raw fetch error', async () => {
    const err: string[] = [];
    const io: TaskCliIo = {
      fetch: (async () => {
        throw new Error('connect ECONNREFUSED');
      }) as typeof fetch,
      log: () => {},
      error: (line) => err.push(line),
    };
    expect(await runTaskCommand(['list'], env, io)).toBe(1);
    expect(err[0]).toBe('onni task: could not reach the cockpit — connect ECONNREFUSED');
  });

  it('report posts the report with array defaults filled and the verdict', async () => {
    const h = harness({ status: 200, body: { ok: true } });
    const code = await runTaskCommand(
      ['report', '--status', 'done', '--result', 'all green', '--evidence', 'npm test → 3 passed', '--evidence', 'src/a.ts:1', '--verdict', 'approve', '--suggestions', 'split billing'],
      env,
      h.io,
    );
    expect(code).toBe(0);
    expect(h.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/report');
    expect(JSON.parse(String(h.calls[0]?.init?.body))).toEqual({
      status: 'done',
      result: 'all green',
      evidence: ['npm test → 3 passed', 'src/a.ts:1'],
      checks: [],
      side_effects: [],
      errors: [],
      suggestions: ['split billing'],
      verdict: 'approve',
    });
  });

  it('sends --check entries, splitting on the last "=" so the command may set variables', async () => {
    const h = harness({ status: 200, body: { ok: true } });
    const code = await runTaskCommand(
      ['report', '--status', 'done', '--result', 'r', '--check', 'npm test=0', '--check', 'FOO=1 npm test=2'],
      env,
      h.io,
    );
    expect(code).toBe(0);
    expect(JSON.parse(String(h.calls[0]?.init?.body)).checks).toEqual([
      { command: 'npm test', exitCode: 0 },
      { command: 'FOO=1 npm test', exitCode: 2 },
    ]);
  });

  it('rejects a malformed --check with a clear error and sends nothing', async () => {
    const h = harness({ status: 200, body: { ok: true } });
    expect(await runTaskCommand(['report', '--status', 'done', '--result', 'r', '--check', 'npm test'], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('--check must be "<command>=<exit code>"');
    const empty = harness({ status: 200, body: { ok: true } });
    expect(await runTaskCommand(['report', '--status', 'done', '--result', 'r', '--check', '=0'], env, empty.io)).toBe(1);
    expect(empty.calls).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it('refuses more checks than a report can carry', async () => {
    const h = harness({ status: 200, body: { ok: true } });
    const args = [
      'report', '--status', 'done', '--result', 'r',
      ...Array.from({ length: REPORT_CHECKS_MAX + 1 }, (_, i) => ['--check', `c${i}=0`]).flat(),
    ];
    expect(await runTaskCommand(args, env, h.io)).toBe(1);
    expect(h.err[0]).toContain(`at most ${REPORT_CHECKS_MAX} --check entries`);
    expect(h.calls).toHaveLength(0);
  });

  it('falls back to the unscoped API without a project id, and refuses without a server', async () => {
    const h = harness({ status: 200, body: { ok: true } });
    await runTaskCommand(['report', '--status', 'done', '--result', 'r'], { ONNI_API_URL: 'http://127.0.0.1:1', ONNI_TASK_ID: 'r1' }, h.io);
    expect(h.calls[0]?.url).toBe('http://127.0.0.1:1/api/v1/runs/r1/report');
    const none = harness({ status: 200, body: {} });
    expect(await runTaskCommand(['create', 'x'], { ONNI_TASK_ID: 'r1' }, none.io)).toBe(2);
    expect(none.err[0]).toContain('ONNI_API_URL is not set');
    expect(none.err[0]).toContain('stop and report that dispatch is unavailable');
    expect(none.calls).toHaveLength(0);
    const shell = harness({ status: 200, body: {} });
    expect(await runTaskCommand(['tree', 'r1'], {}, shell.io)).toBe(2);
    expect(shell.err[0]).toContain('ONNI_API_URL=http://127.0.0.1:4321 onni task tree <run id>');
    expect(shell.err[0]).not.toContain('only works inside a task');
    expect(shell.calls).toHaveLength(0);
  });

  it('answers --help on a subcommand instead of refusing it as an unknown option', async () => {
    const h = harness({ status: 200, body: {} });
    expect(await runTaskCommand(['create', '--help'], env, h.io)).toBe(0);
    expect(h.out[0]).toContain('onni task create');
    expect(h.calls).toHaveLength(0);
  });

  it('advertises every supported runner in help as a standalone token', async () => {
    const h = harness({ status: 200, body: {} });
    expect(await runTaskCommand(['help'], {}, h.io)).toBe(0);
    for (const runner of RUNNER_IDS) expect(containsRunnerToken(h.out[0] ?? '', runner)).toBe(true);
  });

  it('budget prints the same line the brief and the settle report use', async () => {
    const h = harness({
      status: 200,
      body: { costUsd: 3.2, tokens: 120_000, minutes: 45, steps: 800, subtasks: 2, subtaskCap: 8, maxDepth: 1, overBudget: false },
    });
    expect(await runTaskCommand(['budget'], env, h.io)).toBe(0);
    expect(h.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/budget');
    expect(h.out[0]).toBe('cost $3.20 · 120k tokens · 45 min · 800 steps · 2 workers left (cap 8)');
  });

  it('peek asks once — compact for --all, with a tail for a named worker — and prints the blocks', async () => {
    const body = {
      workers: [{
        id: 'abcd1234-0000', title: 'A worker', status: 'running', tokensUsed: 0, files: ['src/a.ts'], filesOmitted: 0,
        filesState: 'ok', quietMinutes: 3, tail: ['recent line'], tailTruncated: false,
      }],
      workersOmitted: 1,
    };
    const all = harness({ status: 200, body });
    expect(await runTaskCommand(['peek', '--all'], env, all.io)).toBe(0);
    expect(all.calls).toHaveLength(1);
    expect(all.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/peek?all=1');
    expect(all.out[0]).toContain('abcd1234  running — A worker');
    expect(all.out[0]).toContain('files (1): src/a.ts');
    expect(all.out[0]).toContain('(+1 more worker not shown');
    const one = harness({ status: 200, body });
    expect(await runTaskCommand(['peek', 'abcd1234', '--tail', '5'], env, one.io)).toBe(0);
    expect(one.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/peek?target=abcd1234&tail=5');
    expect(one.out[0]).toContain('recent:\n  | recent line');
  });

  it('verify posts the target and --only, prints the verdict and maps the exit code', async () => {
    const result = (state: string) => ({
      state, source: 'required-checks', headCommit: 'abc1234', startedAt: 'now', durationMs: 2000,
      results: [{ command: 'npm test', outcome: state === 'passed' ? 'passed' : 'failed', exitCode: state === 'passed' ? 0 : 1, durationMs: 10, timedOut: false, tail: state === 'passed' ? [] : ['boom'], tailTruncated: false }],
      runsUsed: 2, runsMax: 3, warnings: [],
      ...(state === 'unavailable' ? { reasonCode: 'no-bash', reason: 'bash was not found' } : {}),
    });
    const passed = harness({ status: 200, body: result('passed') });
    expect(await runTaskCommand(['verify', 'abcd1234', '--only', 'npm test', '--only', 'npm run build'], env, passed.io)).toBe(0);
    expect(passed.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/verify');
    expect(JSON.parse(String(passed.calls[0]?.init?.body))).toEqual({ target: 'abcd1234', only: ['npm test', 'npm run build'] });
    expect(passed.out[0]).toContain('PASSED');
    expect(passed.out[0]).toContain('run 2 of 3');
    const failed = harness({ status: 200, body: result('failed') });
    expect(await runTaskCommand(['verify', 'abcd1234'], env, failed.io)).toBe(3);
    expect(JSON.parse(String(failed.calls[0]?.init?.body))).toEqual({ target: 'abcd1234' });
    expect(failed.out[0]).toContain('FAILED');
    expect(failed.out[0]).toContain('| boom');
    const unavailable = harness({ status: 200, body: result('unavailable') });
    expect(await runTaskCommand(['verify', 'abcd1234'], env, unavailable.io)).toBe(4);
    expect(unavailable.out[0]).toContain('UNAVAILABLE');
  });

  it('verify --baseline sends the opt-in, labels the heuristic and uses its verdict for the exit code', async () => {
    const body = {
      state: 'failed', source: 'required-checks', startedAt: 'now', durationMs: 100,
      results: [{ command: 'npm test', outcome: 'failed', exitCode: 1, durationMs: 10, timedOut: false, tail: ['FAIL new test'], tailTruncated: false }],
      runsUsed: 1, runsMax: 3, warnings: [],
      baseline: {
        method: 'heuristic', state: 'compared', baseRef: '123456789abc', verdict: 'new-failures',
        results: [{ command: 'npm test', classification: 'new-signatures', workerExitCode: 1, baselineExitCode: 1, newSignatures: ['FAIL new test'], newSignaturesOmitted: 0 }],
        newCount: 1, preExistingCount: 0, inconclusiveCount: 0, cleanup: 'removed',
      },
    };
    const fresh = harness({ status: 200, body });
    expect(await runTaskCommand(['verify', 'abcd1234', '--baseline'], env, fresh.io)).toBe(3);
    expect(JSON.parse(String(fresh.calls[0]?.init?.body))).toEqual({ target: 'abcd1234', baseline: true });
    expect(fresh.out[0]).toContain('baseline (HEURISTIC, at 123456789abc)');
    expect(fresh.out[0]).toContain('NEW npm test: FAIL new test');
    expect(fresh.out[0]).toContain('a flaky or renamed test can be misclassified');

    const cleanAgainstBase = harness({ status: 200, body: { ...body, baseline: { ...body.baseline, verdict: 'no-new-failures' } } });
    expect(await runTaskCommand(['verify', 'abcd1234', '--baseline'], env, cleanAgainstBase.io)).toBe(0);
    const unclear = harness({ status: 200, body: { ...body, baseline: { ...body.baseline, verdict: 'inconclusive' } } });
    expect(await runTaskCommand(['verify', 'abcd1234', '--baseline'], env, unclear.io)).toBe(4);
  });

  it('verify needs one worker id, prints a refusal with its prefix and the version sentence on 404', async () => {
    const none = harness({ status: 200, body: {} });
    expect(await runTaskCommand(['verify'], env, none.io)).toBe(1);
    expect(none.err[0]).toContain('a worker id is required');
    expect(none.calls).toHaveLength(0);
    const refused = harness({ status: 409, body: { error: 'worker abcd1234 is still running' } });
    expect(await runTaskCommand(['verify', 'abcd1234'], env, refused.io)).toBe(1);
    expect(refused.err[0]).toContain('verify refused — worker abcd1234 is still running');
    const old = harness({ status: 404, body: { error: 'x' } });
    expect(await runTaskCommand(['verify', 'abcd1234'], env, old.io)).toBe(1);
    expect(old.err[0]).toContain('server does not support this command yet');
  });

  it('conflicts fetches an advisory report with or without one target and returns success for conflicts', async () => {
    const body = {
      workers: [
        { id: 'worker-a', title: 'A', status: 'done', filesCount: 1, filesTruncated: false, filesState: 'ok', scopeState: 'none', outsideScope: [], outsideScopeOmitted: 0 },
        { id: 'worker-b', title: 'B', status: 'done', filesCount: 1, filesTruncated: false, filesState: 'ok', scopeState: 'none', outsideScope: [], outsideScopeOmitted: 0 },
      ],
      workersOmitted: 0,
      overlaps: [{ a: 'worker-a', b: 'worker-b', files: ['src/shared.ts'], filesOmitted: 0 }],
      overlapsOmitted: 0,
      trialMerges: [],
      trialMergesSkipped: 0,
      trialState: 'ran',
      checkedAt: 'now',
    };
    const all = harness({ status: 200, body });
    expect(await runTaskCommand(['conflicts'], env, all.io)).toBe(0);
    expect(all.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/conflicts');
    expect(all.out[0]).toContain('advisory only');
    expect(all.out[0]).toContain('overlap (1 file): worker-a and worker-b');

    const one = harness({ status: 200, body });
    expect(await runTaskCommand(['conflicts', 'worker-b'], env, one.io)).toBe(0);
    expect(one.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/conflicts?target=worker-b');
  });

  it('conflicts accepts at most one target and reports refusals and version mismatch', async () => {
    const tooMany = harness({ status: 200, body: {} });
    expect(await runTaskCommand(['conflicts', 'a', 'b'], env, tooMany.io)).toBe(1);
    expect(tooMany.err[0]).toContain('usage: onni task conflicts');
    expect(tooMany.calls).toHaveLength(0);
    const refused = harness({ status: 409, body: { error: 'target is outside the task tree' } });
    expect(await runTaskCommand(['conflicts', 'worker-a'], env, refused.io)).toBe(1);
    expect(refused.err[0]).toContain('conflicts refused — target is outside the task tree');
    const old = harness({ status: 404, body: { error: 'x' } });
    expect(await runTaskCommand(['conflicts'], env, old.io)).toBe(1);
    expect(old.err[0]).toContain('server does not support this command yet');
  });

  it('peek refuses a bad tail or an id plus --all without calling the server', async () => {
    const h = harness({ status: 200, body: { workers: [], workersOmitted: 0 } });
    expect(await runTaskCommand(['peek', '--tail', '0'], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('--tail must be 1-');
    expect(await runTaskCommand(['peek', 'abcd1234', '--all'], env, h.io)).toBe(1);
    expect(h.err[1]).toContain('name an id OR pass --all');
    expect(h.calls).toHaveLength(0);
  });

  it('ask posts a non-blocking question to this run’s ask route and names the id to watch for', async () => {
    const h = harness({ status: 200, body: { requestId: 'abc-123' } });
    expect(await runTaskCommand(['ask', 'Postgres or SQLite?', '--option', 'Postgres', '--option', 'SQLite', '--timeout', '30'], env, h.io)).toBe(0);
    expect(h.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/ask');
    expect(JSON.parse(String(h.calls[0]?.init?.body))).toEqual({
      question: 'Postgres or SQLite?',
      options: [{ label: 'Postgres' }, { label: 'SQLite' }],
      timeoutMinutes: 30,
    });
    expect(h.out[0]).toContain('asked the user — question abc-123');
    expect(h.out[0]).toContain('Keep working');
  });

  it('ask refuses an empty question or an out-of-range timeout without calling the server', async () => {
    const h = harness({ status: 200, body: { requestId: 'x' } });
    expect(await runTaskCommand(['ask', '   '], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('a question is required');
    expect(await runTaskCommand(['ask', 'why?', '--timeout', '0'], env, h.io)).toBe(1);
    expect(h.err[1]).toContain('--timeout must be 1-');
    expect(h.calls).toHaveLength(0);
  });

  it('ask surfaces the manager’s refusal (a second open question) as "ask refused"', async () => {
    const h = harness({ status: 409, body: { error: 'one open question per task — answer the current one first' } });
    expect(await runTaskCommand(['ask', 'and another thing?'], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('ask refused — one open question per task');
  });

  it('memory add posts the lesson to this run’s memory route and reports the new size', async () => {
    const h = harness({ status: 200, body: { content: '- a lesson\n', bytes: 42, maxBytes: 3072, revision: 'abcd1234' } });
    expect(await runTaskCommand(['memory', 'add', 'build', 'the', 'server', 'first'], env, h.io)).toBe(0);
    expect(h.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/memory');
    expect(JSON.parse(String(h.calls[0]?.init?.body))).toEqual({ entry: 'build the server first' });
    expect(h.out[0]).toBe('memory now 42/3072 bytes');
  });

  it('memory refuses an empty lesson or a subcommand it does not answer, without calling the server', async () => {
    const h = harness({ status: 200, body: {} });
    expect(await runTaskCommand(['memory', 'add', '  '], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('memory add needs a lesson');
    expect(await runTaskCommand(['memory', 'read'], env, h.io)).toBe(1);
    expect(h.err[1]).toContain('usage: onni task memory add');
    expect(await runTaskCommand(['memory'], env, h.io)).toBe(1);
    expect(h.calls).toHaveLength(0);
  });

  it('memory surfaces a full-memory refusal as "could not save memory"', async () => {
    const h = harness({ status: 409, body: { error: 'memory is full — ask the user to prune it in Settings' } });
    expect(await runTaskCommand(['memory', 'add', 'one more'], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('could not save memory — memory is full');
  });

  it('list prints the tree this task belongs to, indented, with status, cost and verdicts', async () => {
    const h = harness({
      status: 200,
      body: [
        { id: 'root-0000', title: 'Root', status: 'running', costUsd: 1.5, dispatch: { rootRunId: 'root-0000' } },
        { id: 'run-1', title: 'Me', status: 'running', costUsd: 0.2, branch: 'onni/run1', dispatch: { rootRunId: 'root-0000', parentRunId: 'root-0000' } },
        { id: 'kid-0000', title: 'Kid', status: 'done', costUsd: 0.1, dispatch: { rootRunId: 'root-0000', parentRunId: 'run-1', kind: 'review', report: { status: 'done', verdict: 'approve' } } },
        { id: 'other', title: 'Unrelated', status: 'done' },
      ],
    });
    expect(await runTaskCommand(['list'], env, h.io)).toBe(0);
    expect(h.out).toEqual([
      'root-000  running $1.50  Root',
      '  run-1  running $0.20  Me  [onni/run1]',
      '    kid-0000  done $0.10  Kid → done (approve)',
    ]);
  });

  it('create --part carries the plan part id in the dispatch body', async () => {
    const h = harness({ status: 201, body: { id: 'child-1' } });
    expect(await runTaskCommand(['create', 'x', '--part', 'p1'], env, h.io)).toBe(0);
    expect(JSON.parse(String(h.calls[0]?.init?.body))).toEqual({ objective: 'x', partId: 'p1' });
  });

  it('plan show prints the plan header and one sanitized line per part', async () => {
    const h = harness({
      status: 200,
      body: {
        parts: [
          { id: 'p1', title: '## Parse the config\nnow', status: 'planned', worker: 'codex', after: ['p0'] },
          { id: 'p2', title: 'Wire the route', status: 'assigned', runId: 'abcd1234-0000' },
        ],
        updatedAt: '2026-11-03T10:00:00.000Z',
        revision: 'rev1',
      },
    });
    expect(await runTaskCommand(['plan', 'show'], env, h.io)).toBe(0);
    expect(h.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/plan');
    expect(h.calls[0]?.init?.method).toBe('GET');
    expect(h.out[0]).toBe('plan: 2 parts · revision rev1 · updated 2026-11-03T10:00:00.000Z');
    expect(h.out[1]).toBe('- [planned] p1: Parse the config now — worker: codex · after: p0');
    expect(h.out[2]).toBe('- [assigned] p2: Wire the route — run: abcd1234');
  });

  it('plan with no subcommand shows the plan, and an empty plan says how to start one', async () => {
    const h = harness({ status: 200, body: { parts: [], updatedAt: '', revision: '0' } });
    expect(await runTaskCommand(['plan'], env, h.io)).toBe(0);
    expect(h.out[0]).toBe('no plan yet — write one with: onni task plan set --json @plan.json');
  });

  it('plan set reads the current revision and then replaces every part', async () => {
    const h = sequence([
      { status: 200, body: { parts: [], updatedAt: '', revision: 'rev0' } },
      { status: 200, body: { parts: [{ id: 'p1', title: 'Ship it', status: 'planned' }], updatedAt: '2026-11-03T10:00:00.000Z', revision: 'rev1' } },
    ]);
    const parts = [{ id: 'p1', title: 'Ship it', status: 'planned' }];
    expect(await runTaskCommand(['plan', 'set', '--json', JSON.stringify(parts)], env, h.io)).toBe(0);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]?.init?.method).toBe('GET');
    expect(h.calls[1]?.init?.method).toBe('PUT');
    expect(JSON.parse(String(h.calls[1]?.init?.body))).toEqual({ parts, revision: 'rev0' });
    expect(h.out[0]).toBe('plan saved: 1 part · revision rev1');
  });

  it('plan set accepts an object with "parts" and a @file to avoid quoting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onni-plan-cli-'));
    try {
      const file = join(dir, 'plan.json');
      const parts = [{ id: 'p1', title: 'Ship it', status: 'planned' }];
      writeFileSync(file, JSON.stringify({ parts }));
      const h = sequence([
        { status: 200, body: { parts: [], updatedAt: '', revision: 'rev0' } },
        { status: 200, body: { parts, updatedAt: '', revision: 'rev1' } },
      ]);
      expect(await runTaskCommand(['plan', 'set', '--json', `@${file}`], env, h.io)).toBe(0);
      expect(JSON.parse(String(h.calls[1]?.init?.body))).toEqual({ parts, revision: 'rev0' });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('plan set refuses bad JSON or a shape without a parts array, without calling the server', async () => {
    const h = sequence([{ status: 200, body: { parts: [], updatedAt: '', revision: '0' } }]);
    expect(await runTaskCommand(['plan', 'set', '--json', '{ nope'], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('--json is not valid JSON');
    expect(await runTaskCommand(['plan', 'set', '--json', '{"parts": "x"}'], env, h.io)).toBe(1);
    expect(h.err[1]).toContain('the plan must be an array of parts');
    expect(await runTaskCommand(['plan', 'set'], env, h.io)).toBe(1);
    expect(h.err[2]).toContain('plan set needs --json');
    expect(h.calls).toHaveLength(0);
  });

  it('plan update PATCHes one part with its status and run', async () => {
    const h = harness({ status: 200, body: { parts: [{ id: 'p1', title: 'Ship it', status: 'done', runId: 'abcd1234-0000' }], updatedAt: '', revision: 'rev2' } });
    expect(await runTaskCommand(['plan', 'update', '--part', 'p1', '--status', 'done', '--run', 'abcd1234'], env, h.io)).toBe(0);
    expect(h.calls[0]?.url).toBe('http://127.0.0.1:4321/api/v1/p/proj/runs/run-1/plan/parts/p1');
    expect(h.calls[0]?.init?.method).toBe('PATCH');
    expect(JSON.parse(String(h.calls[0]?.init?.body))).toEqual({ status: 'done', runId: 'abcd1234' });
    expect(h.out[0]).toBe('plan part "p1" → [done]');
  });

  it('plan update refuses a missing part or nothing to change, without calling the server', async () => {
    const h = harness({ status: 200, body: { parts: [] } });
    expect(await runTaskCommand(['plan', 'update', '--status', 'done'], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('plan update needs --part');
    expect(await runTaskCommand(['plan', 'update', '--part', 'p1'], env, h.io)).toBe(1);
    expect(h.err[1]).toContain('plan update needs --status and/or --run');
    expect(h.calls).toHaveLength(0);
  });

  it('plan surfaces a stale-revision refusal and an unknown subcommand', async () => {
    const stale = sequence([
      { status: 200, body: { parts: [], updatedAt: '', revision: 'rev0' } },
      { status: 409, body: { error: 'plan changed in another window' } },
    ]);
    expect(await runTaskCommand(['plan', 'set', '--json', '[]'], env, stale.io)).toBe(1);
    expect(stale.err[0]).toContain('could not save the plan — plan changed in another window');
    const unknown = harness({ status: 200, body: {} });
    expect(await runTaskCommand(['plan', 'nope'], env, unknown.io)).toBe(1);
    expect(unknown.err[0]).toContain('usage: onni task plan show');
    expect(unknown.calls).toHaveLength(0);
  });

  it('plan needs ONNI_TASK_ID like the other manager commands', async () => {
    const h = harness({ status: 200, body: {} });
    expect(await runTaskCommand(['plan', 'show'], { ONNI_API_URL: 'http://127.0.0.1:4321' }, h.io)).toBe(1);
    expect(h.err[0]).toContain('ONNI_TASK_ID is not set');
    expect(h.calls).toHaveLength(0);
  });
});
