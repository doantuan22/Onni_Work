/**
 * `onni task …` — the CLI a running agent uses to dispatch other tasks and to report
 * (spec `.ai/specs/2026-09-10-dispatch.md`).
 *
 * It is a thin HTTP client over the dispatch family, addressed by three variables the engine puts
 * in every agent's environment while dispatch is on (the default; `ONNI_DISPATCH=0` turns it off): `ONNI_API_URL` (the cockpit), `ONNI_PROJECT_ID`
 * (which project the run belongs to) and `ONNI_TASK_ID` (the run itself). A human at a shell can
 * set the same three and use it too. No server, no dispatch: the command says so (`cockpit-address.ts`,
 * worded for whoever is asking) and exits 2.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { MANAGER_ASK_TIMEOUT_MINUTES_MAX, MANAGER_CANCEL_REASON_MAX_CHARS, MANAGER_MESSAGE_MAX_CHARS, MANAGER_REDIRECT_INSTRUCTION_MAX_CHARS, REPORT_CHECKS_MAX, PEEK_TAIL_MAX_LINES, VERIFY_TOTAL_TIMEOUT_MS, rosterWorkerKey, rosterWorkerSchema, type DispatchBudget, type DispatchConflicts, type DispatchManagerCancelResult, type DispatchManagerMessageResult, type DispatchManagerRedirectResult, type DispatchPeek, type DispatchVerifyResult, type ManagerMemoryRead, type Roster, type RosterWorker, type TreePlan } from '@onni/contract';
import { missingCockpitMessage } from '../cockpit-address.ts';
import { formatBudgetLine } from './budget-format.ts';
import { formatPeek } from './peek.ts';
import { formatVerify } from './verify.ts';
import { formatConflicts } from './conflicts.ts';
import { sanitizeMemoryEntry } from './memory.ts';
import { taskUsage } from './commands.ts';

export interface TaskCliEnv {
  ONNI_API_URL?: string;
  ONNI_PROJECT_ID?: string;
  ONNI_TASK_ID?: string;
}

export interface TaskCliIo {
  fetch: typeof fetch;
  log: (line: string) => void;
  error: (line: string) => void;
}

const USAGE = `onni task — dispatch onni tasks from inside a task (on by default; ONNI_DISPATCH=0 on the cockpit turns it off)

${taskUsage()}`;

function base(env: TaskCliEnv): { url: string; scope: string } | null {
  const url = env.ONNI_API_URL?.replace(/\/+$/, '');
  if (!url) return null;
  const scope = env.ONNI_PROJECT_ID ? `${url}/api/v1/p/${encodeURIComponent(env.ONNI_PROJECT_ID)}` : `${url}/api/v1`;
  return { url, scope };
}

async function readError(response: Response): Promise<{ message: string; body?: unknown }> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      return { message: body.error, body };
    }
    return { message: `${response.status} ${response.statusText}`, body };
  } catch {
    // not JSON
  }
  return { message: `${response.status} ${response.statusText}` };
}

type RefusalFormatter = (status: number, body: unknown, reason: string) => string;

/**
 * One wrapper for every call this CLI makes. A 404 on a route the running server does not know is a
 * VERSION mismatch, not "no such run": saying so beats printing a bare status and sending the agent
 * looking for a bug in its own order (plan v2 §5 H4).
 */
