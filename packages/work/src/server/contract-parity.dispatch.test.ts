import type { InferRequestType, InferResponseType } from 'hono/client';
import { hc } from 'hono/client';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { dispatchPeekSchema, dispatchReportSchema } from '@onni/contract';
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
  type Dispatch201 = InferResponseType<Run['dispatch']['$post'], 201>;
  type Report200 = InferResponseType<Run['report']['$post'], 200>;
  type DispatchBody = InferRequestType<Run['dispatch']['$post']>['json'];
  type ReportBody = InferRequestType<Run['report']['$post']>['json'];
  type Merge200 = InferResponseType<Run['merge']['$post'], 200>;
  type MergeBody = InferRequestType<Run['merge']['$post']>['json'];
  type Budget200 = InferResponseType<Run['budget']['$get'], 200>;
  type Peek200 = InferResponseType<Run['peek']['$get'], 200>;

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
  ];

  it('is enforced by tsc, not at runtime', () => {
    type Wrong = Mutual<{ id: string }, { id: number }>;
    const wrong: Wrong = 'schema-is-wider';
    expect(wrong).toBe('schema-is-wider');
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
