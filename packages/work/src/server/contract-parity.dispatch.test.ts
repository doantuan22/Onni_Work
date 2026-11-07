import type { InferRequestType, InferResponseType } from 'hono/client';
import { hc } from 'hono/client';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  dispatchPeekSchema,
  dispatchReportSchema,
  dispatchSchema,
  dispatchVerifyInputSchema,
  dispatchVerifyResultSchema,
  managerAskInputSchema,
  managerAskResponseSchema,
  managerMemoryAddSchema,
  managerMemoryPutSchema,
  managerMemoryReadSchema,
  treePlanPatchSchema,
  treePlanPutSchema,
  treePlanSchema,
} from '@onni/contract';
import type { dispatchBudgetSchema, dispatchInputSchema, dispatchResponseSchema, mergeInputSchema, mergeResultSchema } from '@onni/contract';
import type { AppType } from './app-type.ts';

/**
 * `packages/contract/src/dispatch.ts` must describe EXACTLY what the dispatch routes send and
 * accept — no wider, no narrower. Same guard as `contract-parity.automations.test.ts`: each schema
 * is checked against the ROUTE's own inferred type, in BOTH directions, because one-way
 * assignability is green on real drift. Compile-time; `npm run typecheck` enforces it.
 */
describe('src/contract/dispatch.ts matches the dispatch routes exactly', () => {
  const client = hc<AppType>('http://127.0.0.1');

  type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : 'route-is-wider') : 'schema-is-wider';
  type Exact<Schema, Route> = Mutual<Schema, Route>;
  type Assert<T extends true> = T;

  type Run = (typeof client.api.v1.runs)[':id'];
  type Project = (typeof client.api.v1.p)[':projectId'];
  type Dispatch201 = InferResponseType<Run['dispatch']['$post'], 201>;
  type Report200 = InferResponseType<Run['report']['$post'], 200>;
  type DispatchBody = InferRequestType<Run['dispatch']['$post']>['json'];
  type ReportBody = InferRequestType<Run['report']['$post']>['json'];
  type Merge200 = InferResponseType<Run['merge']['$post'], 200>;
  type MergeBody = InferRequestType<Run['merge']['$post']>['json'];
  type Budget200 = InferResponseType<Run['budget']['$get'], 200>;
  type Peek200 = InferResponseType<Run['peek']['$get'], 200>;
  type Verify200 = InferResponseType<Run['verify']['$post'], 200>;
  type VerifyBody = InferRequestType<Run['verify']['$post']>['json'];
  type MemoryRead200 = InferResponseType<Project['manager-memory']['$get'], 200>;
  type MemoryPut200 = InferResponseType<Project['manager-memory']['$put'], 200>;
  type MemoryPutBody = InferRequestType<Project['manager-memory']['$put']>['json'];
  type MemoryAdd200 = InferResponseType<Run['memory']['$post'], 200>;
  type MemoryAddBody = InferRequestType<Run['memory']['$post']>['json'];
  type Ask200 = InferResponseType<Run['ask']['$post'], 200>;
  type AskBody = InferRequestType<Run['ask']['$post']>['json'];
  type Plan200 = InferResponseType<Run['plan']['$get'], 200>;
  type PlanPut200 = InferResponseType<Run['plan']['$put'], 200>;
  type PlanPutBody = InferRequestType<Run['plan']['$put']>['json'];
  type PlanPatch200 = InferResponseType<Run['plan']['parts'][':partId']['$patch'], 200>;
  type PlanPatchBody = InferRequestType<Run['plan']['parts'][':partId']['$patch']>['json'];

  type _Checks = [
    Assert<Exact<z.infer<typeof dispatchResponseSchema>, Dispatch201>>,
    Assert<Exact<{ ok: true }, Report200>>,
    // The request halves. `z.input`, not `z.infer`: what a CALLER may send is the schema's input
    // side, and the two differ wherever a field carries a default (the report's arrays).
    Assert<Exact<z.input<typeof dispatchInputSchema>, DispatchBody>>,
    Assert<Exact<z.input<typeof dispatchReportSchema>, ReportBody>>,
    Assert<Exact<z.infer<typeof mergeResultSchema>, Merge200>>,
    Assert<Exact<z.input<typeof mergeInputSchema>, MergeBody>>,
    Assert<Exact<z.infer<typeof dispatchBudgetSchema>, Budget200>>,
    Assert<Exact<z.infer<typeof dispatchPeekSchema>, Peek200>>,
    Assert<Exact<z.infer<typeof dispatchVerifyResultSchema>, Verify200>>,
    Assert<Exact<z.input<typeof dispatchVerifyInputSchema>, VerifyBody>>,
    Assert<Exact<z.infer<typeof managerMemoryReadSchema>, MemoryRead200>>,
    Assert<Exact<z.infer<typeof managerMemoryReadSchema>, MemoryPut200>>,
    Assert<Exact<z.input<typeof managerMemoryPutSchema>, MemoryPutBody>>,
    Assert<Exact<z.infer<typeof managerMemoryReadSchema>, MemoryAdd200>>,
    Assert<Exact<z.input<typeof managerMemoryAddSchema>, MemoryAddBody>>,
    Assert<Exact<z.infer<typeof managerAskResponseSchema>, Ask200>>,
    Assert<Exact<z.input<typeof managerAskInputSchema>, AskBody>>,
    Assert<Exact<z.infer<typeof treePlanSchema>, Plan200>>,
    Assert<Exact<z.infer<typeof treePlanSchema>, PlanPut200>>,
    Assert<Exact<z.input<typeof treePlanPutSchema>, PlanPutBody>>,
    Assert<Exact<z.infer<typeof treePlanSchema>, PlanPatch200>>,
    Assert<Exact<z.input<typeof treePlanPatchSchema>, PlanPatchBody>>,
  ];

  it('is enforced by tsc, not at runtime', () => {
    type Wrong = Mutual<{ id: string }, { id: number }>;
    const wrong: Wrong = 'schema-is-wider';
    expect(wrong).toBe('schema-is-wider');
  });
});

