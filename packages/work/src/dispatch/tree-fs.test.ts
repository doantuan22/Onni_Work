import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendLedger,
  findPlanCycle,
  inboxDigest,
  inboxName,
  listInbox,
  patchPlanPart,
  planPath,
  readPlan,
  treeEnvelopeLines,
  notesSuggestions,
  seedNotes,
  shortId,
  taskPaths,
  writeBrief,
  writeInboxMessage,
  writeOrder,
  writePlan,
  writeReport,
} from './tree-fs.ts';

/**
 * The tree directory (the filesystem channel): every path a task is told about exists where
 * the order says, every reader degrades to "nothing there", and the inbox listing is what the
 * engine's wake and digest are built on.
 */
describe('the tree directory', () => {
  let dataDir: string;
  const MISSION = 'aaaaaaaa-1111-2222-3333-444444444444';
  const CHILD = 'bbbbbbbb-1111-2222-3333-444444444444';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'onni-tree-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('addresses the root as `root` and every other unit by its id8 — the branch handle', () => {
    expect(shortId(CHILD)).toBe('bbbbbbbb');
    expect(inboxName(MISSION, MISSION)).toBe('root');
    expect(inboxName(CHILD, MISSION)).toBe('bbbbbbbb');
    const paths = taskPaths(dataDir, MISSION, CHILD);
    expect(paths.inbox).toBe(join(dataDir, 'dispatch', MISSION, 'inbox', 'bbbbbbbb'));
    expect(paths.rootInbox).toBe(join(dataDir, 'dispatch', MISSION, 'inbox', 'root'));
    expect(paths.notes).toBe(join(dataDir, 'dispatch', MISSION, 'units', 'bbbbbbbb', 'notes.md'));
  });

  it('writes the brief once from the root’s objective, and never overwrites it', () => {
    const path = writeBrief(dataDir, MISSION, 'Ship the thing\n\n## Constraints\n- never touch billing');
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('## Objective');
    expect(text).toContain('Ship the thing');
    expect(text).toContain('- never touch billing');
    expect(text).toContain('inbox/root/');
    writeBrief(dataDir, MISSION, 'something else');
    expect(readFileSync(path, 'utf8')).toContain('Ship the thing');
  });

  it('writes an order and seeds notes once — the notes file is the unit’s own after that', () => {
    writeOrder(dataDir, MISSION, CHILD, { title: 'Left flank', kind: 'implement', parentRunId: MISSION, text: 'take it' });
    const paths = taskPaths(dataDir, MISSION, CHILD);
    expect(readFileSync(paths.order, 'utf8')).toContain('take it');
    seedNotes(dataDir, MISSION, CHILD, 'Left flank');
    writeFileSync(paths.notes, '# mine now\n\n## Suggestions for the root\n\n- split billing out\n');
    seedNotes(dataDir, MISSION, CHILD, 'Left flank'); // a second seed must not clobber
    expect(readFileSync(paths.notes, 'utf8')).toContain('# mine now');
    expect(notesSuggestions(dataDir, MISSION, CHILD)).toBe('- split billing out');
  });

  it('reads no suggestions from a fresh seed and none from a missing notes file', () => {
    expect(notesSuggestions(dataDir, MISSION, CHILD)).toBe('');
    seedNotes(dataDir, MISSION, CHILD, 'Left flank');
    expect(notesSuggestions(dataDir, MISSION, CHILD)).toBe('');
  });

  it('lists inbox files newer than the watermark, oldest first, and nothing for a missing inbox', () => {
    expect(listInbox(dataDir, MISSION, 'root')).toEqual([]);
    const older = writeInboxMessage(dataDir, MISSION, 'root', { from: CHILD, subject: 'First', body: 'one' });
    const newer = writeInboxMessage(dataDir, MISSION, 'root', { from: CHILD, subject: 'Second', body: 'two' });
    const t0 = new Date('2026-09-09T10:00:00.000Z');
    utimesSync(older, t0, t0);
    const t1 = new Date('2026-09-09T11:00:00.000Z');
    utimesSync(newer, t1, t1);
    expect(listInbox(dataDir, MISSION, 'root').map((item) => item.path)).toEqual([older, newer]);
    expect(listInbox(dataDir, MISSION, 'root', '2026-09-09T10:30:00.000Z').map((item) => item.path)).toEqual([newer]);
    expect(listInbox(dataDir, MISSION, 'root', '2026-09-09T12:00:00.000Z')).toEqual([]);
    const digest = inboxDigest(listInbox(dataDir, MISSION, 'root'), taskPaths(dataDir, MISSION, MISSION).inbox);
    expect(digest).toContain('2 new messages');
    expect(digest).toContain(older);
    expect(inboxDigest([], 'x')).toBeUndefined();
  });

  it('names an inbox message by instant, sender and subject, and writes a readable header', () => {
    const path = writeInboxMessage(dataDir, MISSION, 'cccccccc', { from: CHILD, subject: 'Scope overlap?', body: 'we both touch auth' });
    expect(path.split(sep)).toContain('cccccccc');
    expect(basename(path)).toMatch(/-bbbbbbbb-scope-overlap\.md$/);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('# Scope overlap?');
    expect(text).toContain(`- From: ${CHILD}`);
    expect(text).toContain('we both touch auth');
  });

  it('writes the report file and appends ledger lines, best effort', () => {
    writeReport(dataDir, MISSION, CHILD, 'Report from centurion: status done', { status: 'done' });
    expect(readFileSync(taskPaths(dataDir, MISSION, CHILD).report, 'utf8')).toContain('"status": "done"');
    appendLedger(dataDir, MISSION, { type: 'spawn', runId: CHILD });
    appendLedger(dataDir, MISSION, { type: 'settle', runId: CHILD });
    const lines = readFileSync(join(dataDir, 'dispatch', MISSION, 'ledger.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)).toMatchObject({ type: 'settle', runId: CHILD });
    expect(existsSync(join(dataDir, 'dispatch', MISSION, 'brief.md'))).toBe(false); // nothing is required
  });

  it('keeps worker evidence additive for older dispatch lines and writes roster snapshots', () => {
    appendLedger(dataDir, MISSION, { type: 'dispatch', runId: CHILD, kind: 'implement' });
    appendLedger(dataDir, MISSION, {
      type: 'roster',
      workers: [{ key: 'codex:gpt-5', tier: 'heavy', kinds: ['implement', 'test'], concurrency: 2 }],
    });
    const lines = readFileSync(join(dataDir, 'dispatch', MISSION, 'ledger.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'dispatch', runId: CHILD, kind: 'implement' });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      type: 'roster',
      workers: [{ key: 'codex:gpt-5', tier: 'heavy', kinds: ['implement', 'test'], concurrency: 2 }],
    });
  });

  it('spells the task-order lines a unit needs to find its files', () => {
    const lines = treeEnvelopeLines(taskPaths(dataDir, MISSION, CHILD));
    expect(lines.some((line) => line.includes('brief.md') && /read it FIRST/.test(line))).toBe(true);
    expect(lines.some((line) => line.includes('notes.md'))).toBe(true);
    expect(lines.some((line) => line.includes('inbox/root/'))).toBe(true);
  });
});

