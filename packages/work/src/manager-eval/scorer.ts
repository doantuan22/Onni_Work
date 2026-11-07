import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { globToRegExp, parseScope } from '../dispatch/conflicts.ts';

export type EvaluationStatus = 'pass' | 'fail' | 'partial' | 'unscored' | 'n/a';

export interface CriterionScore {
  id: 'concurrent-scopes' | 'roster-fit' | 'failure-disposition' | 'merge-order-and-checks';
  label: string;
  status: EvaluationStatus;
  passed: number;
  failed: number;
  unscored: number;
  /** The details are deterministic explanations, not model-generated judgments. */
  details: string[];
}

export interface ManagerEvaluation {
  treeDir: string;
  criteria: CriterionScore[];
  diagnostics: string[];
}

interface LedgerEvent {
  at?: string;
  type?: string;
  [key: string]: unknown;
}

interface RosterEntry {
  key: string;
  tier?: string;
  kinds?: string[];
}

interface PlanPart {
  id?: string;
  title?: string;
  status?: string;
  worker?: string;
  runId?: string;
  after?: string[];
  requiredTier?: string;
}

interface OrderRecord {
  runId: string;
  id8: string;
  title: string;
  kind?: string;
  scope?: string;
  worker?: string;
  requiredTier?: string;
  retryOf?: string;
  after: string[];
  dispatch: LedgerEvent;
  dispatchIndex: number;
  settle?: LedgerEvent;
  settleIndex?: number;
  orderText?: string;
  reportText?: string;
  report?: Record<string, unknown>;
  planPart?: PlanPart;
  neverStarted?: boolean;
}

interface Tally {
  passed: number;
  failed: number;
  unscored: number;
  details: string[];
}

interface InboxArtifact {
  path: string;
  text: string;
}

const TIER_RANK: Record<string, number> = { light: 1, standard: 2, heavy: 3 };
const CRITERIA = [
  { id: 'concurrent-scopes', label: 'Concurrent order scopes' },
  { id: 'roster-fit', label: 'Worker roster tier and kind' },
  { id: 'failure-disposition', label: 'Failed or blocked worker' },
  { id: 'merge-order-and-checks', label: 'Merge dependency and checks' },
] as const;

function tally(): Tally {
  return { passed: 0, failed: 0, unscored: 0, details: [] };
}

function resultStatus(score: Tally): EvaluationStatus {
  if (score.failed > 0) return 'fail';
  if (score.unscored > 0) return score.passed > 0 ? 'partial' : 'unscored';
  return score.passed > 0 ? 'pass' : 'n/a';
}

function record(score: Tally, outcome: 'pass' | 'fail' | 'unscored', detail: string): void {
  score[outcome === 'pass' ? 'passed' : outcome === 'fail' ? 'failed' : 'unscored'] += 1;
  score.details.push(detail);
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function parseLedger(treeDir: string, diagnostics: string[]): LedgerEvent[] {
  const raw = readText(join(treeDir, 'ledger.jsonl'));
  if (raw === undefined) {
    diagnostics.push('ledger.jsonl is missing or unreadable');
    return [];
  }
  const events: LedgerEvent[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) events.push(parsed as LedgerEvent);
      else diagnostics.push(`ledger line ${index + 1} is not an object`);
    } catch {
      diagnostics.push(`ledger line ${index + 1} is malformed JSON`);
    }
  });
  return events;
}

function parsePlan(treeDir: string, diagnostics: string[]): PlanPart[] {
  const raw = readText(join(treeDir, 'plan.json'));
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { parts?: unknown }).parts)) {
      return (parsed as { parts: unknown[] }).parts.filter((part): part is PlanPart => Boolean(part && typeof part === 'object'));
    }
  } catch {
    diagnostics.push('plan.json is malformed JSON');
    return [];
  }
  diagnostics.push('plan.json has no parts array');
  return [];
}

