import { describe, expect, it } from 'vitest';
import {
  baselineVerdict,
  classifyBaselineFailure,
  failureSignatures,
  VERIFY_BASELINE_DISCLAIMER,
  VERIFY_BASELINE_METHOD,
} from './baseline.ts';

describe('verify baseline heuristic', () => {
  it('recognizes the test and compiler failure formats used by the supported toolchains', () => {
    const fixtures = [
      ' FAIL  src/auth.test.ts > rejects the token',
      'not ok 3 - handles empty input',
      '--- FAIL: TestAuth (0.02s)',
      'FAILED tests/auth_test.py::test_rejects_token',
      "thread 'auth::rejects_token' panicked at src/auth.rs:19:2",
      'error TS2322: Type string is not assignable',
      'error[E0425]: cannot find value `token` in this scope',
    ];
    for (const fixture of fixtures) expect(failureSignatures(fixture)).toHaveLength(1);
  });

  it('normalizes paths, line numbers, durations, timestamps and commit-like hex runs', () => {
    const worker = 'FAIL C:\\repo\\worker\\src\\auth.test.ts:12:3 > rejects (9.5ms) 2026-11-06T14:12:10.125Z deadbeef12345678';
    const baseline = 'FAIL /repo/base/src/auth.test.ts:91 > rejects (1ms) 2026-11-06T16:00:00Z abcdef0123456789';
    expect(failureSignatures(worker, ['C:\\repo\\worker'])).toEqual(
      failureSignatures(baseline, ['/repo/base']),
    );
  });

  it('caps a sorted set at 200 signatures', () => {
    const output = Array.from({ length: 250 }, (_, index) => `FAIL test ${String(index).padStart(3, '0')}`).join('\n');
    expect(failureSignatures(output)).toHaveLength(200);
  });

  it('classifies new, pre-existing, additional and inconclusive failures', () => {
    const baselinePassed = classifyBaselineFailure(
      { exitCode: 1, output: 'FAIL test new-case' },
      { exitCode: 0, output: '' },
      { nodeModulesLinked: true },
    );
    expect(baselinePassed).toMatchObject({ classification: 'new-failure', newSignatures: ['FAIL test new-case'] });

    const same = classifyBaselineFailure(
      { exitCode: 1, output: 'FAIL test old-case' },
      { exitCode: 1, output: 'FAIL test old-case' },
      { nodeModulesLinked: true },
    );
    expect(same.classification).toBe('pre-existing');

    const extra = classifyBaselineFailure(
      { exitCode: 1, output: 'FAIL test old-case\nFAIL test regression' },
      { exitCode: 1, output: 'FAIL test old-case' },
      { nodeModulesLinked: true },
    );
    expect(extra).toMatchObject({ classification: 'new-signatures', newSignatures: ['FAIL test regression'] });

    expect(classifyBaselineFailure(
      { exitCode: 1, output: 'opaque worker failure' },
      { exitCode: 1, output: 'opaque base failure' },
      { nodeModulesLinked: true },
    ).classification).toBe('inconclusive');
    expect(classifyBaselineFailure(
      { exitCode: 1, output: 'FAIL test timed out' },
      { exitCode: null, timedOut: true, output: '' },
      { nodeModulesLinked: true },
    ).classification).toBe('inconclusive');
    expect(classifyBaselineFailure(
      { exitCode: 1, output: 'FAIL test missing dependencies' },
      { exitCode: 1, output: "Error: Cannot find module 'vitest'" },
      { nodeModulesLinked: false },
    ).classification).toBe('inconclusive');
    expect(classifyBaselineFailure(
      { exitCode: 1, output: 'FAIL test missing dependencies' },
      { exitCode: 127, output: 'vitest: command not found' },
      { nodeModulesLinked: false },
    ).classification).toBe('inconclusive');
  });

  it('prioritizes new failures over inconclusive results and always carries the heuristic label', () => {
    expect(baselineVerdict([{ classification: 'inconclusive' }, { classification: 'new-signatures' }])).toBe('new-failures');
    expect(baselineVerdict([{ classification: 'pre-existing' }, { classification: 'inconclusive' }])).toBe('inconclusive');
    expect(baselineVerdict([{ classification: 'pre-existing' }])).toBe('no-new-failures');
    expect(VERIFY_BASELINE_METHOD).toBe('heuristic');
    expect(VERIFY_BASELINE_DISCLAIMER).toContain('a flaky or renamed test can be misclassified');
  });
});