/**
 * `plan.json` (plan v2 §10): the same H2 primitive as project memory — atomic write, revision
 * conflict, one queue per path — plus a parser that never throws and a cycle check that lives
 * outside Zod.
 */
describe('the tree plan', () => {
  let dataDir: string;
  const ROOT = 'aaaaaaaa-1111-2222-3333-444444444444';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'onni-plan-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  const parts = [
    { id: 'p1', title: 'Parse the config', status: 'planned' as const, worker: 'codex' },
    { id: 'p2', title: 'Wire the route', status: 'planned' as const, after: ['p1'] },
  ];

  it('round-trips a plan, stamping updatedAt and a revision of the parts', async () => {
    expect((await readPlan(dataDir, ROOT)).plan).toEqual({ parts: [], updatedAt: '', revision: '0' });
    const at = new Date('2026-11-03T10:00:00.000Z');
    const written = await writePlan(dataDir, ROOT, { parts, revision: '0' }, at);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.plan.updatedAt).toBe(at.toISOString());
    expect(written.plan.revision).not.toBe('0');
    const read = await readPlan(dataDir, ROOT);
    expect(read).toEqual({ plan: written.plan, corrupt: false });
    expect(readFileSync(planPath(dataDir, ROOT), 'utf8')).toContain('"id": "p1"');
  });

  it('treats a corrupt file as no plan — a read never throws', async () => {
    mkdirSync(join(dataDir, 'dispatch', ROOT), { recursive: true });
    writeFileSync(planPath(dataDir, ROOT), '{ not json', 'utf8');
    const read = await readPlan(dataDir, ROOT);
    expect(read.corrupt).toBe(true);
    expect(read.plan.parts).toEqual([]);
    expect(read.plan.revision).toBe('0');
    writeFileSync(planPath(dataDir, ROOT), JSON.stringify({ parts: [{ id: 'p1' }], updatedAt: '', revision: 'x' }), 'utf8');
    expect((await readPlan(dataDir, ROOT)).corrupt).toBe(true);
  });

  it('refuses a stale revision and returns the current plan with it', async () => {
    const first = await writePlan(dataDir, ROOT, { parts, revision: '0' });
    if (!first.ok) throw new Error(first.error);
    const stale = await writePlan(dataDir, ROOT, { parts: [], revision: '0' });
    expect(stale).toMatchObject({ ok: false, status: 409, error: 'plan changed in another window' });
    if (!stale.ok) expect(stale.current.revision).toBe(first.plan.revision);
    expect((await writePlan(dataDir, ROOT, { parts, revision: first.plan.revision })).ok).toBe(true);
  });

  it('serializes concurrent patches so neither part loses the other’s update', async () => {
    const first = await writePlan(dataDir, ROOT, { parts, revision: '0' });
    if (!first.ok) throw new Error(first.error);
    const [one, two] = await Promise.all([
      patchPlanPart(dataDir, ROOT, 'p1', { status: 'done' }),
      patchPlanPart(dataDir, ROOT, 'p2', { status: 'assigned', runId: 'run-2' }),
    ]);
    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    const read = await readPlan(dataDir, ROOT);
    expect(read.plan.parts.map((part) => [part.id, part.status, part.runId])).toEqual([
      ['p1', 'done', undefined],
      ['p2', 'assigned', 'run-2'],
    ]);
  });

  it('patches one part, clears a run link with an empty id, and refuses an unknown part', async () => {
    const first = await writePlan(dataDir, ROOT, { parts, revision: '0' });
    if (!first.ok) throw new Error(first.error);
    const assigned = await patchPlanPart(dataDir, ROOT, 'p1', { status: 'assigned', runId: 'run-1' });
    expect(assigned.ok && assigned.part).toMatchObject({ id: 'p1', status: 'assigned', runId: 'run-1' });
    const cleared = await patchPlanPart(dataDir, ROOT, 'p1', { status: 'planned', runId: '' });
    expect(cleared.ok && cleared.part.runId).toBeUndefined();
    expect(await patchPlanPart(dataDir, ROOT, 'ghost', { status: 'done' })).toMatchObject({ ok: false, status: 404 });
    expect(await patchPlanPart(dataDir, ROOT, 'p1', {})).toMatchObject({ ok: false, status: 400 });
  });

  it('finds a cycle in `after` and nothing in a DAG', () => {
    expect(findPlanCycle(parts)).toBeUndefined();
    expect(findPlanCycle([{ id: 'a', title: 'a', status: 'planned', after: ['b'] }, { id: 'b', title: 'b', status: 'planned', after: ['a'] }]))
      .toEqual(['a', 'b', 'a']);
    expect(findPlanCycle([{ id: 'a', title: 'a', status: 'planned', after: ['a'] }])).toEqual(['a', 'a']);
    // A dangling reference is the schema's refusal, not the cycle check's: stay total here.
    expect(findPlanCycle([{ id: 'a', title: 'a', status: 'planned', after: ['ghost'] }])).toBeUndefined();
  });
});