function readInbox(treeDir: string): InboxArtifact[] {
  const inboxRoot = join(treeDir, 'inbox');
  try {
    return readdirSync(inboxRoot, { withFileTypes: true })
      .filter((recipient) => recipient.isDirectory())
      .flatMap((recipient) => {
        const recipientDir = join(inboxRoot, recipient.name);
        try {
          return readdirSync(recipientDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase('en-US').endsWith('.md'))
            .flatMap((entry): InboxArtifact[] => {
              const path = join(recipientDir, entry.name);
              const text = readText(path);
              return text === undefined ? [] : [{ path: path.slice(treeDir.length + 1).replace(/\\/g, '/'), text }];
            });
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function parseRoster(brief: string | undefined, diagnostics: string[]): RosterEntry[] {
  if (!brief) return [];
  const block = brief.match(/<!--\s*manager-eval:begin\s*-->([\s\S]*?)<!--\s*manager-eval:end\s*-->/i);
  if (!block) return [];
  try {
    const parsed: unknown = JSON.parse(block[1]!.trim());
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { roster?: unknown }).roster)) {
      diagnostics.push('manager-eval brief metadata has no roster array');
      return [];
    }
    return (parsed as { roster: unknown[] }).roster.flatMap((entry): RosterEntry[] => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as Record<string, unknown>;
      const key = typeof row.key === 'string' ? row.key.trim() : '';
      if (!key) return [];
      return [{
        key,
        ...(typeof row.tier === 'string' ? { tier: row.tier } : {}),
        ...(Array.isArray(row.kinds) && row.kinds.every((kind) => typeof kind === 'string') ? { kinds: row.kinds as string[] } : {}),
      }];
    });
  } catch {
    diagnostics.push('manager-eval brief metadata is malformed JSON');
    return [];
  }
}

function parseReport(text: string | undefined, diagnostics: string[], id8: string): Record<string, unknown> | undefined {
  if (!text) return undefined;
  const structured = text.match(/## Structured\s*```json\s*([\s\S]*?)```/i);
  if (!structured) return undefined;
  try {
    const parsed: unknown = JSON.parse(structured[1]!);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    diagnostics.push(`report for ${id8} has malformed structured JSON`);
    return undefined;
  }
}

function lineValue(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`^\\s*-\\s*${label}\\s*:\\s*(.*?)\\s*$`, 'im'));
  return match?.[1]?.trim() || undefined;
}