describe('project memory is bounded and asks for an integer byte count (#9)', () => {
  it('needs a revision on a write and a non-empty lesson on an append', () => {
    expect(managerMemoryPutSchema.safeParse({ content: 'x' }).success).toBe(false);
    expect(managerMemoryAddSchema.safeParse({ entry: '   ' }).success).toBe(false);
  });

  it('caps one lesson and every reported size', () => {
    expect(managerMemoryAddSchema.safeParse({ entry: 'x'.repeat(301) }).success).toBe(false);
    const read = { content: '', bytes: 0, maxBytes: 3072, revision: '0' };
    expect(managerMemoryReadSchema.safeParse(read).success).toBe(true);
    expect(managerMemoryReadSchema.safeParse({ ...read, bytes: -1 }).success).toBe(false);
    expect(managerMemoryReadSchema.safeParse({ ...read, maxBytes: 0 }).success).toBe(false);
  });
});

describe('a manager ask is bounded where the record and the model read it (#10)', () => {
  it('caps the question, the options and the timeout', () => {
    expect(managerAskInputSchema.safeParse({ question: '   ' }).success).toBe(false);
    expect(managerAskInputSchema.safeParse({ question: 'q'.repeat(2_001) }).success).toBe(false);
    expect(managerAskInputSchema.safeParse({ question: 'x', options: Array.from({ length: 11 }, (_, i) => ({ label: `o${i}` })) }).success).toBe(false);
    expect(managerAskInputSchema.safeParse({ question: 'x', options: [{ label: 'o', description: 'd'.repeat(501) }] }).success).toBe(false);
    expect(managerAskInputSchema.safeParse({ question: 'x', timeoutMinutes: 0 }).success).toBe(false);
    expect(managerAskInputSchema.safeParse({ question: 'x', timeoutMinutes: 1_441 }).success).toBe(false);
    expect(managerAskInputSchema.safeParse({ question: 'x', timeoutMinutes: 1.5 }).success).toBe(false);
    expect(managerAskInputSchema.safeParse({ question: 'Postgres or SQLite?', options: [{ label: 'Postgres' }], timeoutMinutes: 1_440 }).success).toBe(true);
  });
});

