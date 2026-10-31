import { describe, expect, it, vi } from 'vitest';
import { parseRosterFlags, startManagedRun } from './roster-cli.ts';

describe('onni run --manager / --workers', () => {
  it('parses backend[:model] entries; several entries may share a backend', () => {
    const roster = parseRosterFlags('claude:opus', 'codex,opencode:openai/gpt-5,codex:mini');
    expect(roster.manager).toEqual({ runner: 'claude', model: 'opus' });
    expect(roster.workers.map((w) => [w.runner, w.model])).toEqual([['codex', undefined], ['opencode', 'openai/gpt-5'], ['codex', 'mini']]);
    expect(roster.workers.every((w) => w.maxConcurrent === 1)).toBe(true);
  });
  it('rejects an unknown backend, a missing --workers, the manager as its own worker, and a duplicate', () => {
    expect(() => parseRosterFlags('claude', 'nope')).toThrow(/runner/);
    expect(() => parseRosterFlags('claude', undefined)).toThrow(/--workers/);
    expect(() => parseRosterFlags('claude:opus', 'claude:opus')).toThrow(/manager cannot also be a worker/);
    expect(() => parseRosterFlags('claude', 'codex,codex')).toThrow(/duplicate/);
    expect(parseRosterFlags('claude:opus', 'claude:haiku').workers).toHaveLength(1);
  });
  it('posts the roster to the cockpit and reports the run, or the cockpit\'s refusal', async () => {
    const fetchOk = vi.fn(async () => new Response(JSON.stringify({ id: 'run-1' }), { status: 201 })) as unknown as typeof fetch;
    const io = { fetch: fetchOk, log: vi.fn(), error: vi.fn() };
    const roster = parseRosterFlags('claude', 'codex');
    expect(await startManagedRun({ task: 'do it', roster, port: '5000' }, {}, io)).toBe(0);
    const [url, init] = (fetchOk as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:5000/api/v1/runs');
    expect(JSON.parse(String(init.body))).toMatchObject({ task: 'do it', roster: { manager: { runner: 'claude' } } });
    const refuse = { fetch: vi.fn(async () => new Response(JSON.stringify({ error: 'codex is not connected' }), { status: 409 })) as unknown as typeof fetch, log: vi.fn(), error: vi.fn() };
    expect(await startManagedRun({ task: 't', roster }, { ONNI_API_URL: 'http://x:1' }, refuse)).toBe(1);
    expect(refuse.error).toHaveBeenCalledWith(expect.stringContaining('codex is not connected'));
    const down = { fetch: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch, log: vi.fn(), error: vi.fn() };
    expect(await startManagedRun({ task: 't', roster }, {}, down)).toBe(1);
  });
});