function parseOrder(treeDir: string, runId: string, title: string, dispatch: LedgerEvent, dispatchIndex: number, diagnostics: string[]): OrderRecord {
  const id8 = runId.slice(0, 8);
  const dir = join(treeDir, 'units', id8);
  const orderText = readText(join(dir, 'order.md'));
  const reportText = readText(join(dir, 'report.md'));
  if (!orderText) diagnostics.push(`order for ${id8} is missing or unreadable`);
  const scope = lineValue(orderText ?? '', 'Scope');
  const kind = lineValue(orderText ?? '', 'Kind') ?? (typeof dispatch.kind === 'string' ? dispatch.kind : undefined);
  const afterText = lineValue(orderText ?? '', 'Starts after');
  const after = afterText ? [...new Set([...afterText.matchAll(/\b[0-9a-f]{8,}(?:-[0-9a-f-]{20,})?\b/gi)].map((match) => match[0]!))] : [];
  const report = parseReport(reportText, diagnostics, id8);
  const orderTitle = orderText?.match(/^# Order\s+[—-]\s*(.+)$/im)?.[1]?.trim() ?? title;
  return {
    runId,
    id8,
    title: orderTitle,
    ...(kind ? { kind } : {}),
    ...(scope ? { scope } : {}),
    ...(lineValue(orderText ?? '', 'Worker') ? { worker: lineValue(orderText ?? '', 'Worker') } : {}),
    ...(lineValue(orderText ?? '', 'Required tier') ? { requiredTier: lineValue(orderText ?? '', 'Required tier') } : {}),
    ...(lineValue(orderText ?? '', 'Retry of') ? { retryOf: lineValue(orderText ?? '', 'Retry of') } : {}),
    after,
    dispatch,
    dispatchIndex,
    ...(orderText ? { orderText } : {}),
    ...(reportText ? { reportText } : {}),
    ...(report ? { report } : {}),
  };
}

function timeOf(event: LedgerEvent | undefined): number | undefined {
  if (!event || typeof event.at !== 'string') return undefined;
  const time = Date.parse(event.at);
  return Number.isFinite(time) ? time : undefined;
}

function normalizePath(path: string): string {
  let result = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (process.platform === 'win32') result = result.toLocaleLowerCase('en-US');
  return result;
}

function isDirectoryScope(token: string): boolean {
  const normalized = token.replace(/\\/g, '/');
  return normalized.endsWith('/') || !/\.[^/]+$/.test(normalized.replace(/[*?].*$/, ''));
}

function isGlob(token: string): boolean {
  return /[*?]/.test(token);
}

function tokenRelation(left: string, right: string): 'overlap' | 'disjoint' | 'unknown' {
  const a = normalizePath(left);
  const b = normalizePath(right);
  if (a === b) return 'overlap';
  const aDir = isDirectoryScope(left);
  const bDir = isDirectoryScope(right);
  if (!isGlob(left) && aDir && b.startsWith(`${a}/`)) return 'overlap';
  if (!isGlob(right) && bDir && a.startsWith(`${b}/`)) return 'overlap';
  if (isGlob(left) && !isGlob(right) && !bDir) return globToRegExp(left).test(right.replace(/\\/g, '/')) ? 'overlap' : 'disjoint';
  if (isGlob(right) && !isGlob(left) && !aDir) return globToRegExp(right).test(left.replace(/\\/g, '/')) ? 'overlap' : 'disjoint';
  if (isGlob(left) || isGlob(right)) return 'unknown';
  return 'disjoint';
}

function scopesRelation(left: string | undefined, right: string | undefined): 'overlap' | 'disjoint' | 'unknown' {
  const a = parseScope(left);
  const b = parseScope(right);
  if (a.state !== 'checked' || b.state !== 'checked') return 'unknown';
  let unknown = false;
  for (const aToken of a.tokens) {
    for (const bToken of b.tokens) {
      const relation = tokenRelation(aToken, bToken);
      if (relation === 'overlap') return 'overlap';
      if (relation === 'unknown') unknown = true;
    }
  }
  return unknown ? 'unknown' : 'disjoint';
}

function inferredStart(order: OrderRecord, orders: OrderRecord[]): { at?: number; pending: boolean } {
  const dispatchAt = timeOf(order.dispatch);
  if (dispatchAt === undefined) return { pending: false };
  if (order.after.length === 0) return { at: dispatchAt, pending: false };
  const dependencies = order.after.map((dependencyId) => {
    const dependency = orders.find((candidate) => candidate.runId === dependencyId || candidate.id8.toLowerCase() === dependencyId.slice(0, 8).toLowerCase());
    return dependency;
  });
  if (dependencies.some((dependency) => !dependency)) return { pending: false };
  const dependencyEnds = dependencies.map((dependency) => timeOf(dependency!.settle));
  if (dependencyEnds.some((end) => end === undefined)) return { pending: true };
  return { at: Math.max(dispatchAt, ...(dependencyEnds as number[])), pending: false };
}

function isConcurrent(a: OrderRecord, b: OrderRecord, orders: OrderRecord[]): boolean | undefined {
  if (a.neverStarted || b.neverStarted) return false;
  const aInfo = inferredStart(a, orders);
  const bInfo = inferredStart(b, orders);
  if (aInfo.pending || bInfo.pending) return false;
  const aStart = aInfo.at;
  const bStart = bInfo.at;
  if (aStart === undefined || bStart === undefined) return undefined;
  const aEnd = timeOf(a.settle);
  const bEnd = timeOf(b.settle);
  if ((a.settle && aEnd === undefined) || (b.settle && bEnd === undefined)) return undefined;
  if ((aEnd !== undefined && aEnd < aStart) || (bEnd !== undefined && bEnd < bStart)) return undefined;
  return Math.max(aStart, bStart) < Math.min(aEnd ?? Number.POSITIVE_INFINITY, bEnd ?? Number.POSITIVE_INFINITY);
}

function scoreConcurrentScopes(orders: OrderRecord[]): Tally {
  const score = tally();
  for (let leftIndex = 0; leftIndex < orders.length; leftIndex += 1) {
    const left = orders[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < orders.length; rightIndex += 1) {
      const right = orders[rightIndex]!;
      const concurrent = isConcurrent(left, right, orders);
      if (concurrent === undefined) {
        record(score, 'unscored', `${left.id8}/${right.id8}: missing or invalid dispatch/settle timestamps`);
      } else if (concurrent) {
        const relation = scopesRelation(left.scope, right.scope);
        if (relation === 'overlap') record(score, 'fail', `${left.id8}/${right.id8}: scopes overlap (${left.scope} ↔ ${right.scope})`);
        else if (relation === 'unknown') record(score, 'unscored', `${left.id8}/${right.id8}: concurrent, but one or both scopes are not path-like`);
        else record(score, 'pass', `${left.id8}/${right.id8}: concurrent scopes are disjoint`);
      }
    }
  }
  return score;
}

function workerKeyFor(order: OrderRecord): string | undefined {
  if (typeof order.dispatch.workerKey === 'string') return order.dispatch.workerKey;
  if (typeof order.dispatch.worker === 'string') return order.dispatch.worker;
  if (order.worker) return order.worker;
  if (order.planPart?.worker) return order.planPart.worker;
  return undefined;
}

function scoreRosterFit(orders: OrderRecord[], roster: RosterEntry[]): Tally {
  const score = tally();
  for (const order of orders) {
    const chosenKey = workerKeyFor(order);
    if (roster.length === 0) {
      record(score, 'unscored', `${order.id8}: no roster snapshot in brief.md`);
      continue;
    }
    if (!chosenKey) {
      record(score, 'unscored', `${order.id8}: selected worker is absent from dispatch, order and plan`);
      continue;
    }
    const matching = roster.filter((entry) => entry.key === chosenKey);
    if (matching.length !== 1) {
      record(score, 'fail', `${order.id8}: selected worker ${chosenKey} is not a unique roster entry`);
      continue;
    }
    const worker = matching[0]!;
    record(score, 'pass', `${order.id8}: ${chosenKey} is in the roster`);
    if (!order.kind) record(score, 'unscored', `${order.id8}: order kind is missing`);
    else if (!worker.kinds || worker.kinds.length === 0 || worker.kinds.includes(order.kind)) {
      record(score, 'pass', `${order.id8}: ${chosenKey} suits ${order.kind}`);
    } else {
      record(score, 'fail', `${order.id8}: ${chosenKey} does not list ${order.kind} in its kinds`);
    }
    if (!order.requiredTier) record(score, 'unscored', `${order.id8}: required tier is not recorded in order.md`);
    else if (!worker.tier || TIER_RANK[worker.tier] === undefined || TIER_RANK[order.requiredTier] === undefined) {
      record(score, 'unscored', `${order.id8}: selected or required tier is missing/unknown`);
    } else if (TIER_RANK[worker.tier]! >= TIER_RANK[order.requiredTier]!) {
      record(score, 'pass', `${order.id8}: ${worker.tier} tier meets required ${order.requiredTier}`);
    } else {
      record(score, 'fail', `${order.id8}: ${worker.tier} tier is below required ${order.requiredTier}`);
    }
  }
  return score;
}

function reportStatus(order: OrderRecord): string | undefined {
  return typeof order.report?.status === 'string' ? order.report.status : undefined;
}

function isFailedOrBlocked(order: OrderRecord): boolean {
  const status = String(order.settle?.status ?? '');
  const structuredStatus = reportStatus(order);
  return status === 'failed' || status === 'cancelled' || order.settle?.reportStatus === 'failed' || order.settle?.reportStatus === 'blocked'
    || structuredStatus === 'failed' || structuredStatus === 'blocked';
}

function titleKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function scoreFailureDisposition(orders: OrderRecord[], inbox: InboxArtifact[]): Tally {
  const score = tally();
  for (const failed of orders.filter(isFailedOrBlocked)) {
    const failedAt = timeOf(failed.settle) ?? timeOf(failed.dispatch) ?? -1;
    const retry = orders.find((candidate) => candidate.runId !== failed.runId
      && (titleKey(candidate.title) === titleKey(failed.title)
        || candidate.retryOf === failed.runId
        || candidate.retryOf === failed.id8)
      && (timeOf(candidate.dispatch) ?? candidate.dispatchIndex) > failedAt);
    const status = reportStatus(failed);
    const reportIsDisclosure = Boolean(failed.reportText && (status === 'failed' || status === 'blocked'));
    const identity = [failed.runId, failed.id8, failed.title].filter((value) => value.length >= 4);
    const inboxReference = inbox.find((message) =>
      identity.some((value) => message.text.toLocaleLowerCase('en-US').includes(value.toLocaleLowerCase('en-US')))
      && /\b(fail(?:ed|ure)?|block(?:ed)?|error|guard)\b/i.test(message.text),
    );
    if (retry) record(score, 'pass', `${failed.id8}: failure was followed by a retry (${retry.id8})`);
    else if (reportIsDisclosure) record(score, 'pass', `${failed.id8}: ${status} outcome is persisted in its report.md`);
    else if (inboxReference) record(score, 'pass', `${failed.id8}: failure is referenced in ${inboxReference.path}`);
    else record(score, 'fail', `${failed.id8}: failed/blocked outcome has no persisted report or later retry`);
  }
  return score;
}

function planPartByRunId(parts: PlanPart[]): Map<string, PlanPart> {
  const result = new Map<string, PlanPart>();
  for (const part of parts) if (part.runId) result.set(part.runId, part);
  return result;
}

function sourceRunId(source: unknown, orders: OrderRecord[]): string | undefined {
  if (typeof source !== 'string' || !source.trim()) return undefined;
  const value = source.trim();
  const exact = orders.find((order) => order.runId === value || order.id8 === value);
  if (exact) return exact.runId;
  const branch = value.replace(/\\/g, '/').split('/').at(-1) ?? value;
  const short = branch.match(/(?:^|[^0-9a-f])([0-9a-f]{8})(?:$|[^0-9a-f])/i)?.[1];
  return short ? orders.find((order) => order.id8.toLowerCase() === short.toLowerCase())?.runId : undefined;
}

function dependenciesOf(order: OrderRecord, orders: OrderRecord[], partById: Map<string, PlanPart>): string[] {
  const fromPlan = order.planPart?.after?.flatMap((partId) => {
    const part = partById.get(partId);
    return part?.runId ? [part.runId] : [];
  }) ?? [];
  const fromOrder = order.after.flatMap((dependencyId) => {
    const dependency = orders.find((candidate) => candidate.runId === dependencyId || candidate.id8.toLowerCase() === dependencyId.slice(0, 8).toLowerCase());
    return dependency ? [dependency.runId] : [dependencyId];
  });
  return [...new Set([...fromPlan, ...fromOrder])];
}

function reportChecksPassed(order: OrderRecord): boolean {
  const checks = order.report?.checks;
  return Array.isArray(checks) && checks.length > 0 && checks.every((check) =>
    check !== null && typeof check === 'object' && (check as Record<string, unknown>).exitCode === 0,
  );
}

function parseFileList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.every((entry) => typeof entry === 'string')) return undefined;
    return value as string[];
  }
  if (typeof value !== 'string' || !value.trim() || /\+\s*\d+\s+more|omitted/i.test(value)) return undefined;
  const files = value.split(/,\s*/).map((entry) => entry.trim().replace(/^[-*]\s*/, '').replace(/^`|`$/g, ''));
  return files.every(Boolean) ? files : undefined;
}

