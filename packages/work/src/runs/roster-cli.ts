import { rosterSchema, type Roster, type RunLimitsRequest } from '@onni/contract';

/** `claude`, `claude:opus`, `opencode:openai/gpt-5` → backend + optional model (split at the FIRST colon). */
function parseEntry(spec: string, flag: string): { runner: string; model?: string } {
  const trimmed = spec.trim();
  const colon = trimmed.indexOf(':');
  const runner = (colon === -1 ? trimmed : trimmed.slice(0, colon)).trim();
  const model = colon === -1 ? '' : trimmed.slice(colon + 1).trim();
  if (!runner) throw new Error(`${flag}: empty backend in "${spec}"`);
  return { runner, ...(model ? { model } : {}) };
}

/**
 * `--manager claude:opus --workers codex,opencode:model` → a validated roster. Roles and
 * per-entry concurrency are set in the composer or a preset; here every worker runs one at a time.
 */
export function parseRosterFlags(manager: string, workers: string | undefined): Roster {
  if (!workers?.trim()) throw new Error('--manager needs --workers <backend[:model],…>');
  const parsed = rosterSchema.safeParse({
    manager: parseEntry(manager, '--manager'),
    workers: workers.split(',').filter((part) => part.trim()).map((part) => parseEntry(part, '--workers')),
  });
  if (!parsed.success) {
    throw new Error(`--manager/--workers: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'roster'} ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

export interface ManagerRunIo {
  fetch: typeof fetch;
  log: (line: string) => void;
  error: (line: string) => void;
}

/**
 * Start a manager–worker task on a running cockpit. A headless `onni run` has no cockpit for the
 * manager's `onni task create` to reach, so this goes through the API: `ONNI_API_URL`, else
 * 127.0.0.1:<port>. Backends must be connected — the cockpit answers 409 with the reason.
 */
export async function startManagedRun(
  args: { task: string; roster: Roster; limits?: RunLimitsRequest; port?: string },
  env: { ONNI_API_URL?: string; ONNI_PROJECT_ID?: string } = process.env,
  io: ManagerRunIo = { fetch, log: console.log, error: console.error },
): Promise<number> {
  const url = (env.ONNI_API_URL ?? `http://127.0.0.1:${args.port ?? '4321'}`).replace(/\/+$/, '');
  const scope = env.ONNI_PROJECT_ID ? `${url}/api/v1/p/${encodeURIComponent(env.ONNI_PROJECT_ID)}` : `${url}/api/v1`;
  try {
    const response = await io.fetch(`${scope}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: args.task, roster: args.roster, ...(args.limits ? { limits: args.limits } : {}) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      let reason = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === 'string') reason = body.error;
      } catch {
        // not JSON
      }
      io.error(`onni run: the cockpit refused the manager task — ${reason}`);
      return 1;
    }
    const run = (await response.json()) as { id?: string };
    io.log(`manager task started${run.id ? `: ${run.id}` : ''} — watch it in the cockpit at ${url}/tasks${run.id ? `/${run.id}` : ''}`);
    return 0;
  } catch (error) {
    io.error(`onni run: no cockpit answered at ${url} (${error instanceof Error ? error.message : String(error)}) — start one with \`onni\`, or pass --port / set ONNI_API_URL`);
    return 1;
  }
}
