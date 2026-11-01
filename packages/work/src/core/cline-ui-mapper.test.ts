import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { UiEvent } from './ui-events.ts';
import {
  CLINE_AUTH_FAILURE_MESSAGE,
  clineToolName,
  createClineUiState,
  isClineAuthFailure,
  mapClineFrame,
  type ClineUiMapperState,
} from './cline-ui-mapper.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '__fixtures__', 'cline');

/** Replay a transcript exactly as the runner drives the mapper: every frame, both directions, in
 *  wire order (the header line is metadata, not wire). */
function replay(fixture: string): UiEvent[] {
  const lines = readFileSync(join(FIXTURES, `${fixture}.ndjson`), 'utf8').trim().split('\n');
  let state: ClineUiMapperState = createClineUiState();
  const events: UiEvent[] = [];
  for (const line of lines) {
    const value = JSON.parse(line) as Record<string, unknown>;
    if ('fixture' in value) continue;
    const mapped = mapClineFrame(value, state);
    state = mapped.state;
    events.push(...mapped.events);
  }
  // Round-trip: these events get persisted as NDJSON, so a stray `undefined` must fail here.
  return JSON.parse(JSON.stringify(events)) as UiEvent[];
}

const FIXTURE_NAMES = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.ndjson'))
  .map((file) => file.replace(/\.ndjson$/, ''))
  .sort();

function items(events: UiEvent[]) {
  return events.flatMap((e) =>
    e.type === 'item.started' || e.type === 'item.updated' || e.type === 'item.completed' ? [e.item] : []);
}