function reportedFiles(order: OrderRecord): string[] | undefined {
  const structuredFiles = parseFileList(order.report?.files);
  if (structuredFiles) return structuredFiles;

  for (const text of [order.reportText, order.orderText]) {
    if (!text) continue;
    const match = text.match(/(?:^|[;·])\s*(?:[-*]\s*)?files\s*:\s*([^;·\r\n]+)/im);
    const files = match ? parseFileList(match[1]) : undefined;
    if (files) return files;
  }
  return undefined;
}

function isDocumentationPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').toLocaleLowerCase('en-US');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..')) return false;
  return /\.(?:md|mdx|txt)$/.test(normalized) || normalized.startsWith('docs/') || normalized.startsWith('.ai/specs/');
}

function docsOnly(order: OrderRecord): boolean {
  const files = reportedFiles(order);
  return Boolean(files?.length && files.every(isDocumentationPath));
}

const START_EVENT_TYPES = new Set(['start', 'started', 'run-start', 'run-started', 'worker-start', 'worker-started', 'guard-ask', 'verify']);

function ledgerShowsStarted(order: OrderRecord, events: LedgerEvent[]): boolean {
  return events.some((event) => {
    if (event.runId !== order.runId && event.targetRunId !== order.runId) return false;
    if (typeof event.type === 'string' && START_EVENT_TYPES.has(event.type.toLocaleLowerCase('en-US'))) return true;
    if (event.started === true || event.everStarted === true) return true;
    return ['startedAt', 'runStartedAt'].some((key) => {
      if (!Object.prototype.hasOwnProperty.call(event, key)) return false;
      const value = event[key];
      if (value === null || value === undefined) return false;
      return true;
    });
  });
}

