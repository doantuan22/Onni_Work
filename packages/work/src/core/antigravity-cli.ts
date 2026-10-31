/**
 * The two Antigravity CLI calls that never reach a model: `agy --version` and `agy models`
 * (spike step 0, g). They answer "is it installed?" and "is a login usable?" without reading any
 * credential file, and feed the model catalog and the run record's `agentVersion`.
 *
 * Never throws: a failure is a value with a one-line reason. Answers are cached briefly so the
 * provider probe, the model picker and a run starting together make one call, not three — and
 * short, because agy updates itself in the background and the version must not go stale for long.
 */
import { execFile } from 'node:child_process';
import { buildChildEnv } from './agent-env.ts';
import { antigravityLaunch, resolveAntigravityExecutable } from './antigravity-bin.ts';
import type { ModelOption } from './runner-model-catalog.ts';

const DEFAULT_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60_000;
const MAX_MODELS = 200;

export type AntigravityProbe<T> =
  | { ok: true; value: T }
  | { ok: false; notInstalled: boolean; reason: string };

type Exec = (bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<{ stdout: string; stderr: string }>;

const realExec: Exec = (bin, args, env, timeoutMs) =>
  new Promise((resolve, reject) => {
    const [file, argv] = antigravityLaunch(bin, args);
    execFile(file, argv, { env, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });

export interface AntigravityProbeOptions {
  bin?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Injected by tests. */
  exec?: Exec;
  /** Skip the cache (tests, and the explicit "refresh" of the model picker). */
  fresh?: boolean;
}

const cache = new Map<string, { at: number; result: AntigravityProbe<unknown> }>();

/** Drop every cached answer (tests). */
export function clearAntigravityProbeCache(): void {
  cache.clear();
}

async function probe<T>(
  kind: 'version' | 'models',
  args: string[],
  parse: (stdout: string) => T | undefined,
  options: AntigravityProbeOptions,
): Promise<AntigravityProbe<T>> {
  const bin = resolveAntigravityExecutable(options.bin);
  const key = `${kind}|${bin}`;
  const hit = cache.get(key);
  if (!options.fresh && !options.exec && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result as AntigravityProbe<T>;
  const env = options.env ?? buildChildEnv({ backend: 'antigravity' });
  let result: AntigravityProbe<T>;
  try {
    const { stdout } = await (options.exec ?? realExec)(bin, args, env, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const value = parse(stdout);
    result =
      value === undefined
        ? { ok: false, notInstalled: false, reason: `\`agy ${args.join(' ')}\` printed nothing usable` }
        : { ok: true, value };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
    if (e.code === 'ENOENT') {
      result = { ok: false, notInstalled: true, reason: `\`${bin}\` not found — install the Antigravity CLI (agy)` };
    } else if (e.killed) {
      result = { ok: false, notInstalled: false, reason: `\`agy ${args.join(' ')}\` timed out` };
    } else {
      const detail = String(e.stderr ?? '').trim().split('\n').pop() || e.message;
      result = { ok: false, notInstalled: false, reason: `\`agy ${args.join(' ')}\` failed: ${detail.slice(0, 200)}` };
    }
  }
  if (!options.exec) cache.set(key, { at: Date.now(), result });
  return result;
}

/** `agy --version` → "1.4.12". */
export function probeAntigravityVersion(options: AntigravityProbeOptions = {}): Promise<AntigravityProbe<string>> {
  return probe('version', ['--version'], (out) => out.trim().split(/\r?\n/)[0]?.trim() || undefined, options);
}

/**
 * Parse `agy models`: one `id<TAB>label` per line. Lines without a tab ("Fetching available
 * models…" goes to stderr today, but a future banner could land on stdout) are skipped.
 */
export function parseAntigravityModels(text: string): ModelOption[] {
  const models: ModelOption[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const [rawId, ...rest] = line.split('\t');
    const id = rawId?.trim();
    if (!id || rest.length === 0 || /\s/.test(id) || seen.has(id)) continue;
    if (models.length >= MAX_MODELS) break;
    seen.add(id);
    models.push({ id, label: rest.join(' ').trim() || id, description: '' });
  }
  return models;
}

/** `agy models` → the account's models. An empty list is a failure: it means no usable login. */
export function probeAntigravityModels(options: AntigravityProbeOptions = {}): Promise<AntigravityProbe<ModelOption[]>> {
  return probe('models', ['models'], (out) => {
    const models = parseAntigravityModels(out);
    return models.length > 0 ? models : undefined;
  }, options);
}

/** Model discovery for the picker: throws like the other runners' `discover*Models`. */
export async function discoverAntigravityModels(options: AntigravityProbeOptions = {}): Promise<ModelOption[]> {
  const probed = await probeAntigravityModels(options);
  if (!probed.ok) throw new Error(`Antigravity model discovery failed: ${probed.reason}`);
  return probed.value;
}