describe('a tree plan is bounded and self-consistent (#6A)', () => {
  const part = (patch: Record<string, unknown> = {}) => ({ id: 'p1', title: 'Parse', status: 'planned', ...patch });

  it('refuses duplicate ids and an `after` that names no part of the plan', () => {
    expect(treePlanSchema.safeParse({ parts: [part(), part()], updatedAt: '', revision: '0' }).success).toBe(false);
    expect(treePlanSchema.safeParse({ parts: [part({ after: ['ghost'] })], updatedAt: '', revision: '0' }).success).toBe(false);
    expect(treePlanSchema.safeParse({ parts: [part({ after: ['p1'] })], updatedAt: '', revision: '0' }).success).toBe(true);
    // Cycles are the engine's separate check, not Zod's: this shape is structurally valid here.
    expect(treePlanSchema.safeParse({ parts: [part({ after: ['p2'] }), part({ id: 'p2', after: ['p1'] })], updatedAt: '', revision: '0' }).success).toBe(true);
  });

  it('caps the parts, the `after` list and the title, and requires a known status', () => {
    expect(treePlanPutSchema.safeParse({ parts: Array.from({ length: 51 }, (_, i) => part({ id: `p${i}` })), revision: '0' }).success).toBe(false);
    expect(treePlanPutSchema.safeParse({ parts: [part({ title: 'x'.repeat(301) })], revision: '0' }).success).toBe(false);
    expect(treePlanPutSchema.safeParse({ parts: [part({ after: Array.from({ length: 11 }, (_, i) => `p${i}`) })], revision: '0' }).success).toBe(false);
    expect(treePlanPatchSchema.safeParse({ status: 'paused' }).success).toBe(false);
    expect(treePlanPatchSchema.safeParse({}).success).toBe(true); // the engine refuses "nothing to change"
  });
});

describe('a report recorded before `checks` existed still parses (#7)', () => {
  it('fills the field with an empty list', () => {
    expect(dispatchReportSchema.parse({ status: 'done', result: 'r' }).checks).toEqual([]);
  });

  it('bounds the list and requires integer exit codes', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ command: `c${i}`, exitCode: 0 }));
    expect(dispatchReportSchema.safeParse({ status: 'done', result: 'r', checks: eleven }).success).toBe(false);
    expect(
      dispatchReportSchema.safeParse({ status: 'done', result: 'r', checks: [{ command: 'npm test', exitCode: 1.5 }] }).success,
    ).toBe(false);
  });
});

describe('a peek answer is bounded at both levels (#1)', () => {
  const entry = (patch: Record<string, unknown> = {}) => ({
    id: 'abcd1234', title: 'w', status: 'running', tokensUsed: 0, files: [], filesOmitted: 0,
    filesState: 'ok', quietMinutes: null, tail: [], tailTruncated: false, ...patch,
  });

  it('caps the worker list, files per worker and tail lines', () => {
    expect(dispatchPeekSchema.safeParse({ workers: Array.from({ length: 13 }, (_, i) => entry({ id: `w${i}` })), workersOmitted: 0 }).success).toBe(false);
    const manyFiles = Array.from({ length: 51 }, (_, i) => `f${i}`);
    expect(dispatchPeekSchema.safeParse({ workers: [entry({ files: manyFiles })], workersOmitted: 0 }).success).toBe(false);
    expect(dispatchPeekSchema.safeParse({ workers: [entry({ tail: Array.from({ length: 31 }, (_, i) => `l${i}`) })], workersOmitted: 0 }).success).toBe(false);
  });

  it('requires a known files state — an unknown one would hide "not looked" behind "nothing changed"', () => {
    expect(dispatchPeekSchema.safeParse({ workers: [entry({ filesState: 'unknown' })], workersOmitted: 0 }).success).toBe(false);
  });
});