function cancelledBeforeStart(order: OrderRecord, events: LedgerEvent[]): boolean {
  return String(order.settle?.status ?? '') === 'cancelled' && !ledgerShowsStarted(order, events);
}

function scoreMerges(events: LedgerEvent[], orders: OrderRecord[], parts: PlanPart[]): Tally {
  const score = tally();
  const partById = new Map(parts.flatMap((part) => part.id ? [[part.id, part] as const] : []));
  const merges = events.filter((event) => event.type === 'merge' && event.into === 'task' && ['merged', 'up-to-date'].includes(String(event.outcome)));
  const mergeTimes = new Map<string, number>();
  for (const event of merges) {
    const runId = sourceRunId(event.source, orders);
    const at = timeOf(event);
    if (runId && at !== undefined) mergeTimes.set(runId, Math.min(mergeTimes.get(runId) ?? Number.POSITIVE_INFINITY, at));
  }
  for (const merge of merges) {
    const runId = sourceRunId(merge.source, orders);
    const order = runId ? orders.find((candidate) => candidate.runId === runId) : undefined;
    if (!order) {
      record(score, 'unscored', `merge source ${String(merge.source ?? '(missing)')} does not identify a worker`);
      continue;
    }
    const mergeAt = timeOf(merge);
    const verifyPassed = events.some((event) => event.type === 'verify'
      && event.targetRunId === order.runId && event.state === 'passed'
      && timeOf(event) !== undefined && mergeAt !== undefined && timeOf(event)! <= mergeAt)
      || (reportChecksPassed(order) && timeOf(order.settle) !== undefined && mergeAt !== undefined && timeOf(order.settle)! <= mergeAt);
    if (docsOnly(order)) record(score, 'pass', `${order.id8}: docs-only, no checks needed`);
    else if (verifyPassed) record(score, 'pass', `${order.id8}: merge followed a passing verify or all-passing worker checks`);
    else record(score, 'fail', `${order.id8}: merge had no earlier passing verify or all-passing worker checks`);

    const dependencies = dependenciesOf(order, orders, partById);
    if (dependencies.length === 0) {
      record(score, 'pass', `${order.id8}: no declared merge dependency`);
      continue;
    }
    for (const dependency of dependencies) {
      const dependencyMergeAt = mergeTimes.get(dependency);
      const dependencyOrder = orders.find((candidate) => candidate.runId === dependency);
      const dependencyStatus = String(dependencyOrder?.settle?.status ?? dependencyOrder?.report?.status ?? '');
      if (dependencyMergeAt === undefined || mergeAt === undefined) {
        record(score, 'fail', `${order.id8}: dependency ${dependency.slice(0, 8)} was not merged before it`);
      } else if (dependencyMergeAt >= mergeAt) {
        record(score, 'fail', `${order.id8}: dependency ${dependency.slice(0, 8)} merged later or at the same time`);
      } else if (dependencyStatus && !['done', 'review'].includes(dependencyStatus) && dependencyOrder?.report?.status !== 'done') {
        record(score, 'fail', `${order.id8}: dependency ${dependency.slice(0, 8)} was not reported done before merge`);
      } else {
        record(score, 'pass', `${order.id8}: dependency ${dependency.slice(0, 8)} merged earlier`);
      }
    }
  }
  return score;
}

