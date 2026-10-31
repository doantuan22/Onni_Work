import { describe, expect, it, vi } from 'vitest';
import { limitsFromFlags, parseLimitSpec } from './limits-cli.ts';
import { runStopCommand } from './stop-cli.ts';

describe('onni run --limit / --no-limit', () => {
  it('parses cost, time, tokens and iterations; omitted keys stay unlimited', () => {
    expect(parseLimitSpec('cost=5,time=120,tokens=5000000,iterations=20')).toEqual({
      mode: 'capped', maxCostUsd: 5, maxWallClockMinutes: 120, maxTokens: 5_000_000, maxStepIterations: 20,
    });
    expect(parseLimitSpec('cost=1')).toEqual({ mode: 'capped', maxCostUsd: 1 });
  });
  it.each(['cost', 'cost=abc', 'speed=3', 'cost=-1', 'time=1.5'])('rejects %s', (spec) => {
    expect(() => parseLimitSpec(spec)).toThrow();
  });
  it('maps the flags, and stays on the default without them', () => {
    expect(limitsFromFlags({})).toBeUndefined();
    expect(limitsFromFlags({ noLimit: true }, {})).toEqual({ mode: 'none' });
    expect(limitsFromFlags({ limit: 'cost=2' }, {})).toEqual({ mode: 'capped', maxCostUsd: 2 });
    expect(() => limitsFromFlags({ noLimit: true, limit: 'cost=2' }, {})).toThrow(/cannot be combined/);
  });
  it('refuses both flags from inside an agent task', () => {
    expect(() => limitsFromFlags({ noLimit: true }, { ONNI_TASK_ID: 'abc' })).toThrow(/agent task/);
    expect(() => limitsFromFlags({ limit: 'cost=999' }, { ONNI_TASK_ID: 'abc' })).toThrow(/agent task/);
    expect(limitsFromFlags({}, { ONNI_TASK_ID: 'abc' })).toBeUndefined();
  });
});

describe('onni stop --all', () => {
  const io = (fetchImpl: typeof fetch) => ({ fetch: fetchImpl, log: vi.fn(), error: vi.fn() });
  it('posts to the workspace stop-all route and reports the count', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ stopped: 3 }))) as unknown as typeof fetch;
    const sink = io(fetchImpl);
    expect(await runStopCommand(['--all', '--port', '5000'], {}, sink)).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:5000/api/v1/workspace/stop-all', expect.objectContaining({ method: 'POST' }));
    expect(sink.log).toHaveBeenCalledWith('stopped 3 runs');
  });
  it('needs --all, and says so when no cockpit answers', async () => {
    expect(await runStopCommand([], {}, io(vi.fn() as unknown as typeof fetch))).toBe(2);
    const sink = io(vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    expect(await runStopCommand(['--all'], {}, sink)).toBe(1);
    expect(sink.error).toHaveBeenCalledWith(expect.stringContaining('no cockpit answered'));
  });
});
