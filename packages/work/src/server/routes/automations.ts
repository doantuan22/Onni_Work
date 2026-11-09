import { randomUUID } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { deferredStartOptions, previewDeferredStart, digest, validateDeferredBinding } from '../../automations/deferred-start.ts';
import { resolveDeferredReset } from '../../automations/deferred-reset.ts';
import { GithubPoller } from '../../automations/github-poller.ts';
import { ProjectAutomationScheduler, ProjectTrackerAutomationScheduler, type ProjectAutomationHandle } from '../../automations/scheduler.ts';
import { ScheduleRunner } from '../../automations/schedule-runner.ts';
import { TrackerPoller } from '../../automations/tracker-poller.ts';
import { automationStats } from '../../automations/stats.ts';
import { AutomationLaunchOutcome, launchAutomationRun, launchTrackerAutomationRun, reconcileAutomationReceipts, validateAutomationPrompt } from '../../automations/task-template.ts';
import { isGithubAutomation, isScheduleAutomation, isTrackerAutomation, type AutomationDefinition } from '../../automations/types.ts';
import {
  deferredCreateInputSchema, deferredMutationQuerySchema, deferredOptionsInputSchema, deferredPreviewInputSchema,
  localTimeZone, type AutomationEvent, type AutomationFilters, type AutomationLogResult, type AutomationSchedule,
  type AutomationTask, type TrackerTrigger,
} from '@onni/contract';
import { parseRemote, resolveForge, type ForgeAvailability } from '../forge/index.ts';
import { getRepoInfo } from '../git.ts';
import type { AutomationStore } from '../../automations/store.ts';
import type { ProviderId } from '../../core/provider-auth.ts';
import type { createTrackerService } from '../tracker/index.ts';
import type { ProjectContext } from '../project-context.ts';
import { isGithubHost } from '../../github-hosts.ts';
import type { RunRecord, RunStore } from '../../runs/store.ts';
import { createAutomationChecksRoutes, type ManualCheck } from './automation-checks.ts';
import { jsonZodValidator, queryZodValidator } from '../validators.ts';
import type { z } from 'zod';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

type AutomationEditableBody = {
  name: string;
  description?: string;
  enabled?: boolean;
  kind?: 'github' | 'schedule' | 'tracker';
  events?: AutomationEvent[];
  intervalSeconds?: number;
  filters?: AutomationFilters;
  trackerTrigger?: TrackerTrigger;
  schedule?: AutomationSchedule;
  task: AutomationTask;
};

type AutomationCreateBody = AutomationEditableBody & { enable?: boolean };
type AutomationUpdateBody = AutomationEditableBody & { expectedRevision: number };
type AutomationCheckRequest = { mode: 'preview' | 'execute' };
type AutomationLogQuery = {
  automationId?: string;
  result?: AutomationLogResult;
  event?: AutomationEvent;
  since?: string;
  cursor?: number;
  limit?: number;
};

type AutomationRouteCapabilities = { automations: boolean; costMetrics: boolean; dispatch: boolean };

type AutomationRunMap = Record<string, {
  title: string; status: RunRecord['status']; costUsd?: number;
  children: Array<{ runId: string; kind?: NonNullable<RunRecord['dispatch']>['kind']; title: string; status: RunRecord['status']; costUsd?: number }>;
}>;

type ScheduleHandle = ConstructorParameters<typeof ScheduleRunner>[0];

type AutomationsRouteDeps<
  TCreateSchema extends z.ZodType<AutomationCreateBody, any>,
  TUpdateSchema extends z.ZodType<AutomationUpdateBody, any>,
  TCheckSchema extends z.ZodType<AutomationCheckRequest, any>,
  TLogSchema extends z.ZodType<AutomationLogQuery, any>,