describe('a verify answer is bounded at both levels (wave A1)', () => {
  const result = (patch: Record<string, unknown> = {}) => ({
    command: 'npm test', outcome: 'failed', exitCode: 1, durationMs: 5, timedOut: false, tail: [], tailTruncated: false, ...patch,
  });
  const answer = (patch: Record<string, unknown> = {}) => ({
    state: 'failed', source: 'required-checks', startedAt: 'now', durationMs: 1, results: [result()],
    runsUsed: 1, runsMax: 3, warnings: [], ...patch,
  });

  const baseline = (patch: Record<string, unknown> = {}) => ({
    method: 'heuristic', state: 'compared', verdict: 'inconclusive',
    results: [{ command: 'npm test', classification: 'inconclusive', workerExitCode: 1, baselineExitCode: null, newSignatures: [], newSignaturesOmitted: 0 }],
    newCount: 0, preExistingCount: 0, inconclusiveCount: 1, cleanup: 'removed', ...patch,
  });

  it('accepts a normal answer and rejects every overflow', () => {
    expect(dispatchVerifyResultSchema.safeParse(answer()).success).toBe(true);
    expect(dispatchVerifyResultSchema.safeParse(answer({ results: Array.from({ length: 11 }, () => result()) })).success).toBe(false);
    expect(dispatchVerifyResultSchema.safeParse(answer({ results: [result({ tail: Array.from({ length: 41 }, () => 'l') })] })).success).toBe(false);
    expect(dispatchVerifyResultSchema.safeParse(answer({ results: [result({ tail: ['x'.repeat(201)] })] })).success).toBe(false);
    expect(dispatchVerifyResultSchema.safeParse(answer({ warnings: Array.from({ length: 6 }, () => 'w') })).success).toBe(false);
    expect(dispatchVerifyResultSchema.safeParse(answer({ baseline: baseline() })).success).toBe(true);
    expect(dispatchVerifyResultSchema.safeParse(answer({ baseline: baseline({ results: Array.from({ length: 11 }, () => baseline().results[0]) }) })).success).toBe(false);
    expect(dispatchVerifyResultSchema.safeParse(answer({ baseline: baseline({ results: [baseline().results[0], { ...baseline().results[0], newSignatures: Array.from({ length: 11 }, () => 'failure') }] }) })).success).toBe(false);
  });

  it('accepts additive input and baseline fields while rejecting unknown methods', () => {
    expect(dispatchVerifyInputSchema.safeParse({ target: 'abcd1234', baseline: true }).success).toBe(true);
    expect(dispatchVerifyResultSchema.safeParse(answer()).success).toBe(true); // pre-A1b result
    expect(dispatchVerifyResultSchema.safeParse(answer({ baseline: baseline({ method: 'guess' }) })).success).toBe(false);
  });

  it('rejects unknown state, reasonCode and outcome, and requires runsMax', () => {
    expect(dispatchVerifyResultSchema.safeParse(answer({ state: 'unknown' })).success).toBe(false);
    expect(dispatchVerifyResultSchema.safeParse(answer({ state: 'unavailable', reasonCode: 'who-knows' })).success).toBe(false);
    expect(dispatchVerifyResultSchema.safeParse(answer({ results: [result({ outcome: 'maybe' })] })).success).toBe(false);
    const { runsMax: _omit, ...without } = answer();
    expect(dispatchVerifyResultSchema.safeParse(without).success).toBe(false);
  });

  it('keeps old records parseable and rejects a stored unavailable verdict', () => {
    expect(dispatchSchema.safeParse({ rootRunId: 'r' }).success).toBe(true);
    const stored = (state: string) => ({
      rootRunId: 'r',
      verify: { runs: 1, last: { at: 'now', state, source: 'discovered', results: [{ command: 'npm test', outcome: 'passed', exitCode: 0 }] } },
    });
    expect(dispatchSchema.safeParse(stored('passed')).success).toBe(true);
    expect(dispatchSchema.safeParse(stored('unavailable')).success).toBe(false);
  });
});
