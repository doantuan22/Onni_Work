import type { AgentUsageEntry, AgentUsageResponse, UsageWindow } from '@onni/contract';
import { probeCodexUsageWindows } from '../core/codex-usage-probe.ts';
import { defaultAgentProfile } from './agent-profiles.ts';
import { listUsageWindows } from './usage-windows.ts';

/**
 * What the cockpit shows for each agent's usage limits (P8). Read-only and metadata-only: it never
 * writes a token anywhere and never launches a task.
 *
 * Measured on this machine (see the P8 report):
 *  - Claude Code prints a `rate_limit_event` (5-hour and 7-day utilisation + reset) at the start of
 *    every stream-json turn — onni already stores it from real runs, so this READS the store.
 *  - Codex answers `account/rateLimits/read` over its app-server, asked live (cached 30 s).
 *  - OpenCode (`opencode stats`: local token/cost totals), Antigravity (`agy models`), Cline,
 *    Copilot, Cursor, Junie and pi expose no provider limit data we may read: reported unsupported.
 */
const FRESH_MS = 6 * 60 * 60 * 1000;
const CACHE_MS = 30_000;

const UNSUPPORTED: Record<string, string> = {
  opencode: 'OpenCode only reports local token and cost totals, not the provider limit.',
  antigravity: 'The Antigravity CLI shows models but no quota or reset time.',
  cursor: 'The Cursor CLI has no usage or limit command.',
  copilot: 'The Copilot CLI has no usage or limit command.',
  cline: 'The Cline CLI has no usage or limit command.',
  junie: 'The Junie CLI has no usage or limit command.',
  pi: 'pi has no usage or limit command.',
};

const newest = (windows: UsageWindow[]): number | null => (windows.length ? Math.max(...windows.map((w) => w.observedAt)) : null);

function fromStore(provider: 'claude' | 'codex'): { windows: UsageWindow[]; observedAt: number | null; source: string } | null {
  const snaps = listUsageWindows().filter((s) => s.provider === provider);
  if (snaps.length === 0) return null;
  const latest = snaps.reduce((a, b) => (b.observedAt > a.observedAt ? b : a));
  return { windows: latest.windows, observedAt: latest.observedAt, source: latest.source };
}

function entry(provider: string, support: AgentUsageEntry['support'], found: { windows: UsageWindow[]; observedAt: number | null; source: string } | null, now: number, failedLive = false): AgentUsageEntry {
  if (!found || found.windows.length === 0) {
    return { provider, support, state: failedLive ? 'unavailable' : 'none', windows: [], observedAt: null };
  }
  const observedAt = found.observedAt ?? newest(found.windows);
  const stale = observedAt === null || now - observedAt > FRESH_MS;
  return { provider, support, state: failedLive ? 'unavailable' : stale ? 'stale' : 'ok', windows: found.windows, observedAt, source: found.source };
}

let cached: { until: number; value: AgentUsageResponse } | undefined;
let inflight: Promise<AgentUsageResponse> | undefined;

export function agentUsageOverview(opts: { force?: boolean; now?: number } = {}): Promise<AgentUsageResponse> {
  const now = opts.now ?? Date.now();
  if (!opts.force && cached && cached.until > now) return Promise.resolve(cached.value);
  if (inflight) return inflight;
  inflight = build(now).then((value) => {
    cached = { until: Date.now() + CACHE_MS, value };
    return value;
  }).finally(() => { inflight = undefined; });
  return inflight;
}

async function build(now: number): Promise<AgentUsageResponse> {
  const agents: AgentUsageEntry[] = [];
  agents.push(entry('claude', 'observed', fromStore('claude'), now));

  let live: { windows: UsageWindow[]; observedAt: number; source: string } | null = null;
  let failed = false;
  try {
    const probed = await probeCodexUsageWindows(defaultAgentProfile('codex'));
    if (probed) live = { windows: probed.observation.windows, observedAt: probed.observation.observedAt, source: probed.observation.source };
    else failed = process.env.ONNI_DRY_RUN !== '1';
  } catch {
    failed = true;
  }
  agents.push(entry('codex', 'live', live ?? fromStore('codex'), now, failed && live === null));

  for (const [provider, reason] of Object.entries(UNSUPPORTED)) {
    agents.push({ provider, support: 'unsupported', state: 'none', windows: [], observedAt: null, reason });
  }
  return { agents, checkedAt: now };
}
