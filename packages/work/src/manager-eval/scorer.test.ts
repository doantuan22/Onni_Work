import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { formatManagerEvaluation, scoreManagerTree, type CriterionScore } from './scorer.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const temporaryTrees: string[] = [];

afterEach(() => {
  for (const tree of temporaryTrees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

function criterion(tree: string, id: CriterionScore['id']): CriterionScore {
  return scoreManagerTree(join(fixtures, tree)).criteria.find((item) => item.id === id)!;
}

function copyFixture(name: string): string {
  const target = mkdtempSync(join(tmpdir(), 'onni-manager-eval-'));
  temporaryTrees.push(target);
  cpSync(join(fixtures, name), target, { recursive: true });
  return target;
}

describe('scoreManagerTree', () => {
  it('scores separated concurrent work, roster fit and dependency-ordered verified merges', () => {
    const evaluation = scoreManagerTree(join(fixtures, 'happy-path'));
    const byId = new Map(evaluation.criteria.map((item) => [item.id, item]));

    expect(byId.get('concurrent-scopes')?.status).toBe('pass');
    expect(byId.get('roster-fit')?.status).toBe('pass');
    expect(byId.get('failure-disposition')?.status).toBe('n/a');
    expect(byId.get('merge-order-and-checks')?.status).toBe('pass');
    expect(evaluation.diagnostics).toEqual([]);
  });

  it('recognizes a failed worker that was re-dispatched to another roster worker', () => {
    const score = criterion('worker-fails', 'failure-disposition');

    expect(score.status).toBe('pass');
    expect(score.details).toContain('dddd0001: failure was followed by a retry (dddd0002)');
  });

  it('uses an inbox failure note when the failed worker has no report and was not retried', () => {
    const tree = copyFixture('worker-fails');
    const ledgerPath = join(tree, 'ledger.jsonl');
    const firstAttempt = readFileSync(ledgerPath, 'utf8').split(/\r?\n/).slice(0, 2).join('\n') + '\n';
    writeFileSync(ledgerPath, firstAttempt, 'utf8');
    rmSync(join(tree, 'units', 'dddd0001', 'report.md'));
    const rootInbox = join(tree, 'inbox', 'root');
    mkdirSync(rootInbox, { recursive: true });
    writeFileSync(join(rootInbox, 'manager-decision.md'), 'Worker dddd0001 failed; the cause was reported to the user.\n', 'utf8');

    const score = scoreManagerTree(tree).criteria.find((item) => item.id === 'failure-disposition')!;
    expect(score.status).toBe('pass');
    expect(score.details[0]).toContain('failure is referenced in inbox/root/manager-decision.md');
  });

  it('marks a concurrent path collision as a scope failure', () => {
    const score = criterion('overlapping-files', 'concurrent-scopes');

    expect(score.status).toBe('fail');
    expect(score.details[0]).toContain('src/config/shared.ts');
  });

  it('does not count an order waiting on its dependency as already running', () => {
    const tree = copyFixture('happy-path');
    const ledgerPath = join(tree, 'ledger.jsonl');
    const ledger = readFileSync(ledgerPath, 'utf8').replace(
      '"at":"2026-11-01T10:14:00.000Z","type":"dispatch","runId":"cccc0003-3333-4333-8333-333333333333"',
      '"at":"2026-11-01T10:05:00.000Z","type":"dispatch","runId":"cccc0003-3333-4333-8333-333333333333"',
    );
    writeFileSync(ledgerPath, ledger, 'utf8');

    const score = scoreManagerTree(tree).criteria.find((item) => item.id === 'concurrent-scopes')!;
    expect(score.status).toBe('pass');
    expect(score.passed).toBe(1);
  });

  it('fails a worker failure with no report, inbox disposition or retry', () => {
    const tree = copyFixture('worker-fails');
    const ledgerPath = join(tree, 'ledger.jsonl');
    writeFileSync(ledgerPath, readFileSync(ledgerPath, 'utf8').split(/\r?\n/).slice(0, 2).join('\n') + '\n', 'utf8');
    rmSync(join(tree, 'units', 'dddd0001', 'report.md'));

    const score = scoreManagerTree(tree).criteria.find((item) => item.id === 'failure-disposition')!;
    expect(score.status).toBe('fail');
    expect(score.details[0]).toContain('has no persisted report or later retry');
  });

  it('fails roster fit when the selected worker tier is below the recorded requirement', () => {
    const tree = copyFixture('worker-fails');
    const orderPath = join(tree, 'units', 'dddd0002', 'order.md');
    const order = readFileSync(orderPath, 'utf8').replace('- Required tier: standard', '- Required tier: heavy');
    writeFileSync(orderPath, order, 'utf8');

    const score = scoreManagerTree(tree).criteria.find((item) => item.id === 'roster-fit')!;
    expect(score.status).toBe('fail');
    expect(score.details.some((detail) => detail.includes('standard tier is below required heavy'))).toBe(true);
  });

  it('fails a merge before the worker verify and catches a dependent merge that lands first', () => {
    const tree = copyFixture('happy-path');
    const ledgerPath = join(tree, 'ledger.jsonl');
    const ledger = readFileSync(ledgerPath, 'utf8')
      .replace('"at":"2026-11-01T10:13:00.000Z","type":"merge","runId":"root0000-0000-4000-8000-000000000000","into":"task","source":"onni/bbbb0002"', '"at":"2026-11-01T10:08:30.000Z","type":"merge","runId":"root0000-0000-4000-8000-000000000000","into":"task","source":"onni/bbbb0002"')
      .replace('"at":"2026-11-01T10:12:00.000Z","type":"merge","runId":"root0000-0000-4000-8000-000000000000","into":"task","source":"onni/aaaa0001"', '"at":"2026-11-01T10:30:00.000Z","type":"merge","runId":"root0000-0000-4000-8000-000000000000","into":"task","source":"onni/aaaa0001"');
    writeFileSync(ledgerPath, ledger, 'utf8');
    const reportPath = join(tree, 'units', 'bbbb0002', 'report.md');
    writeFileSync(reportPath, readFileSync(reportPath, 'utf8').replace('"exitCode": 0', '"exitCode": 1'), 'utf8');

    const score = scoreManagerTree(tree).criteria.find((item) => item.id === 'merge-order-and-checks')!;
    expect(score.status).toBe('fail');
    expect(score.details.some((detail) => detail.includes('merge had no earlier passing verify'))).toBe(true);
    expect(score.details.some((detail) => detail.includes('dependency aaaa0001 merged later'))).toBe(true);
  });

  it('prints a stable score table and reports unavailable roster evidence as unscored', () => {
    const tree = copyFixture('happy-path');
    writeFileSync(join(tree, 'brief.md'), '# Brief\nNo roster snapshot.\n', 'utf8');
    const evaluation = scoreManagerTree(tree);
    const text = formatManagerEvaluation(evaluation);
    const roster = evaluation.criteria.find((item) => item.id === 'roster-fit')!;

    expect(roster.status).toBe('unscored');
    expect(text).toContain('Concurrent order scopes');
    expect(text).toContain('Worker roster tier and kind');
    expect(text).toContain('UNSCORED');
  });
});