function criterion<TId extends CriterionScore['id']>(id: TId, score: Tally): CriterionScore {
  const metadata = CRITERIA.find((entry) => entry.id === id)!;
  return { id, label: metadata.label, status: resultStatus(score), passed: score.passed, failed: score.failed, unscored: score.unscored, details: score.details };
}

/**
 * Deterministic, tree-only manager evaluation. It never starts a server, browser, worker or network call.
 * Optional roster/tier annotations are documented in docs/design/manager-eval.md; absent data is unscored.
 */
export function scoreManagerTree(treeDir: string): ManagerEvaluation {
  const diagnostics: string[] = [];
  if (!existsSync(treeDir)) return { treeDir, criteria: CRITERIA.map(({ id }) => criterion(id, tally())), diagnostics: ['tree directory does not exist'] };

  const events = parseLedger(treeDir, diagnostics);
  const parts = parsePlan(treeDir, diagnostics);
  const partByRun = planPartByRunId(parts);
  const dispatches = events.flatMap((event, index) => event.type === 'dispatch' && typeof event.runId === 'string'
    ? [{ event, index }]
    : []);
  const settles = new Map<string, { event: LedgerEvent; index: number }>();
  for (const [index, event] of events.entries()) {
    if (event.type === 'settle' && typeof event.runId === 'string') settles.set(event.runId, { event, index });
  }

  const orders = dispatches.map(({ event, index }) => {
    const runId = String(event.runId);
    const order = parseOrder(treeDir, runId, typeof event.title === 'string' ? event.title : runId.slice(0, 8), event, index, diagnostics);
    const settled = settles.get(runId);
    const planPart = partByRun.get(runId);
    if (settled) {
      order.settle = settled.event;
      order.settleIndex = settled.index;
    }
    if (planPart) {
      order.planPart = planPart;
      if (!order.after.length && Array.isArray(planPart.after)) {
        // Resolve part ids after the complete plan index is available below.
        order.after = [];
      }
    }
    return order;
  });
  const roster = parseRoster(readText(join(treeDir, 'brief.md')), diagnostics);
  const inbox = readInbox(treeDir);
  const partById = new Map(parts.flatMap((part) => part.id ? [[part.id, part] as const] : []));
  for (const order of orders) {
    if (order.planPart?.after?.length && order.after.length === 0) {
      order.after = order.planPart.after.flatMap((partId) => {
        const dependency = partById.get(partId);
        return dependency?.runId ? [dependency.runId] : [];
      });
    }
  }

  // A guard ask is persisted even if a worker never settles; include it as a blocked attempt.
  for (const event of events) {
    if (event.type !== 'guard-ask' || typeof event.runId !== 'string') continue;
    const order = orders.find((candidate) => candidate.runId === event.runId);
    if (order && !order.settle) {
      order.settle = { type: 'settle', runId: event.runId, status: 'cancelled', reportStatus: 'blocked', at: event.at };
    }
  }
  for (const order of orders) order.neverStarted = cancelledBeforeStart(order, events);

  return {
    treeDir,
    criteria: [
      criterion('concurrent-scopes', scoreConcurrentScopes(orders)),
      criterion('roster-fit', scoreRosterFit(orders, roster)),
      criterion('failure-disposition', scoreFailureDisposition(orders, inbox)),
      criterion('merge-order-and-checks', scoreMerges(events, orders, parts)),
    ],
    diagnostics,
  };
}

export function formatManagerEvaluation(evaluation: ManagerEvaluation): string {
  const width = Math.max('Criterion'.length, ...evaluation.criteria.map((item) => item.label.length));
  const lines = [`Manager evaluation: ${evaluation.treeDir}`, '', `${'Criterion'.padEnd(width)}  Score`];
  for (const item of evaluation.criteria) {
    const score = item.status === 'n/a'
      ? 'N/A'
      : `${item.status.toUpperCase()} (${item.passed} pass, ${item.failed} fail, ${item.unscored} unscored)`;
    lines.push(`${item.label.padEnd(width)}  ${score}`);
  }
  if (evaluation.diagnostics.length) {
    lines.push('', 'Diagnostics:');
    for (const detail of evaluation.diagnostics) lines.push(`- ${detail}`);
  }
  const details = evaluation.criteria.flatMap((item) => item.details.map((detail) => `${item.label}: ${detail}`));
  if (details.length) {
    lines.push('', 'Evidence:');
    for (const detail of details) lines.push(`- ${detail}`);
  }
  return lines.join('\n');
}