> = {
  requireAutomations: MiddlewareHandler<ProjectApiEnv>;
  capabilities: () => AutomationRouteCapabilities;
  automationsChanged: () => void;
  emitAutomationChange: (project: ProjectContext, automationId: string, revision: number, deleted?: boolean) => void;
  automationCreateSchema: TCreateSchema;
  automationUpdateSchema: TUpdateSchema;
  automationCheckRequestSchema: TCheckSchema;
  automationLogQuerySchema: TLogSchema;
  automationKindIssue: (body: AutomationEditableBody, kind: 'github' | 'schedule' | 'tracker') => string | null;
  oncePassedIssue: (schedule: AutomationSchedule | undefined, enabled: boolean) => string | null;
  editableAutomation: (definition: AutomationDefinition) => AutomationEditableBody;
  launchFailedMessage: (outcome: { reason?: string }) => string;
  automationAccountIssue: (root: string, task: { runner?: ProviderId; agentProfile?: string }) => Promise<string | null>;
  trackerTriggerIssue: (project: ProjectContext, trigger: AutomationEditableBody['trackerTrigger']) => Promise<string | null>;
  armAutomation: (store: AutomationStore, automation: AutomationDefinition) => void;
  scheduleHandle: (project: ProjectContext) => ScheduleHandle;
  logRunsOf: (runStore: RunStore, records: ReadonlyArray<{ runId?: string }>) => AutomationRunMap;
  manualChecks: Map<string, ManualCheck>;
  trackers: ReturnType<typeof createTrackerService>;
  AUTOMATIONS_OFF: string;
};

export function createAutomationsRoutes<
  TCreateSchema extends z.ZodType<AutomationCreateBody, any>,
  TUpdateSchema extends z.ZodType<AutomationUpdateBody, any>,
  TCheckSchema extends z.ZodType<AutomationCheckRequest, any>,
  TLogSchema extends z.ZodType<AutomationLogQuery, any>,
