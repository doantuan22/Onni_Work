import { parseArgs } from 'node:util';
import { stopAllResponseSchema } from '@onni/contract';

export interface StopCliEnv {
  ONNI_API_URL?: string;
  ONNI_TASK_ID?: string;
}
export interface StopCliIo {
  fetch: typeof fetch;
  log: (line: string) => void;
  error: (line: string) => void;
}

const USAGE = `onni stop --all [--port <n>]   emergency stop: cancel every queued and live task in every project
                                 (worktrees and sessions are kept; Continue still works)`;

/** `onni stop --all`: talks to an already-running cockpit (ONNI_API_URL, else 127.0.0.1:<port>). */
export async function runStopCommand(
  args: string[],
  env: StopCliEnv = process.env,
  io: StopCliIo = { fetch, log: console.log, error: console.error },
): Promise<number> {
  let values: { all?: boolean; port?: string; help?: boolean };
  try {
    values = parseArgs({ args, options: { all: { type: 'boolean' }, port: { type: 'string', short: 'p' }, help: { type: 'boolean', short: 'h' } }, strict: true }).values;
  } catch (error) {
    io.error(`onni stop: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    io.log(USAGE);
    return 0;
  }
  if (!values.all) {
    io.error(`onni stop: say what to stop — only --all exists\n\n${USAGE}`);
    return 2;
  }
  const url = (env.ONNI_API_URL ?? `http://127.0.0.1:${values.port ?? '4321'}`).replace(/\/+$/, '');
  try {
    const response = await io.fetch(`${url}/api/v1/workspace/stop-all`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      io.error(`onni stop: the cockpit answered ${response.status} ${response.statusText}`);
      return 1;
    }
    const { stopped } = stopAllResponseSchema.parse(await response.json());
    io.log(`stopped ${stopped} run${stopped === 1 ? '' : 's'}`);
    return 0;
  } catch (error) {
    io.error(`onni stop: no cockpit answered at ${url} (${error instanceof Error ? error.message : String(error)}) — pass --port or set ONNI_API_URL`);
    return 1;
  }
}
