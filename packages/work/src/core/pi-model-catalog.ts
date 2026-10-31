import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { trackChildExit } from './agent-runner.ts';
import { buildChildEnv } from './agent-env.ts';
import type { ModelOption } from './runner-model-catalog.ts';
import { spawnableCommand } from './windows-shim.ts';

export interface PiModelDiscoveryOptions {
  cwd: string;
  bin?: string;
  timeoutMs?: number;
  /** Injected for tests. */
  spawn?: (bin: string, cwd: string) => ChildProcessWithoutNullStreams;
}

const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000;
/** Grace between the probe's SIGTERM and the SIGKILL that follows it. */
export const KILL_GRACE_MS = 2_000;
const MAX_MODELS = 500;
/** Defensive cap on what we buffer from a misbehaving child (characters of output). */
const MAX_OUTPUT_CHARS = 512 * 1_024;

/**
 * The table `pi --list-models` prints: one row per configured model, then ability columns. The
 * first two columns are what `--model` accepts as `provider/model` (proven by the
 * `provider  model  context  max-out  thinking  images` answer the auth probe reads).
 */
const HEADER_RE = /^provider\s+model\s+context\s+max-out\s+thinking\s+images$/i;
/** pi's own "no provider is logged in" answer — a usable empty catalog, not a failure. */
const NO_MODELS_RE = /no models available/i;
/** SGR/CSI sequences, in case a future CLI colorizes even a piped stream. */
const ANSI_RE = /\u001B\[[0-9;]*[A-Za-z]/g;
const PROVIDER_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const MODEL_RE = /^[a-z0-9][a-z0-9._:/-]*$/i;

/** The host binary, resolved exactly like `PiRunner` and the backend probe. */
export function resolvePiExecutable(bin?: string): string {
  return bin ?? process.env.ONNI_PI_BIN ?? 'pi';
}

/**
 * Turn `pi --list-models` output into picker options, in pi's own order.
 *
 * `provider/model` is the exact id pi takes for `--model`, so it is quoted verbatim — the same
 * convention OpenCode's listing uses. Prose, banners and footer hints are skipped; an answer we
 * cannot recognize at all throws, and a logged-out pi (its documented "no models" guidance) is
 * an empty catalog so the picker falls back to `auto` alone rather than reporting an outage.
 */
export function parsePiModels(output: string): ModelOption[] {
  const lines = output
    .replace(ANSI_RE, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.some((line) => NO_MODELS_RE.test(line))) return [];
  const header = lines.findIndex((line) => HEADER_RE.test(line));
  if (header < 0) throw new Error('pi model discovery returned unrecognized output');

  const models: ModelOption[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(header + 1)) {
    const [provider, model] = line.split(/\s+/);
    if (!provider || !model || !PROVIDER_RE.test(provider) || !MODEL_RE.test(model)) continue;
    const id = `${provider}/${model}`;
    if (seen.has(id)) continue;
    if (models.length >= MAX_MODELS) throw new Error('pi model discovery exceeded the size limit');
    seen.add(id);
    models.push({ id, label: model, description: `via ${provider}` });
  }
  return models;
}

/**
 * Discover the models the host's pi installation has configured, by asking it: `--list-models`
 * is the same command the auth probe already uses. The child is short-lived, bounded by a
 * deadline and an output cap, and never starts a session or costs a token.
 *
 * Best-effort by contract — `RunnerModelCatalog` turns any throw here into a cached or
 * `unavailable` answer, and `auto` stays selectable either way.
 */
export async function discoverPiModels(options: PiModelDiscoveryOptions): Promise<ModelOption[]> {
  const bin = resolvePiExecutable(options.bin);
  const child = (options.spawn ?? spawnPi)(bin, options.cwd);
  const kill = teardown(child);

  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await new Promise<ModelOption[]>((resolve, reject) => {
      let output = '';
      let overflowed = false;

      const fail = (message: string) => {
        reject(new Error(message));
        kill();
      };

      timeout = setTimeout(() => fail('pi model discovery timed out'), timeoutMs);
      timeout.unref?.();

      const collect = (chunk: string) => {
        if (overflowed) return;
        output += chunk;
        if (output.length > MAX_OUTPUT_CHARS) {
          overflowed = true;
          fail('pi model discovery exceeded the output limit');
        }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', collect);
      // pi ≥ 0.73 reroutes the whole answer to stderr when stdin is not a TTY (telemetry f67df9d2).
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', collect);

      child.once('error', () => fail('pi model discovery child failed'));
      child.once('close', (code) => {
        if (overflowed) return;
        if (code !== 0) {
          fail(`pi model discovery child exited (${code ?? 'unknown'})`);
          return;
        }
        try {
          resolve(parsePiModels(output));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    kill();
  }
}

function spawnPi(bin: string, cwd: string): ChildProcessWithoutNullStreams {
  const child = nodeSpawn(...spawnableCommand(bin, ['--list-models']), {
    cwd,
    env: buildChildEnv({ backend: 'pi' }),
  });
  // Closing a pipe the child already dropped reports EPIPE as an async 'error'; 'close' owns
  // settlement. Nothing is ever written, and an open stdin is what makes a CLI that expects a
  // TTY wait instead of printing its list.
  child.stdin.on('error', () => {});
  child.stdin.end();
  return child;
}

/** SIGTERM now, SIGKILL once the grace window elapses — never gated on `child.killed`, which
 *  flips on delivery rather than on termination. */
function teardown(child: ChildProcessWithoutNullStreams): () => void {
  const hasExited = trackChildExit(child);
  let signalled = false;
  return () => {
    if (signalled || hasExited()) return;
    signalled = true;
    child.kill('SIGTERM');
    const escalation = setTimeout(() => {
      if (hasExited()) return;
      child.kill('SIGKILL');
    }, KILL_GRACE_MS);
    escalation.unref?.();
  };
}