async function callRoute(
  api: { url: string; scope: string },
  io: TaskCliIo,
  path: string,
  init: RequestInit,
  refusalPrefix?: string | RefusalFormatter,
): Promise<unknown> {
  let response: Response;
  try {
    response = await io.fetch(`${api.scope}${path}`, init);
  } catch (error) {
    throw new Error(`could not reach the cockpit — ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    if (response.status === 404) throw new Error('server does not support this command yet — restart Onni (CLI and server versions differ)');
    const failure = await readError(response);
    if (typeof refusalPrefix === 'function') throw new Error(refusalPrefix(response.status, failure.body, failure.message));
    throw new Error(refusalPrefix ? `${refusalPrefix} ${failure.message}` : failure.message);
  }
  return response.json();
}

function number(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

/**
 * `<command>=<exit code>`, split on the LAST `=`, so a command that sets variables still reads
 * right (`FOO=1 npm test=0`). A claim by the worker — the report labels it worker-reported.
 */
function checkArg(raw: string): { command: string; exitCode: number } {
  const match = /^(.+)=(-?\d+)$/s.exec(raw);
  const command = match?.[1]?.trim();
  if (!match || !command) throw new Error(`--check must be "<command>=<exit code>", got "${raw}"`);
  return { command, exitCode: Number(match[2]) };
}

function formatRoster(roster: Roster): string {
  return [`Manager: ${roster.manager.runner}${roster.manager.model ? `:${roster.manager.model}` : ''}`,
    ...roster.workers.map((worker) => `- ${worker.runner}${worker.model ? `:${worker.model}` : ''}${worker.role ? ` — ${worker.role}` : ''}${worker.tier ? ` [${worker.tier}]` : ''}${worker.kinds?.length ? ` (${worker.kinds.join(', ')})` : ''}; concurrent ${worker.maxConcurrent}`),
  ].join('\n');
}

function workerIdentity(raw: string): Pick<RosterWorker, 'runner'> & { model?: string } {
  const separator = raw.indexOf(':');
  const runner = (separator < 0 ? raw : raw.slice(0, separator)).trim();
  const model = separator < 0 ? undefined : raw.slice(separator + 1).trim();
  if (!runner || (separator >= 0 && !model)) throw new Error('worker must be <backend> or <backend:model>');
  return { runner, ...(model ? { model } : {}) };
}

export async function runTaskCommand(
  args: string[],
  env: TaskCliEnv = process.env,
  io: TaskCliIo = { fetch, log: console.log, error: console.error },
): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help') {
    io.log(USAGE);
    return command ? 0 : 2;
  }
  const api = base(env);
  if (!api) {
    io.error(missingCockpitMessage({
      command: 'onni task',
      example: 'onni task tree <run id>',
      insideTask: 'this command only works inside a task run by a cockpit with dispatch on (it is on by default; ONNI_DISPATCH=0 turns it off). Do not substitute sub-agents or do the delegated work yourself: stop and report that dispatch is unavailable.',
    }, env));
    return 2;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    io.log(USAGE);
    return 0;
  }

  try {
    switch (command) {
      case 'create': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: {
            title: { type: 'string' },
            kind: { type: 'string' },
            'review-of': { type: 'string', multiple: true },
            scope: { type: 'string' },
            budget: { type: 'string' },
            success: { type: 'string' },
            evidence: { type: 'string' },
            tools: { type: 'string' },
            backend: { type: 'string' },
            runner: { type: 'string' },
            model: { type: 'string' },
            'retry-limit': { type: 'string' },
            after: { type: 'string', multiple: true },
            part: { type: 'string' },
          },
        });
        const objective = positionals.join(' ').trim();
        if (!objective) throw new Error('an objective is required: onni task create "<objective>"');
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can dispatch');
        const body = {
          objective,
          ...(values.title ? { title: values.title } : {}),
          ...(values.kind ? { kind: values.kind } : {}),
          ...(values['review-of']?.length ? { review_of: values['review-of'] } : {}),
          ...(values.scope ? { scope: values.scope } : {}),
          ...(values.budget !== undefined ? { max_cost: number(values.budget, 'budget') } : {}),
          ...(values.success ? { success_criteria: values.success } : {}),
          ...(values.evidence ? { required_evidence: values.evidence } : {}),
          ...(values.tools ? { allowed_tools: values.tools.split(',').map((tool) => tool.trim()).filter(Boolean) } : {}),
          // --backend is the name; --runner stays as the compatible alias.
          ...(values.backend ? { backend: values.backend } : {}),
          ...(values.runner ? { runner: values.runner } : {}),
          ...(values.model ? { model: values.model } : {}),
          ...(values['retry-limit'] !== undefined ? { retry_limit: number(values['retry-limit'], 'retry-limit') } : {}),
          ...(values.after?.length ? { after: values.after } : {}),
          ...(values.part ? { partId: values.part } : {}),
        };
        const created = (await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/dispatch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }, 'dispatch refused —')) as { id: string; branch?: string };
        io.log(`dispatched ${created.id}${created.branch ? ` on branch ${created.branch}` : ''}`);
        io.log('It reports into this session when it settles. End your turn with ONNI:MONITORING to wait for it.');
        return 0;
      }
      case 'ask': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { option: { type: 'string', multiple: true }, timeout: { type: 'string' } },
        });
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can ask');
        const question = positionals.join(' ').trim();
        if (!question) throw new Error('a question is required: onni task ask "<question>"');
        const timeout = number(values.timeout, 'timeout');
        if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 1 || timeout > MANAGER_ASK_TIMEOUT_MINUTES_MAX)) {
          throw new Error(`--timeout must be 1-${MANAGER_ASK_TIMEOUT_MINUTES_MAX} minutes`);
        }
        const asked = (await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/ask`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            question,
            ...(values.option?.length ? { options: values.option.map((label) => ({ label })) } : {}),
            ...(timeout !== undefined ? { timeoutMinutes: timeout } : {}),
          }),
        }, 'ask refused —')) as { requestId: string };
        io.log(`asked the user — question ${asked.requestId}. Keep working: the answer arrives as a message that names this question.`);
        return 0;
      }
      case 'report': {
        const { values } = parseArgs({
          args: rest,
          allowPositionals: false,
          options: {
            status: { type: 'string' },
            result: { type: 'string' },
            evidence: { type: 'string', multiple: true },
            check: { type: 'string', multiple: true },
            verdict: { type: 'string' },
            suggestions: { type: 'string', multiple: true },
            confidence: { type: 'string' },
            'side-effect': { type: 'string', multiple: true },
            error: { type: 'string', multiple: true },
            next: { type: 'string' },
          },
        });
        if (!values.status || !values.result) throw new Error('--status and --result are required');
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can report');
        const checks = (values.check ?? []).map(checkArg);
        if (checks.length > REPORT_CHECKS_MAX) throw new Error(`at most ${REPORT_CHECKS_MAX} --check entries`);
        const body = {
          status: values.status,
          result: values.result,
          evidence: values.evidence ?? [],
          side_effects: values['side-effect'] ?? [],
          errors: values.error ?? [],
          checks,
          suggestions: values.suggestions ?? [],
          ...(values.verdict ? { verdict: values.verdict } : {}),
          ...(values.confidence !== undefined ? { confidence: number(values.confidence, 'confidence') } : {}),
          ...(values.next ? { recommended_next_action: values.next } : {}),
        };
        await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/report`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }, 'report refused —');
        io.log(`report recorded — status ${values.status}${values.verdict ? `, verdict ${values.verdict}` : ''}. It is delivered to your parent when this task settles.`);
        return 0;
      }
      case 'merge': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { 'to-base': { type: 'boolean' }, abort: { type: 'boolean' } },
        });
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can merge');
        const into = values['to-base'] ? 'base' : 'task';
        const source = positionals[0];
        if (into === 'task' && !values.abort && !source) throw new Error('name what to merge: onni task merge <run id or branch>  (or --to-base, or --abort)');
        const result = (await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/merge`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ into, ...(source ? { source } : {}), ...(values.abort ? { abort: true } : {}) }),
        }, 'merge refused —')) as { outcome: string; message: string };
        io.log(`${result.outcome}: ${result.message}`);
        return result.outcome === 'conflict' ? 3 : 0;
      }
      case 'budget': {
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can read its budget');
        const budget = (await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/budget`, {
          method: 'GET',
        }, 'could not read the budget —')) as DispatchBudget;
        io.log(formatBudgetLine(budget));
        return 0;
      }
      case 'roster': {
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can read or change its roster');
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: {
            role: { type: 'string' }, tier: { type: 'string' }, kinds: { type: 'string' }, concurrent: { type: 'string' },
          },
        });
        const action = positionals[0];
        if (!action) {
          if (positionals.length) throw new Error('usage: onni task roster [add <backend[:model]> | remove <backend[:model]>]');
          const result = await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/roster`, { method: 'GET' }, 'could not read the roster —') as { roster: Roster };
          io.log(formatRoster(result.roster));
          return 0;
        }
        if (action !== 'add' && action !== 'remove') throw new Error('usage: onni task roster [add <backend[:model]> [--role <text>] [--tier light|standard|heavy] [--kinds implement,test,explore,review] [--concurrent N] | remove <backend[:model]>]');
        const identity = workerIdentity(positionals[1] ?? '');
        if (positionals.length !== 2) throw new Error(`usage: onni task roster ${action} <backend[:model]>`);
        if (action === 'remove' && (values.role !== undefined || values.tier !== undefined || values.kinds !== undefined || values.concurrent !== undefined)) {
          throw new Error('roster remove does not accept worker options');
        }
        const current = await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/roster`, { method: 'GET' }, 'could not read the roster —') as { roster: Roster };
        let workers = [...current.roster.workers];
        if (action === 'add') {
          const rawConcurrent = number(values.concurrent, 'concurrent');
          const candidate = rosterWorkerSchema.safeParse({
            ...identity,
            ...(values.role !== undefined ? { role: values.role } : {}),
            ...(values.tier !== undefined ? { tier: values.tier } : {}),
            ...(values.kinds !== undefined ? { kinds: values.kinds.split(',').map((kind) => kind.trim()).filter(Boolean) } : {}),
            ...(rawConcurrent !== undefined ? { maxConcurrent: rawConcurrent } : {}),
          });
          if (!candidate.success) throw new Error(`invalid worker: ${candidate.error.issues.map((issue) => issue.message).join('; ')}`);
          workers.push(candidate.data);
        } else {
          workers = workers.filter((worker) => rosterWorkerKey(worker) !== rosterWorkerKey(identity));
          if (workers.length === current.roster.workers.length) throw new Error(`worker ${rosterWorkerKey(identity)} is not in the current roster`);
          if (!workers.length) throw new Error('the roster must keep at least one worker');
        }
        const updated = await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/roster`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workers }),
        }, (status, _body, reason) => `roster ${action} refused (${status === 409 ? 'conflict' : status === 400 ? 'invalid roster' : status}) — ${reason}`) as { roster: Roster };
        io.log(`roster updated\n${formatRoster(updated.roster)}`);
        return 0;
      }
      case 'peek': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { all: { type: 'boolean' }, tail: { type: 'string' } },
        });
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can peek');
        const target = positionals[0];
        if (target && values.all) throw new Error('name an id OR pass --all, not both');
        const tail = number(values.tail, 'tail');
        if (tail !== undefined && (!Number.isInteger(tail) || tail < 1 || tail > PEEK_TAIL_MAX_LINES)) {
          throw new Error(`--tail must be 1-${PEEK_TAIL_MAX_LINES}`);
        }
        const params = new URLSearchParams();
        if (target) params.set('target', target);
        if (values.all) params.set('all', '1');
        if (tail !== undefined) params.set('tail', String(tail));
        const query = params.toString();
        const peek = (await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/peek${query ? `?${query}` : ''}`, {
          method: 'GET',
        }, 'could not peek —')) as DispatchPeek;
        io.log(formatPeek(peek));
        return 0;
      }
      case 'message': {
        const { positionals } = parseArgs({ args: rest, allowPositionals: true, options: {} });
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can message a worker');
        if (positionals.length !== 2 || !positionals[0]?.trim()) {
          throw new Error('usage: onni task message <worker id> "<text>"');
        }
        const [target, rawText] = positionals;
        const text = rawText?.trim() ?? '';
        if (!text || text.length > MANAGER_MESSAGE_MAX_CHARS) {
          throw new Error(`message text must be 1-${MANAGER_MESSAGE_MAX_CHARS} characters`);
        }
        const result = (await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/worker-message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target, text }),
        }, 'message refused —')) as DispatchManagerMessageResult;
        const detail = `manager message ${result.deliveryId.slice(0, 8)} to ${target}: ${result.state} (${result.capability})${result.reasonCode ? ` — ${result.reasonCode}` : ''}`;
        const caveat = 'adapter acceptance is not proof the worker read or understood it';
        if (result.state === 'rejected' || result.state === 'expired') {
          io.error(`${detail}; ${caveat}`);
          return 3;
        }
        io.log(`${detail}; ${caveat}`);
        return 0;
      }
      case 'cancel': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { reason: { type: 'string' } },
        });
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can cancel a worker');
        const target = positionals[0]?.trim();
        if (!target || positionals.length !== 1) throw new Error('usage: onni task cancel <worker id> [--reason "<reason>"]');
        const reason = values.reason?.trim();
        if (reason !== undefined && (!reason || reason.length > MANAGER_CANCEL_REASON_MAX_CHARS)) {
          throw new Error(`--reason must be 1-${MANAGER_CANCEL_REASON_MAX_CHARS} characters`);
        }
        const result = (await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/worker-cancel`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target, ...(reason !== undefined ? { reason } : {}) }),
        }, 'cancel refused —')) as DispatchManagerCancelResult;
        io.log(`cancelled worker ${result.targetId}; manager report status ${result.reportStatus}${result.reason ? ` — ${result.reason}` : ''}`);
        return 0;
      }
      case 'redirect': {
        const { positionals } = parseArgs({ args: rest, allowPositionals: true, options: {} });
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can redirect a worker');
        if (positionals.length !== 2 || !positionals[0]?.trim()) {
          throw new Error('usage: onni task redirect <worker id> "<instruction>"');
        }
        const target = positionals[0].trim();
        const instruction = positionals[1]?.trim() ?? '';
        if (!instruction || instruction.length > MANAGER_REDIRECT_INSTRUCTION_MAX_CHARS) {
          throw new Error(`redirect instruction must be 1-${MANAGER_REDIRECT_INSTRUCTION_MAX_CHARS} characters`);
        }
        const result = (await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/worker-redirect`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target, instruction }),
        }, (status, body, reason) => {
          if (status === 409 && typeof body === 'object' && body !== null && 'cancelledRunId' in body && typeof body.cancelledRunId === 'string') {
            return `source ${body.cancelledRunId} was cancelled; replacement was refused — ${reason}`;
          }
          return `redirect refused — ${reason}`;
        })) as DispatchManagerRedirectResult;
        io.log(`redirected worker ${result.cancelledRunId} to replacement ${result.replacement.id}${result.replacement.branch ? ` on branch ${result.replacement.branch}` : ''}; repointed ${result.repointedDependents} dependent${result.repointedDependents === 1 ? '' : 's'}`);
        return 0;
      }
      case 'verify': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { only: { type: 'string', multiple: true }, baseline: { type: 'boolean' } },
        });
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can verify a worker');
        const target = positionals[0];
        if (!target || positionals.length !== 1) throw new Error('a worker id is required: onni task verify <worker id>');
        const result = (await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            target,
            ...(values.only?.length ? { only: values.only } : {}),
            ...(values.baseline ? { baseline: true } : {}),
          }),
          signal: AbortSignal.timeout(VERIFY_TOTAL_TIMEOUT_MS + 30_000),
        }, 'verify refused —')) as DispatchVerifyResult;
        io.log(formatVerify(result, target.slice(0, 8)));
        if (result.baseline) {
          if (result.baseline.state === 'unavailable') return 4;
          return result.baseline.verdict === 'no-new-failures' ? 0 : result.baseline.verdict === 'new-failures' ? 3 : 4;
        }
        return result.state === 'passed' ? 0 : result.state === 'failed' ? 3 : 4;
      }
      case 'conflicts': {
        const { positionals } = parseArgs({ args: rest, allowPositionals: true, options: {} });
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can check its worker conflicts');
        if (positionals.length > 1) throw new Error('usage: onni task conflicts [<worker id>]');
        const params = new URLSearchParams();
        if (positionals[0]) params.set('target', positionals[0]);
        const query = params.toString();
        const conflicts = (await callRoute(
          api,
          io,
          '/runs/' + encodeURIComponent(env.ONNI_TASK_ID) + '/conflicts' + (query ? '?' + query : ''),
          { method: 'GET' },
          'conflicts refused —',
        )) as DispatchConflicts;
        io.log(formatConflicts(conflicts));
        return 0;
      }
      case 'memory': {
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can write project memory');
        const [sub, ...words] = rest;
        if (sub !== 'add') throw new Error('usage: onni task memory add "<lesson>"');
        const entry = words.join(' ').trim();
        if (!entry) throw new Error('memory add needs a lesson');
        const memory = (await callRoute(api, io, `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/memory`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entry }),
        }, 'could not save memory —')) as ManagerMemoryRead;
        io.log(`memory now ${memory.bytes}/${memory.maxBytes} bytes`);
        return 0;
      }
      case 'plan': {
        if (!env.ONNI_TASK_ID) throw new Error('ONNI_TASK_ID is not set — only a running task can use the tree plan');
        const scope = `/runs/${encodeURIComponent(env.ONNI_TASK_ID)}/plan`;
        const print = (plan: TreePlan): void => {
          if (plan.parts.length === 0) {
            io.log('no plan yet — write one with: onni task plan set --json @plan.json');
            return;
          }
          io.log(`plan: ${plan.parts.length} part${plan.parts.length === 1 ? '' : 's'} · revision ${plan.revision}${plan.updatedAt ? ` · updated ${plan.updatedAt}` : ''}`);
          for (const part of plan.parts) {
            const flags = [
              part.worker ? `worker: ${sanitizeMemoryEntry(part.worker)}` : '',
              part.after?.length ? `after: ${part.after.map((ref) => sanitizeMemoryEntry(ref)).join(', ')}` : '',
              part.runId ? `run: ${part.runId.slice(0, 8)}` : '',
            ].filter(Boolean).join(' · ');
            io.log(`- [${part.status}] ${sanitizeMemoryEntry(part.id)}: ${sanitizeMemoryEntry(part.title)}${flags ? ` — ${flags}` : ''}`);
          }
        };
        const [sub, ...words] = rest;
        if (sub === undefined || sub === 'show') {
          print((await callRoute(api, io, scope, { method: 'GET' }, 'could not read the plan —')) as TreePlan);
          return 0;
        }
        if (sub === 'set') {
          const { values } = parseArgs({ args: words, allowPositionals: false, options: { json: { type: 'string' } } });
          if (!values.json) throw new Error(`plan set needs --json '<json>' or --json @path`);
          let raw = values.json;
          if (raw.startsWith('@')) {
            try {
              raw = readFileSync(raw.slice(1), 'utf8');
            } catch (error) {
              throw new Error(`could not read ${raw.slice(1)} — ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            throw new Error(`--json is not valid JSON — ${error instanceof Error ? error.message : String(error)}`);
          }
          const parts = Array.isArray(parsed) ? parsed : (parsed as { parts?: unknown } | null)?.parts;
          if (!Array.isArray(parts)) throw new Error('the plan must be an array of parts, or an object with a "parts" array');
          // Read for the revision, then replace: the server refuses a stale revision instead of
          // silently merging two writers' plans.
          const current = (await callRoute(api, io, scope, { method: 'GET' }, 'could not read the plan —')) as TreePlan;
          const saved = (await callRoute(api, io, scope, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ parts, revision: current.revision }),
          }, 'could not save the plan —')) as TreePlan;
          io.log(`plan saved: ${saved.parts.length} part${saved.parts.length === 1 ? '' : 's'} · revision ${saved.revision}`);
          return 0;
        }
        if (sub === 'update') {
          const { values } = parseArgs({
            args: words,
            allowPositionals: false,
            options: { part: { type: 'string' }, status: { type: 'string' }, run: { type: 'string' } },
          });
          if (!values.part) throw new Error('plan update needs --part <id>');
          if (!values.status && !values.run) throw new Error('plan update needs --status and/or --run');
          const plan = (await callRoute(api, io, `${scope}/parts/${encodeURIComponent(values.part)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ...(values.status ? { status: values.status } : {}),
              ...(values.run ? { runId: values.run } : {}),
            }),
          }, 'could not update the plan —')) as TreePlan;
          const part = plan.parts.find((candidate) => candidate.id === values.part);
          io.log(`plan part "${values.part}"${part ? ` → [${part.status}]` : ' updated'}`);
          return 0;
        }
        throw new Error('usage: onni task plan show | plan set --json \'<json>\'|@path | plan update --part <id> --status planned|assigned|done|dropped [--run <id8>]');
      }
      case 'list':
      case 'tree': {
        const anchor = command === 'tree' ? rest[0] : env.ONNI_TASK_ID;
        if (!anchor) throw new Error(command === 'tree' ? 'a run id is required' : 'ONNI_TASK_ID is not set');
        const runs = (await callRoute(api, io, '/runs', { method: 'GET' }, 'could not list runs —')) as Array<{
          id: string;
          title: string;
          status: string;
          costUsd?: number;
          branch?: string;
          dispatch?: { rootRunId: string; parentRunId?: string; kind?: string; report?: { status: string; verdict?: string } };
        }>;
        const me = runs.find((run) => run.id === anchor || run.id.startsWith(anchor));
        if (!me) throw new Error(`no run ${anchor}`);
        const rootId = me.dispatch?.rootRunId ?? me.id;
        const byParent = new Map<string, typeof runs>();
        for (const run of runs) {
          if (run.dispatch?.rootRunId !== rootId) continue;
          const key = run.dispatch.parentRunId ?? '';
          byParent.set(key, [...(byParent.get(key) ?? []), run]);
        }
        const print = (run: (typeof runs)[number], depth: number): void => {
          const cost = run.costUsd !== undefined ? ` $${run.costUsd.toFixed(2)}` : '';
          const report = run.dispatch?.report ? ` → ${run.dispatch.report.status}${run.dispatch.report.verdict ? ` (${run.dispatch.report.verdict})` : ''}` : '';
          io.log(`${'  '.repeat(depth)}${run.id.slice(0, 8)}  ${run.status}${cost}  ${run.title}${run.branch ? `  [${run.branch}]` : ''}${report}`);
          for (const child of byParent.get(run.id) ?? []) print(child, depth + 1);
        };
        const root = runs.find((run) => run.id === rootId);
        if (root) print(root, 0);
        else for (const child of byParent.get('') ?? []) print(child, 0);
        return 0;
      }
      default:
        io.error(`onni task: unknown command "${command}"\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    io.error(`onni task: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
