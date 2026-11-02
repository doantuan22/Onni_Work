import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentUsageOverview } from './usage-overview.ts';
import { saveUsageWindows } from './usage-windows.ts';

describe('agentUsageOverview', () => {
  let home: string;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'onni-usage-'));
    for (const key of ['ONNI_HOME', 'ONNI_DRY_RUN']) saved[key] = process.env[key];
    process.env.ONNI_HOME = home;
    // Dry run: the Codex probe never spawns a process in a test.
    process.env.ONNI_DRY_RUN = '1';
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const window = (id: string, used: number, observedAt: number) => ({
    id,
    kind: id === 'five_hour' ? ('five-hour' as const) : ('weekly' as const),
    applicability: 'all' as const,
    models: [],
    resetsAt: observedAt + 3_600_000,
    durationMinutes: id === 'five_hour' ? 300 : 10080,
    usedPercent: used,
    status: 'allowed' as const,
    observedAt,
  });

  it('marks agents without a limit source unsupported, with a reason, and never invents numbers', async () => {
    const out = await agentUsageOverview({ force: true });
    const byName = Object.fromEntries(out.agents.map((a) => [a.provider, a]));
    for (const name of ['opencode', 'antigravity', 'cursor', 'copilot', 'cline', 'junie', 'pi']) {
      expect(byName[name]).toMatchObject({ support: 'unsupported', windows: [] });
      expect(byName[name]!.reason).toBeTruthy();
    }
    // Supported but nothing observed yet: `none`, not a zero.
    expect(byName.claude).toMatchObject({ support: 'observed', state: 'none', windows: [] });
  });

  it('reports Claude from the windows a real run stored, fresh then stale', async () => {
    const now = Date.now();
    await saveUsageWindows(
      { provider: 'claude', accountId: 'default', profilePath: join(home, '.claude') },
      { provider: 'claude', source: 'claude-stream', observedAt: now, windows: [window('five_hour', 69, now), window('seven_day', 70, now)] },
    );
    const fresh = (await agentUsageOverview({ force: true, now })).agents.find((a) => a.provider === 'claude')!;
    expect(fresh).toMatchObject({ support: 'observed', state: 'ok', source: 'claude-stream' });
    expect(fresh.windows.map((w) => [w.id, w.usedPercent])).toEqual([['five_hour', 69], ['seven_day', 70]]);

    const later = now + 7 * 3_600_000;
    const stale = (await agentUsageOverview({ force: true, now: later })).agents.find((a) => a.provider === 'claude')!;
    expect(stale.state).toBe('stale');
  });
});
