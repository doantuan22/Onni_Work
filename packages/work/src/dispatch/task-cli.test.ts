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

  it('peek refuses a bad tail or an id plus --all without calling the server', async () => {
    const h = harness({ status: 200, body: { workers: [], workersOmitted: 0 } });
    expect(await runTaskCommand(['peek', '--tail', '0'], env, h.io)).toBe(1);
    expect(h.err[0]).toContain('--tail must be 1-');
    expect(await runTaskCommand(['peek', 'abcd1234', '--all'], env, h.io)).toBe(1);
    expect(h.err[1]).toContain('name an id OR pass --all');
    expect(h.calls).toHaveLength(0);
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
});
