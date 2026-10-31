/**
 * Golden tests for the Antigravity stream-json → v1/v2 mapper.
 *
 * Provenance: the `.ndjson` files WITHOUT `.synthetic` are live captures from agy 1.4.12
 * (docs/design/antigravity-spike.md, step 0), with only the machine path and conversation ids
 * replaced. The `.synthetic` ones are hand-written to reach a case the spike could not record, and
 * carry a `# synthetic` first line; no `*.expected.json` is produced from them, so no parity row
 * is ever satisfied by a frame that was not on the real wire.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { AgentEvent } from './agent-runner.ts';
import {
  createAntigravityState,
  evaluateAntigravityResult,
  foldAntigravityFrame,
  type AntigravityState,
} from './antigravity-ui-mapper.ts';
import type { UiEvent } from './ui-events.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'antigravity');

function replay(name: string, level = 'files-only'): { agent: AgentEvent[]; ui: UiEvent[]; state: AntigravityState } {
  let state = createAntigravityState({ level });
  const agent: AgentEvent[] = [];
  const ui: UiEvent[] = [];
  for (const line of readFileSync(join(FIXTURES, `${name}.ndjson`), 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      continue; // what the runner does with a cut-off line
    }
    const folded = foldAntigravityFrame(frame, state);
    state = folded.state;
    agent.push(...folded.agent);
    ui.push(...folded.ui);
  }
  return { agent, ui, state };
}

describe('antigravity golden replays (live captures)', () => {
  for (const name of [
    'write-file-allowed',
    'resume-command-denied',
    'allow-rule-partial-denied',
    'allow-rule-chained-denied',
    'add-dir-writes-to-added-dir',
    'write-file-then-done',
  ]) {
    it(`${name} maps to its recorded v2 stream`, () => {
      const expected = JSON.parse(readFileSync(join(FIXTURES, `${name}.expected.json`), 'utf8')) as UiEvent[];
      expect(replay(name).ui).toEqual(expected);
    });
  }

  it('a write_file turn: session, streamed text, a completed edit tool, usage, a clean end', () => {
    const { agent, ui } = replay('write-file-allowed');
    expect(agent[0]).toEqual({ type: 'session', sessionId: '00000000-0000-4000-8000-000000000001' });
    expect(agent.filter((e) => e.type === 'tool-call')).toEqual([
      expect.objectContaining({ tool: 'write_file', input: { Path: '<PATH>' } }),
    ]);
    expect(agent.filter((e) => e.type === 'tool-result')).toEqual([expect.objectContaining({ isError: false })]);
    expect(agent.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toContain('DONE');
    expect(agent.at(-1)).toEqual({ type: 'turn-end' });
    expect(agent.some((e) => e.type === 'error')).toBe(false);
    const tool = ui.find((e) => e.type === 'item.completed' && e.item.kind === 'tool');
    expect(tool).toMatchObject({ item: { toolKind: 'edit', status: 'completed', locations: [{ path: '<PATH>' }] } });
    expect(ui.at(-1)).toMatchObject({ type: 'turn.completed', stopReason: 'end_turn' });
  });

  it('sums the step usages of THIS process: a resumed result.usage is cumulative and would double count', () => {
    const { agent, ui } = replay('resume-command-denied');
    // The result frame says 23119 (the whole conversation); this process's steps add up to 8033.
    expect(agent.filter((e) => e.type === 'token-usage').at(-1)).toEqual({ type: 'token-usage', tokensUsed: 8033 });
    expect(ui.at(-1)).toMatchObject({ type: 'turn.completed', usage: { input: 7953, output: 80, total: 8033 } });
  });

  it('a permission-denied tool is `declined`, and an empty answer with a denial fails the run', () => {
    const { agent, ui } = replay('resume-command-denied');
    expect(ui.find((e) => e.type === 'item.completed' && e.item.kind === 'tool')).toMatchObject({
      item: { status: 'declined', toolKind: 'execute', title: 'Ran echo shelltest' },
    });
    const error = agent.find((e) => e.type === 'error') as { message: string } | undefined;
    expect(error?.message).toContain('run_command `echo shelltest`');
    expect(error?.message).toContain('"Files only"');
    expect(ui.at(-1)).toMatchObject({ type: 'turn.completed', stopReason: 'error' });
  });

  it('a chained command denied by an allow-rule is reported as such', () => {
    const { agent } = replay('allow-rule-chained-denied', 'allow-rules');
    expect((agent.find((e) => e.type === 'error') as { message: string }).message).toContain('"Allow-rules"');
  });

  it('one command allowed and one denied, with an empty answer, still fails and names only the denied one', () => {
    const { agent } = replay('allow-rule-partial-denied', 'allow-rules');
    const message = (agent.find((e) => e.type === 'error') as { message: string }).message;
    expect(message).toContain('node -e');
    expect(message).not.toContain('node --version');
  });
});

describe('evaluateAntigravityResult — the three cases of ADR 0007 decision 2', () => {
  const base = { status: 'SUCCESS', deniedDetails: [] as string[], level: 'files-only' };

  it('empty response + denied actions → fail, listing every denied action', () => {
    const outcome = evaluateAntigravityResult({
      ...base,
      response: '',
      deniedActions: ['RunCommand', 'WriteFile'],
      deniedDetails: ['run_command `npm test`', 'write_file `/etc/x`'],
    });
    expect(outcome).toMatchObject({ kind: 'fail' });
    const message = (outcome as { message: string }).message;
    expect(message).toContain('run_command `npm test`; write_file `/etc/x`');
    expect(message).toContain('Settings → Agents');
  });

  it('a response + denied actions → continue, one warning per denied action', () => {
    const outcome = evaluateAntigravityResult({
      ...base,
      response: 'I edited it but could not run the tests.',
      deniedActions: ['RunCommand', 'RunCommand'],
      deniedDetails: ['run_command `npm test`'],
    });
    expect(outcome).toEqual({
      kind: 'warn',
      notes: [
        'antigravity: denied run_command `npm test` (permission level "Files only")',
        'antigravity: denied RunCommand (permission level "Files only")',
      ],
    });
  });

  it('empty response and nothing denied → fail with its own reason', () => {
    const outcome = evaluateAntigravityResult({ ...base, response: '  \n', deniedActions: [] });
    expect(outcome).toMatchObject({ kind: 'fail' });
    expect((outcome as { message: string }).message).toContain('empty response');
    expect((outcome as { message: string }).message).toContain('no denied actions');
  });

  it('a normal answer is ok, and a non-SUCCESS status fails whatever else it says', () => {
    expect(evaluateAntigravityResult({ ...base, response: 'done', deniedActions: [] })).toEqual({ kind: 'ok' });
    expect(evaluateAntigravityResult({ ...base, status: 'ERROR', response: 'boom', deniedActions: [] })).toMatchObject({
      kind: 'fail',
    });
  });

  it('through the fold: the warn case emits `denied-action` notes and no error (synthetic)', () => {
    const { agent } = replay('denied-with-response.synthetic');
    expect(agent.some((e) => e.type === 'error')).toBe(false);
    expect(agent.filter((e) => e.type === 'note')).toEqual([
      expect.objectContaining({ kind: 'denied-action', message: expect.stringContaining('run_command `npm test`') }),
    ]);
  });

  it('through the fold: empty + denied fails, and empty + nothing denied fails (synthetic)', () => {
    expect(replay('denied-empty-response.synthetic').agent.find((e) => e.type === 'error')).toMatchObject({
      message: expect.stringContaining('run_command `npm test`'),
    });
    expect(replay('empty-response-no-denied.synthetic').agent.find((e) => e.type === 'error')).toMatchObject({
      message: expect.stringContaining('empty response'),
    });
  });
});

describe('tolerance', () => {
  it('ignores unknown events, unknown step types, unknown fields, noise and a cut-off line (synthetic)', () => {
    const { agent } = replay('truncated-and-noise.synthetic');
    expect(agent.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'tial ok' }]);
    expect(agent.at(-1)).toEqual({ type: 'turn-end' });
    expect(agent.some((e) => e.type === 'error')).toBe(false);
  });

  it('maps a non-object, an unknown event and a step with no index to nothing, never throwing', () => {
    const state = createAntigravityState();
    for (const frame of [null, 7, 'x', [], {}, { event: 'future' }, { event: 'step_update' }, { event: 'step_update', step_update: {} }]) {
      expect(foldAntigravityFrame(frame, state)).toEqual({ agent: [], ui: [], state });
    }
  });

  it('closes a tool that never finished when the result arrives, so nothing stays "running"', () => {
    let state = createAntigravityState();
    const frames = [
      { event: 'init', conversation_id: 'c', init: {} },
      { event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'x' } } } },
      { event: 'result', result: { status: 'SUCCESS', response: 'ok' } },
    ];
    const ui: UiEvent[] = [];
    for (const frame of frames) {
      const folded = foldAntigravityFrame(frame, state);
      state = folded.state;
      ui.push(...folded.ui);
    }
    expect(ui.filter((e) => e.type === 'item.completed')).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ kind: 'tool', status: 'failed' }) }),
    ]);
  });
});
