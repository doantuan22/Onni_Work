import type { RunnerId } from './agent-runner.ts';

export interface ModelOption {
  id: string;
  label: string;
  description: string;
}

export type ModelCatalogSource = 'live' | 'cache' | 'unavailable';

export interface RunnerModelCatalogResult {
  runner: RunnerId;
  models: ModelOption[];
  source: ModelCatalogSource;
  stale: boolean;
  reason?: string;
}

export interface RunnerModelCatalogAdapter {
  discover(): Promise<ModelOption[]>;
  /**
   * A cheap token that changes when the CLI binary does (see `programFingerprint`). A different
   * token refreshes the catalog at once instead of waiting out the TTL, so a CLI update that
   * ships new models reaches the picker on the next read. Omitted by adapters that cannot tell.
   */
  fingerprint?(): string | null;
}

export interface RunnerModelCatalogOptions {
  adapters: Partial<Record<RunnerId, RunnerModelCatalogAdapter>>;
  now?: () => number;
  ttlMs?: number;
  usableTtlMs?: number;
}

interface CachedCatalog {
  models: ModelOption[];
  /** The next time a discovery may be requested (freshness or failure cooldown). */
  refreshAfter: number;
  expiresAt: number;
  failureReason?: string;
  /** The adapter's token when this entry was written; `undefined` when it has none. */
  fingerprint?: string | null;
}

const DEFAULT_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_USABLE_TTL_MS = 60 * 60 * 1_000;

/** Host-level, in-memory model discovery cache shared by every workspace. */
export class RunnerModelCatalog {
  readonly #adapters: Partial<Record<RunnerId, RunnerModelCatalogAdapter>>;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #usableTtlMs: number;
  readonly #cache = new Map<RunnerId, CachedCatalog>();
  readonly #inFlight = new Map<RunnerId, Promise<RunnerModelCatalogResult>>();

  constructor(options: RunnerModelCatalogOptions) {
    this.#adapters = options.adapters;
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#usableTtlMs = options.usableTtlMs ?? DEFAULT_USABLE_TTL_MS;
  }

  get(runner: RunnerId): Promise<RunnerModelCatalogResult> {
    const cached = this.#cache.get(runner);
    const now = this.#now();
    // A CLI update rewrites the binary (or the script an npm shim runs), so its token differs.
    // Waiting out the TTL would keep showing the old catalog while the new models are installed.
    const outdated = cached !== undefined && this.#fingerprint(runner) !== cached.fingerprint;
    if (cached && !outdated && now < cached.refreshAfter) {
      if (cached.failureReason) {
        return Promise.resolve({
          runner,
          models: cached.models,
          source: cached.models.length > 0 ? 'cache' : 'unavailable',
          stale: cached.models.length > 0,
          reason: cached.failureReason,
        });
      }
      return Promise.resolve({ runner, models: cached.models, source: 'cache', stale: false });
    }

    // Keep discovery latency off the picker path while a healthy answer is still usable.
    if (cached && !outdated && !cached.failureReason && cached.models.length > 0 && now < cached.expiresAt) {
      this.#refreshInBackground(runner, cached);
      return Promise.resolve({ runner, models: cached.models, source: 'cache', stale: false });
    }

    const pending = this.#inFlight.get(runner);
    if (pending) return pending;

    const refresh = this.#refresh(runner, cached).finally(() => {
      this.#inFlight.delete(runner);
    });
    this.#inFlight.set(runner, refresh);
    return refresh;
  }

  #refreshInBackground(runner: RunnerId, cached: CachedCatalog): void {
    if (this.#inFlight.has(runner)) return;
    const refresh = this.#refresh(runner, cached).finally(() => {
      this.#inFlight.delete(runner);
    });
    this.#inFlight.set(runner, refresh);
    // #refresh handles adapter failures, but keep this detached path safe if an
    // unexpected implementation error escapes it.
    void refresh.catch(() => undefined);
  }

  async #refresh(
    runner: RunnerId,
    cached: CachedCatalog | undefined,
  ): Promise<RunnerModelCatalogResult> {
    // Read before discovering: a binary replaced mid-probe then reads as a change on the next
    // request instead of being recorded as already current.
    const fingerprint = this.#fingerprint(runner);
    try {
      const adapter = this.#adapters[runner];
      if (!adapter) throw new Error('adapter unavailable');
      const models = await adapter.discover();
      const now = this.#now();
      const value = {
        models: [...models],
        refreshAfter: now + this.#ttlMs,
        expiresAt: now + this.#usableTtlMs,
        fingerprint,
      };
      this.#cache.set(runner, value);
      return { runner, models: value.models, source: 'live', stale: false };
    } catch {
      const reason = unavailableReason(runner);
      if (cached) {
        this.#cache.set(runner, {
          models: cached.models,
          refreshAfter: this.#now() + this.#ttlMs,
          expiresAt: cached.expiresAt,
          failureReason: reason,
          fingerprint,
        });
        return { runner, models: cached.models, source: 'cache', stale: true, reason };
      }
      const now = this.#now();
      this.#cache.set(runner, {
        models: [],
        refreshAfter: now + this.#ttlMs,
        expiresAt: now,
        failureReason: reason,
        fingerprint,
      });
      return { runner, models: [], source: 'unavailable', stale: false, reason };
    }
  }

  #fingerprint(runner: RunnerId): string | null | undefined {
    const adapter = this.#adapters[runner];
    if (!adapter?.fingerprint) return undefined;
    try {
      return adapter.fingerprint();
    } catch {
      // A fingerprint that cannot be read is no signal, not a change.
      return undefined;
    }
  }
}

/** One label per runner. A ternary chain defaulted every id it did not name to "OpenCode", so
 *  `pi` — and now `copilot` — would have reported another vendor's outage as their own. */
const RUNNER_LABEL: Record<RunnerId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  pi: 'pi',
  junie: 'Junie',
  copilot: 'GitHub Copilot',
  antigravity: 'Antigravity',
};

function unavailableReason(runner: RunnerId): string {
  return `${RUNNER_LABEL[runner]} model discovery is temporarily unavailable`;
}