>(deps: AutomationsRouteDeps<TCreateSchema, TUpdateSchema, TCheckSchema, TLogSchema>) {
  const {
    requireAutomations, capabilities, automationsChanged, emitAutomationChange,
    automationCreateSchema, automationUpdateSchema, automationCheckRequestSchema, automationLogQuerySchema,
    automationKindIssue, oncePassedIssue, editableAutomation, launchFailedMessage, automationAccountIssue,
    trackerTriggerIssue, armAutomation, scheduleHandle, logRunsOf, manualChecks, trackers, AUTOMATIONS_OFF,
  } = deps;
  // ---- chained family: GitHub automations (project-scoped) ----
  // Every handler below reads `c.get('project')` — the definitions, their runtime state and the
  // execution log are per-project files — so the family is project-scoped and mounted with the
  // rest of the mirrored table. The one exception is the manual-check read, which touches no
  // project at all; it is its own workspace-level family below.
  return new Hono<ProjectApiEnv>()
    .use('/automations', requireAutomations)
    .use('/automations/*', requireAutomations)
    .use('/automation-log', requireAutomations)
    .use('/automation-log/*', requireAutomations)
    .post('/deferred-start/options', jsonZodValidator(deferredOptionsInputSchema), async (c) => {
      return c.json(await deferredStartOptions(c.get('project').root, c.req.valid('json').task, capabilities().automations));
    })
    .post('/deferred-start/preview', requireAutomations, jsonZodValidator(deferredPreviewInputSchema), async (c) => {
      const result = await previewDeferredStart(c.get('project').root, c.req.valid('json'), capabilities().automations, resolveDeferredReset);
      return c.json(result.preview);
    })
    .post('/deferred-start', jsonZodValidator(deferredCreateInputSchema), async (c) => {
      const project = c.get('project');
      const input = c.req.valid('json');
      const requestDigest = digest({ task: input.task, start: input.start, previewRevision: input.previewRevision });
      const store = project.automationStore;
      const lease = store.acquireLease();
      if (!lease) return c.json({ error: 'Scheduling is busy. Retry with the same request.' }, 409);
      try {
        const previous = store.creation(input.idempotencyKey);
        if (previous) return previous.requestDigest === requestDigest
          ? c.json({ scheduled: previous }, 201)
          : c.json({ error: 'This creation key belongs to a different request.' }, 409);
        // A replay only acknowledges existing state; disabling scheduling must not
        // trap a client recovering a lost response. New creation remains disabled.
        if (!capabilities().automations) return c.json({ error: AUTOMATIONS_OFF }, 409);
        const resolved = await previewDeferredStart(project.root, input, capabilities().automations, resolveDeferredReset);
        if (!resolved.preview.available) return c.json({ error: resolved.preview.message }, 400);
        if (resolved.preview.previewRevision !== input.previewRevision || !lease.isValid()) return c.json({ error: 'Settings or reset time changed. Check the preview again.' }, 409);
        if ((input.task.variants ?? 1) > 1 && !await getRepoInfo(project.root)) return c.json({ error: 'Parallel variants need a git repository.' }, 400);
        const { task, images: _images, todoId: _todoId, variants, ...fields } = input.task;
        const automation = store.create({
          name: task.trim().replace(/\s+/g, ' ').slice(0, 100), kind: 'schedule', enabled: true,
          schedule: resolved.schedule!,
          task: { ...fields, prompt: task, variants: (variants ?? 1) as 1 | 2 | 3 },
          deferredStart: { origin: 'composer', reason: input.start.kind, notBefore: resolved.preview.notBefore,
            timeZone: resolved.preview.timeZone, binding: resolved.binding!, creationKey: input.idempotencyKey,
            requestDigest, status: 'pending', runIds: [] },
        });
        emitAutomationChange(project, automation.id, automation.revision);
        automationsChanged();
        return c.json({ scheduled: store.creation(input.idempotencyKey)! }, 201);
      } catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
      finally { lease.release(); }
    })
    .get('/automations', async (c) => {
      const { root, automationStore } = c.get('project');
      const forge = resolveForge(await getRepoInfo(root));
      // Annotated, so the two branches are ONE shape rather than a union of two: the fallback
      // literal always carries `reason`, the cached answer only sometimes does, and the route
      // type is what `contract/src/automations.ts` has to describe.
      // A cold cache (first read after boot) waits for the probe instead of answering "still being
      // checked": nothing re-reads this page when the background probe lands, so that answer
      // would lock the editor's GitHub trigger off. Only `/api/health` has a latency budget.
      const availability: ForgeAvailability = forge
        ? forge.detectCached() ?? (await forge.detect())
        : { available: false, reason: 'No GitHub remote is configured' };
      const definitions = automationStore.list();
      const logsById = new Map(definitions.map((definition) => [definition.id, automationStore.logs({ automationId: definition.id, limit: 100 })] as const));
      const timeZone = localTimeZone();
      // Derived, never stored (spec 2026-09-14 § Proposed Solution 4).
      const stats = automationStats({
        definitions,
        logs: [...logsById.values()].flat(),
        runs: c.get('project').store.listRuns(),
        now: Date.now(),
        timeZone,
        costMetrics: capabilities().costMetrics,
      });
      const automations = definitions.map((automation) => {
        const logs = logsById.get(automation.id) ?? [];
        const state = automationStore.state(automation.id);
        const latestLog = logs[0];
        const row = stats.rows.get(automation.id);
        const nextRunAt = automation.enabled ? (automation.kind === 'schedule' ? state?.nextRunAt : state?.nextCheckAt) : undefined;
        return {
          ...automation,
          // Spread conditionally, never `state: maybeUndefined`: the latter types the key as
          // always-present while `JSON.stringify` drops it from the wire, so the contract would
          // have to describe a key consumers never receive.
          ...(state ? { state } : {}),
          ...(latestLog ? { latestLog } : {}),
          counts: {
            matches: logs.filter((row) => row.result === 'launched' || row.result === 'duplicate').length,
            launched: logs.filter((row) => row.result === 'launched' || row.result === 'manual' || row.result === 'catch-up').length,
            duplicates: logs.filter((row) => row.result === 'duplicate').length,
            errors: logs.filter((row) => row.result === 'error' || row.result === 'rate-limited' || row.result === 'failed').length,
          },
          ...(nextRunAt ? { nextRunAt } : {}),
          ...(row?.lastRun ? { lastRun: row.lastRun } : {}),
          runs7d: row?.runs7d ?? 0,
          ...(row?.costUsd7d !== undefined ? { costUsd7d: row.costUsd7d } : {}),
        };
      });
      const nextDue = automations.map((item) => item.nextRunAt).filter(Boolean).sort()[0];
      return c.json({
        ...availability,
        scheduler: {
          // `as const` on both arms: in an object literal a conditional of two string literals
          // widens to `string`, which would erase the two states this key can hold.
          state: automations.some((item) => item.enabled) ? ('scheduled' as const) : ('idle' as const),
          ...(nextDue ? { nextDue } : {}),
        },
        timeZone,
        stats: stats.week,
        automations,
      });
    })

    .post('/automations', jsonZodValidator(() => automationCreateSchema), async (c) => {
      const { automationStore } = c.get('project');
      const parsed = { data: c.req.valid('json') };
      const kind = parsed.data.kind ?? 'github';
      const kindIssue = automationKindIssue(parsed.data, kind);
      if (kindIssue) return c.json({ error: kindIssue }, 400);
      if (kind === 'tracker') {
        const issue = await trackerTriggerIssue(c.get('project'), parsed.data.trackerTrigger);
        if (issue) return c.json({ error: issue }, 400);
      }
      const passedIssue = oncePassedIssue(parsed.data.schedule, parsed.data.enable === true);
      if (passedIssue) return c.json({ error: passedIssue }, 400);
      const promptIssue = validateAutomationPrompt(parsed.data.task.prompt, kind);
      if (promptIssue) return c.json({ error: promptIssue }, 400);
      const accountIssue = await automationAccountIssue(c.get('project').root, parsed.data.task);
      if (accountIssue) return c.json({ error: accountIssue }, 400);
      const { enable, ...input } = parsed.data;
      try {
        const automation = automationStore.create(
          { ...input, kind, enabled: enable === true },
          undefined,
          enable ? definition => armAutomation(automationStore, definition) : undefined,
        );
        emitAutomationChange(c.get('project'), automation.id, automation.revision);
        automationsChanged();
        return c.json({ automation }, 201);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    })

    .get('/automations/:id', (c) => {
      const { automationStore } = c.get('project');
      const automation = automationStore.get(c.req.param('id'));
      if (!automation) return c.json({ error: 'not found' }, 404);
      const state = automationStore.state(automation.id);
      const latestLog = automationStore.logs({ automationId: automation.id, limit: 1 })[0];
      return c.json({
        automation,
        ...(state ? { state } : {}),
        ...(latestLog ? { latestLog } : {}),
      });
    })

    .put('/automations/:id', jsonZodValidator(() => automationUpdateSchema), async (c) => {
      const { automationStore } = c.get('project');
      const parsed = { data: c.req.valid('json') };
      const current = automationStore.get(c.req.param('id'));
      if (!current) return c.json({ error: 'not found' }, 404);
      // The stored kind unless the body names one; a switch is refused — receipts and cursors
      // are kind-specific, and a silent swap would orphan them (spec 2026-09-14 § Edge cases).
      if (current.deferredStart) {
        const lease = automationStore.acquireLease();
        if (!lease) return c.json({ error: 'The scheduled task is being launched. Refresh its status.' }, 409);
        try {
          const fresh = automationStore.get(current.id);
          if (!fresh?.deferredStart || fresh.revision !== parsed.data.expectedRevision || fresh.deferredStart.runIds.length) return c.json({ error: 'The task changed or its launch was already claimed.' }, 409);
          if (digest(parsed.data.task) !== digest(fresh.task) || parsed.data.name !== fresh.name || parsed.data.kind !== 'schedule' || parsed.data.schedule?.type !== 'once') return c.json({ error: 'Cancel and submit a new task to change its prompt or settings.' }, 409);
          await validateDeferredBinding(c.get('project').root, fresh);
          const { prompt, ...fields } = fresh.task;
          const schedule = parsed.data.schedule;
          const resolved = await previewDeferredStart(c.get('project').root, { task: { ...fields, task: prompt }, start: { kind: 'at', date: schedule.date ?? '', hour: schedule.hour ?? 0, minute: schedule.minute ?? 0 } }, true);
          if (!resolved.preview.available) return c.json({ error: resolved.preview.message }, 400);
          const automation = automationStore.update(fresh.id, fresh.revision, { ...fresh, schedule: resolved.schedule!, enabled: true,
            deferredStart: { ...fresh.deferredStart, reason: 'at', notBefore: resolved.preview.notBefore, timeZone: resolved.preview.timeZone, status: 'pending', failureKind: undefined, error: undefined, holdUntil: undefined, manualRequested: undefined } });
          emitAutomationChange(c.get('project'), automation.id, automation.revision);
          automationsChanged();
          return c.json({ automation });
        } catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
        finally { lease.release(); }
      }
      const kind = parsed.data.kind ?? current.kind;
      if (kind !== current.kind) return c.json({ error: 'change the kind by creating a new automation' }, 409);
      const kindIssue = automationKindIssue(parsed.data, kind);
      if (kindIssue) return c.json({ error: kindIssue }, 400);
      if (kind === 'tracker') {
        const issue = await trackerTriggerIssue(c.get('project'), parsed.data.trackerTrigger);
        if (issue) return c.json({ error: issue }, 400);
      }
      const passedIssue = oncePassedIssue(parsed.data.schedule, parsed.data.enabled === true);
      if (passedIssue) return c.json({ error: passedIssue }, 400);
      const promptIssue = validateAutomationPrompt(parsed.data.task.prompt, kind);
      if (promptIssue) return c.json({ error: promptIssue }, 400);
      const accountIssue = await automationAccountIssue(c.get('project').root, parsed.data.task);
      if (accountIssue) return c.json({ error: accountIssue }, 400);
      const { expectedRevision, ...input } = parsed.data;
      try {
        // Match the scanner's checkpoint identity: association and effective event selection.
        // Prompt and eligibility-filter edits keep progress so events since the last poll survive.
        const trackerScanIdentity = (trigger: AutomationEditableBody['trackerTrigger']) => JSON.stringify([
          trigger?.association,
          trigger?.events.length === 1 ? trigger.events[0] : undefined,
        ]);
        const trackerSourceChanged = kind === 'tracker'
          && trackerScanIdentity(current.trackerTrigger) !== trackerScanIdentity(input.trackerTrigger);
        const automation = automationStore.update(
          c.req.param('id'), expectedRevision,
          { ...input, kind, enabled: input.enabled ?? false },
          definition => {
            // Publish the new baseline and definition under the same mutation lease.
            if (kind === 'tracker' && definition.enabled && (!current.enabled || trackerSourceChanged)) armAutomation(automationStore, definition);
            else if (trackerSourceChanged) {
              // A paused definition still needs a compatible read-only preview. Clear source-bound
              // progress without arming a timer; Enable will establish its own current-time baseline.
              automationStore.setState(definition.id, state => ({
                ...state, revision: definition.revision, baselineAt: undefined, checkpoint: undefined,
                cursor: undefined, nextCheckAt: undefined, backoffUntil: undefined, consecutiveFailures: 0,
              }));
            }
          },
        );
        // An edited schedule recomputes its next occurrence; `store.update` carried the old
        // `nextRunAt` forward, so clear it and let the timer's `dueAt` persist the new one.
        if (kind === 'schedule' && JSON.stringify(current.schedule) !== JSON.stringify(automation.schedule)) {
          if (automationStore.state(automation.id)?.nextRunAt) {
            automationStore.setState(automation.id, (state) => ({ ...state, nextRunAt: undefined }));
          }
        }
        if (kind !== 'tracker' && automation.enabled && !current.enabled) armAutomation(automationStore, automation);
        if (automation.enabled !== current.enabled) {
        }
        emitAutomationChange(c.get('project'), automation.id, automation.revision);
        automationsChanged();
        return c.json({ automation });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, message.includes('conflict') ? 409 : 400);
      }
    })

    .delete('/automations/:id', queryZodValidator(deferredMutationQuerySchema), (c) => {
      const conflict = (error: string, runIds?: string[]) => c.json({ error, ...(runIds ? { runIds } : {}) }, 409);
      const id = c.req.param('id');
      const store = c.get('project').automationStore;
      const current = store.get(id);
      if (current?.deferredStart) {
        const lease = store.acquireLease();
        if (!lease) return conflict('Launch is in progress. Refresh before cancelling.');
        try {
          const fresh = store.get(id);
          if (!fresh?.deferredStart) {
            const creation = store.creationFor(id);
            return creation?.outcome === 'launched'
              ? conflict('This scheduled task already started.', creation.runIds)
              : conflict('The task changed or its launch was already claimed.');
          }
          if (fresh.revision !== c.req.valid('query').expectedRevision) return conflict('The task changed or its launch was already claimed.');
          const claimed = fresh.deferredStart.runIds;
          // An uncertain launch may be dismissed; the ledger keeps whichever recorded runs exist.
          if (claimed.length && !(fresh.deferredStart.status === 'failed' && fresh.deferredStart.failureKind === 'ambiguous')) return conflict('The task changed or its launch was already claimed.');
          const existing = new Set(c.get('project').store.listPersistedRuns().filter(r => r.automationTrigger?.automationId === id).map(r => r.id));
          store.finishDeferred(id, 'cancelled', claimed.filter(runId => existing.has(runId)));
          emitAutomationChange(c.get('project'), id, fresh.revision, true);
          automationsChanged();
          return c.body(null, 204);
        } catch (error) { return conflict(error instanceof Error ? error.message : String(error)); }
        finally { lease.release(); }
      }
      const creation = !current ? store.creationFor(id) : undefined;
      if (creation?.outcome === 'launched') return conflict('This scheduled task already started.', creation.runIds);
      if (!current || !store.delete(id)) return c.json({ error: 'not found' }, 404);
      emitAutomationChange(c.get('project'), id, current.revision, true);
      automationsChanged();
      return c.body(null, 204);
    })

    .post('/automations/:id/enable', async (c) => {
      const store = c.get('project').automationStore;
      const current = store.get(c.req.param('id'));
      if (!current) return c.json({ error: 'not found' }, 404);
      if (current.deferredStart) return c.json({ error: 'Use the scheduled task actions in Tasks.' }, 409);
      if (current.kind === 'tracker') {
        const issue = await trackerTriggerIssue(c.get('project'), current.trackerTrigger);
        if (issue) return c.json({ error: issue }, 400);
      }
      const passedIssue = oncePassedIssue(current.schedule, true);
      if (passedIssue) return c.json({ error: passedIssue }, 409);
      let automation: AutomationDefinition;
      try {
        automation = store.update(
          current.id, current.revision,
          { ...editableAutomation(current), enabled: true },
          definition => armAutomation(store, definition),
        );
      }
      catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
      emitAutomationChange(c.get('project'), automation.id, automation.revision);
      automationsChanged();
      return c.json({ automation });
    })

    .post('/automations/:id/pause', (c) => {
      const store = c.get('project').automationStore;
      const current = store.get(c.req.param('id'));
      if (!current) return c.json({ error: 'not found' }, 404);
      if (current.deferredStart) return c.json({ error: 'Use the scheduled task actions in Tasks.' }, 409);
      let automation: AutomationDefinition;
      try { automation = store.update(current.id, current.revision, { ...editableAutomation(current), enabled: false }); }
      catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
      emitAutomationChange(c.get('project'), automation.id, automation.revision);
      automationsChanged();
      return c.json({ automation });
    })

    // The body is validated as MIDDLEWARE, which is what puts it in the route type — and moves
    // the 400 ahead of this route's 404: `POST /automations/<unknown>/check` with a malformed
    // body now answers 400 rather than 404. Nothing else about either answer changed.
    .post('/automations/:id/check', jsonZodValidator(() => automationCheckRequestSchema), async (c) => {
      const project = c.get('project');
      const store = project.automationStore;
      const automation = store.get(c.req.param('id'));
      if (!automation) return c.json({ error: 'not found' }, 404);
      if (!isGithubAutomation(automation) && !isTrackerAutomation(automation)) return c.json({ error: 'Choose an event to preview, or use run for a schedule' }, 409);
      const parsed = { data: c.req.valid('json') };
      // `string`, not `randomUUID`'s template-literal type: the wire carries an opaque id, and
      // leaking `${string}-${string}-…` into the route type would make the contract describe the
      // generator rather than the answer.
      const id: string = randomUUID();
      const check: ManualCheck = { id, automationId: automation.id, mode: parsed.data.mode, status: 'queued', createdAt: new Date().toISOString() };
      if (manualChecks.size >= 200) manualChecks.delete(manualChecks.keys().next().value!);
      manualChecks.set(id, check);
      void (async () => {
        check.status = 'running';
        try {
          if (isTrackerAutomation(automation)) {
            const scheduler = new ProjectTrackerAutomationScheduler({ projectId: project.id, store, timeZone: localTimeZone(),
              tracker: { getDriver: () => trackers.driver(project.root, project.dataDir), poller: new TrackerPoller() },
              launchTracker: (definition, candidate, receiptId) => launchTrackerAutomationRun({ root: project.root, manager: project.manager, store: project.store, definition, candidate, receiptId, dispatchEnabled: capabilities().dispatch }),
              onChange: (id, revision) => emitAutomationChange(project, id, revision),
            });
            const result = await scheduler.check(automation, parsed.data.mode);
            Object.assign(check, { status: 'complete', completedAt: new Date().toISOString(), matches: result.candidates.length, truncated: result.truncated });
            return;
          }
          const remote = parseRemote((await getRepoInfo(project.root))?.remote ?? '');
          if (!remote || !isGithubHost(remote.host)) throw new Error('No GitHub remote is configured');
          const scheduler = new ProjectAutomationScheduler({
            projectId: project.id,
            timeZone: localTimeZone(),
            store,
            github: { owner: remote.owner, repo: remote.repo, poller: new GithubPoller({ host: remote.host }) },
            launch: parsed.data.mode === 'execute'
              ? (definition, candidate, receiptId) => launchAutomationRun({ root: project.root, manager: project.manager, store: project.store, definition, candidate, receiptId, dispatchEnabled: capabilities().dispatch })
              : undefined,
            onChange: (automationId, revision) => emitAutomationChange(project, automationId, revision),
          });
          const result = await scheduler.check(automation, parsed.data.mode);
          Object.assign(check, { status: 'complete', completedAt: new Date().toISOString(), matches: result.candidates.length, truncated: result.truncated });
        } catch (error) {
          Object.assign(check, { status: 'error', completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return c.json({ checkId: id }, 202);
    })

    // A scheduled automation fired NOW, by hand (spec 2026-09-14 Q10): paused or not, the
    // definition's `enabled` and `nextRunAt` are untouched — this is a launch, not an arm.
    .post('/automations/:id/run', queryZodValidator(deferredMutationQuerySchema), async (c) => {
      const project = c.get('project');
      const store = project.automationStore;
      const automation = store.get(c.req.param('id'));
      if (!automation) return c.json({ error: 'not found' }, 404);
      if (automation.deferredStart && automation.revision !== c.req.valid('query').expectedRevision) return c.json({ error: 'The task changed. Refresh before running it.' }, 409);
      if (!isScheduleAutomation(automation)) return c.json({ error: 'a GitHub automation is run through check with mode execute' }, 409);
      const runner = new ScheduleRunner(scheduleHandle(project));
      const outcome = await runner.runNow(automation);
      if (outcome.result === 'lease-held') return c.json({ error: 'automation polling lease is held by another process' }, 409);
      if (outcome.result === 'duplicate') return c.json({ error: 'this instant was already launched' }, 409);
      if (!('runId' in outcome)) {
        automationsChanged();
        return c.json({ error: automation.deferredStart
          ? store.get(automation.id)?.deferredStart?.error ?? 'The task could not start. Refresh its details in Tasks.'
          : launchFailedMessage(outcome) }, 409);
      }
      automationsChanged();
      return c.json({ runId: outcome.runId }, 202);
    })

    .get('/automation-log', queryZodValidator(automationLogQuerySchema), (c) => {
      const project = c.get('project');
      const records = project.automationStore.logs(c.req.valid('query'));
      return c.json({ records, runs: logRunsOf(project.store, records) });
    })

    .post('/automation-log/:receiptId/retry', async (c) => {
      const project = c.get('project');
      const store = project.automationStore;
      try { reconcileAutomationReceipts(store, project.store, { strict: true }); }
      catch { return c.json({ error: 'Cannot safely reconcile automation receipts; try again.' }, 409); }
      const receipt = [...store.latestReceipts().values()].find((row) => row.receiptId === c.req.param('receiptId'));
      if (!receipt) return c.json({ error: 'not found' }, 404);
      if (receipt.status !== 'launch-error' || receipt.runId) return c.json({ error: 'receipt is not retryable' }, 409);
      const definition = store.get(receipt.automationId);
      if (!definition) return c.json({ error: 'automation not found' }, 404);
      if (definition.deferredStart) return c.json({ error: 'Use Retry in Tasks with the current revision.' }, 409);
      // A schedule receipt retries as a by-hand launch of the same occurrence, under the same
      // receipt (spec 2026-09-14 § API).
      if (isScheduleAutomation(definition)) {
        const outcome = await new ScheduleRunner(scheduleHandle(project)).retry(definition, receipt);
        if (outcome.result === 'lease-held') return c.json({ error: 'automation polling lease is held by another process' }, 409);
        if (!('runId' in outcome)) return c.json({ error: launchFailedMessage(outcome) }, 409);
        return c.json({ receiptId: receipt.receiptId, runId: outcome.runId }, 202);
      }
      if (isTrackerAutomation(definition)) {
        const candidate = receipt.trackerCandidate;
        if (!candidate?.association || !candidate.event || !candidate.issueId || !candidate.change) return c.json({ error: 'Receipt predates event context and cannot be retried safely' }, 409);
        if (receipt.revision !== definition.revision) return c.json({ error: 'Automation changed since this event; retry is no longer safe' }, 409);
        const issue = await trackerTriggerIssue(project, definition.trackerTrigger);
        if (issue) return c.json({ error: issue }, 409);
        const lease = store.acquireLease();
        if (!lease) return c.json({ error: 'automation polling lease is held by another process' }, 409);
        const mutation = store.acquireMutationLease();
        if (!mutation) { lease.release(); return c.json({ error: 'automation mutation conflict' }, 409); }
        try {
          if (store.get(definition.id)?.revision !== definition.revision) return c.json({ error: 'automation revision conflict' }, 409);
          try { reconcileAutomationReceipts(store, project.store, { strict: true }); }
          catch { return c.json({ error: 'Cannot safely reconcile automation receipts; try again.' }, 409); }
          if (!store.reserveRetry(receipt.receiptId)) return c.json({ error: 'receipt is not retryable' }, 409);
          const launched = await launchTrackerAutomationRun({ root: project.root, manager: project.manager, store: project.store, definition,
            candidate: { ...candidate, association: candidate.association, event: candidate.event, issueId: candidate.issueId, change: candidate.change }, receiptId: receipt.receiptId, dispatchEnabled: capabilities().dispatch });
          store.appendReceipt({ ...receipt, status: 'launched', runId: launched.runId, updatedAt: new Date().toISOString() });
          return c.json({ receiptId: receipt.receiptId, runId: launched.runId }, 202);
        } catch (error) {
          store.appendReceipt({ ...receipt, status: 'launch-error', error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() });
          return c.json({ error: 'Tracker launch failed; see the execution log' }, 409);
        } finally { mutation.release(); lease.release(); }
      }
      if (!isGithubAutomation(definition)) return c.json({ error: 'automation kind cannot be retried' }, 409);
      if (!receipt.candidate) return c.json({ error: 'receipt predates retry context and cannot be retried safely' }, 409);
      const lease = store.acquireLease();
      if (!lease) return c.json({ error: 'automation polling lease is held by another process' }, 409);
      const mutation = store.acquireMutationLease();
      if (!mutation) { lease.release(); return c.json({ error: 'automation mutation conflict' }, 409); }
      try { reconcileAutomationReceipts(store, project.store, { strict: true }); }
      catch {
        mutation.release();
        lease.release();
        return c.json({ error: 'Cannot safely reconcile automation receipts; try again.' }, 409);
      }
      const reserved = store.reserveRetry(receipt.receiptId);
      if (!reserved) { mutation.release(); lease.release(); return c.json({ error: 'receipt is not retryable' }, 409); }
      try {
        const launched = await launchAutomationRun({ root: project.root, manager: project.manager, store: project.store, definition, candidate: receipt.candidate, receiptId: receipt.receiptId, dispatchEnabled: capabilities().dispatch });
        store.appendReceipt({ ...reserved, status: 'launched', runId: launched.runId, updatedAt: new Date().toISOString() });
        emitAutomationChange(project, definition.id, definition.revision);
        return c.json({ receiptId: receipt.receiptId, runId: launched.runId }, 202);
      } catch (error) {
        // A `pr-head` retry whose PR has since closed (or turned out a fork) is handled, not
        // broken: a terminal `skipped` receipt, so Retry stops being offered for it.
        const skipped = error instanceof AutomationLaunchOutcome && error.result === 'skipped';
        store.appendReceipt({
          ...reserved,
          status: skipped ? 'skipped' : 'launch-error',
          ...(skipped ? {} : { error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000) }),
          updatedAt: new Date().toISOString(),
        });
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
      } finally {
        mutation.release();
        lease.release();
      }
    });
}