describe('cline --acp → v2 golden fixtures (live captures, cline 3.0.74)', () => {
  it('has a fixture for every scenario that was captured', () => {
    expect(FIXTURE_NAMES).toEqual(['auth-required', 'empty-turn', 'reasoning-and-failed-command', 'tool-lifecycle']);
  });

  for (const name of FIXTURE_NAMES) {
    it(`maps ${name} exactly`, () => {
      const expected = JSON.parse(readFileSync(join(FIXTURES, `${name}.expected.json`), 'utf8')) as UiEvent[];
      expect(replay(name)).toStrictEqual(expected);
    });

    it(`${name}: the header cites the CLI version and the wire source`, () => {
      const header = JSON.parse(readFileSync(join(FIXTURES, `${name}.ndjson`), 'utf8').split('\n')[0]!) as {
        fixture?: { cli?: string; docs?: string; record?: string; source?: string };
      };
      expect(header.fixture?.cli).toContain('cline 3.0.74');
      expect(header.fixture?.docs).toContain('agentclientprotocol.com');
      expect(header.fixture?.record).toBe('packages/work/src/core/__fixtures__/cline/README.md');
      expect(header.fixture?.source).toMatch(/^LIVE capture/);
    });

    it(`${name}: no machine-specific path or user name leaked into the transcript`, () => {
      const text = readFileSync(join(FIXTURES, `${name}.ndjson`), 'utf8');
      expect(text).not.toMatch(/doant/);
    });
  }

  it('reads a tool from its title prefix and follows pending → running → completed', () => {
    const tools = items(replay('tool-lifecycle')).filter((i) => i.kind === 'tool');
    expect(new Set(tools.map((t) => (t.kind === 'tool' ? t.name : '')))).toEqual(new Set(['editor', 'run_commands']));
    for (const name of ['editor', 'run_commands']) {
      const statuses = tools.flatMap((t) => (t.kind === 'tool' && t.name === name ? [t.status] : []));
      expect(statuses[0]).toBe('pending');
      expect(statuses).toContain('running');
      expect(statuses.at(-1)).toBe('completed');
    }
  });

  it('carries the agent_thought_chunk stream as a non-empty reasoning item', () => {
    const reasoning = items(replay('reasoning-and-failed-command')).filter((i) => i.kind === 'reasoning');
    expect(reasoning.length).toBeGreaterThan(0);
    expect(reasoning.some((i) => i.kind === 'reasoning' && i.text.trim() !== '')).toBe(true);
  });

  it('reads `rawOutput.success: false` as a failed tool, though the update says `completed`', () => {
    // Cline reports a failing command as `status: completed` with the exit code in the output and
    // `success: false` in `rawOutput`; the cockpit must show it as failed, with that text as the error.
    const events = replay('reasoning-and-failed-command');
    const failed = items(events).filter((i) => i.kind === 'tool' && i.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ name: 'run_commands', error: expect.stringContaining('Command exited with code 1') });
    // …and a call that succeeded is not swept up with it.
    expect(items(events).filter((i) => i.kind === 'tool' && i.status === 'completed')).not.toHaveLength(0);
  });

  it('puts a tool result in `output` even though Cline never sends ACP `content`', () => {
    const done = items(replay('tool-lifecycle')).filter((i) => i.kind === 'tool' && i.status === 'completed');
    expect(done.find((i) => i.kind === 'tool' && i.name === 'run_commands')).toMatchObject({ output: 'done' });
  });

  it('derives a diff from the rawInput of an editor call, and a create has no old text', () => {
    const edits = items(replay('reasoning-and-failed-command')).filter((i) => i.kind === 'tool' && i.name === 'editor');
    expect(edits.at(-1)).toMatchObject({ diffs: [{ oldText: 'hi', newText: 'hi there' }] });
    const created = items(replay('tool-lifecycle')).filter((i) => i.kind === 'tool' && i.name === 'editor');
    expect(created.at(-1)).toMatchObject({ diffs: [{ oldText: null, newText: 'hi' }] });
  });

  it('titles a call by what it touches instead of the truncated JSON Cline sends', () => {
    const titles = items(replay('tool-lifecycle')).flatMap((i) => (i.kind === 'tool' ? [i.title] : []));
    expect(titles).toContain('editor: /work/repo/hello.txt');
    expect(titles).toContain('run_commands: echo done');
    expect(titles.some((t) => t.includes('...'))).toBe(false);
  });

  it('maps no usage at all — the wire carries none', () => {
    for (const name of FIXTURE_NAMES) {
      const events = replay(name);
      expect(events.filter((e) => e.type === 'usage.updated')).toEqual([]);
      for (const e of events) {
        if (e.type === 'turn.completed') expect(e.usage).toBeUndefined();
      }
    }
  });

  it('produces no item for an empty turn — the runner is what turns that into a failure', () => {
    const events = replay('empty-turn');
    expect(items(events)).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'turn.completed', stopReason: 'end_turn' });
  });

  it('states the auth failure the way the server latches on', () => {
    expect(replay('auth-required')).toEqual([{ type: 'session.error', message: CLINE_AUTH_FAILURE_MESSAGE, fatal: true }]);
  });
});

describe('clineToolName', () => {
  it('takes the prefix of `<tool>: <args>`', () => {
    expect(clineToolName({ title: 'run_commands: echo done', kind: 'execute' })).toBe('run_commands');
    expect(clineToolName({ title: 'editor: {"path":"/work/repo/a.txt"}', kind: 'edit' })).toBe('editor');
  });

  it('falls back to the ACP kind, then to `tool`, when the title has no such shape', () => {
    expect(clineToolName({ title: 'Reading files', kind: 'read' })).toBe('read');
    expect(clineToolName({ title: ': nothing before the colon', kind: 'other' })).toBe('other');
    expect(clineToolName({})).toBe('tool');
  });

  it('rejects a prefix that is prose rather than a tool name', () => {
    expect(clineToolName({ title: 'Please run this: now', kind: 'execute' })).toBe('execute');
  });
});

describe('isClineAuthFailure', () => {
  it('recognizes the live wording and its prose variants', () => {
    expect(isClineAuthFailure('Authentication required: Call authenticate before starting a session')).toBe(true);
    expect(isClineAuthFailure('You are not signed in')).toBe(true);
    expect(isClineAuthFailure('401 Unauthorized')).toBe(true);
  });

  it('leaves unrelated failures alone', () => {
    expect(isClineAuthFailure('ENOENT: no such file')).toBe(false);
    expect(isClineAuthFailure('rate limit exceeded')).toBe(false);
  });
});
