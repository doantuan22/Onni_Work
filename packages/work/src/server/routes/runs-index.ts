import { join } from 'node:path';
import { Hono } from 'hono';
import { type Capabilities, type RunIndexEntry, type RunsIndexResponse } from '@onni/contract';
import { byLastActivityDesc, compareIsoDesc, lastActivityAt, readRunIndexFromDisk } from '../../runs/run-index.ts';
import type { currentUsage } from '../../core/process-usage.ts';
import type { RunRecord } from '../../runs/store.ts';
import { type ProjectListEntry, type ProjectListSelector } from '../../workspace/projects.ts';
import type { WorkspaceProject } from '../../workspace/config.ts';
import { readCachedRefStatuses, refNumberFromUrl } from '../github.ts';
import type { ProjectContext, ProjectContexts } from '../project-context.ts';

type RunsIndexRouteDeps = {
  capabilities: () => Capabilities;
  resolveBootProject: (projects?: readonly WorkspaceProject[]) => Promise<string>;
  listProjects: (selector?: ProjectListSelector) => Promise<ProjectListEntry[]>;
  bootContext: ProjectContext;
  bootRoot: string;
  contexts: ProjectContexts;
  currentUsage: typeof currentUsage;
};

export function runsIndexRoutes(deps: RunsIndexRouteDeps) {
  const { capabilities, resolveBootProject, listProjects, bootContext, bootRoot, contexts, currentUsage } = deps;
  /**
   * How many runs each project may contribute, newest first. The index is a FINDER, not a
   * listing: past the newest couple of hundred per project you are looking for something the
   * project's own Tasks table answers better, and every extra row is a DOM node the palette's
   * filter walks on each keystroke. `truncated` names the projects this bit, so a consumer never
   * has to pretend the list is complete.
   */
  const RUNS_INDEX_PER_PROJECT = 200;

  /** `RunRecord` → the wire row. Optional keys are spread CONDITIONALLY: writing
   *  `titleSummary: run.titleSummary` types a key as always-present that `JSON.stringify` then
   *  drops when it is undefined, which is exactly the drift the parity guard fails on. */
  /**
   * Every number a run MENTIONS — a superset of what its chip will show.
   *
   * Deliberately not `taskReference()`'s rule: which of a run's references is displayed is the
   * cockpit's decision (#407, #526), and re-deriving it here would be a second rule that drifts
   * from the first. This feeds a CACHE READ, which costs nothing per number, so asking about one
   * the client will not paint is free and asking about one it will is the whole point.
   */
  const mentionedReferenceNumbers = (run: RunRecord): number[] => {
    const numbers: number[] = [];
    for (const url of [run.pullRequestUrl, run.referencedPullRequestUrl, run.referencedIssueUrl]) {
      const number = url ? refNumberFromUrl(url) : null;
      if (number !== null) numbers.push(number);
    }
    for (const number of [run.prNumber, run.issueNumber, run.markerRefs?.pr, run.markerRefs?.issue]) {
      if (typeof number === 'number' && Number.isInteger(number) && number > 0) numbers.push(number);
    }
    for (const ref of run.prRefs ?? []) numbers.push(ref.number);
    return numbers;
  };

  const runIndexEntry = (projectId: string, run: RunRecord): RunIndexEntry => {
    const usage = currentUsage(run.id);
    const automationId = run.deferredBinding ? undefined :
      run.automation?.automationId ?? run.automationTrigger?.automationId ?? run.automationTracker?.automationId;
    return {
    projectId,
    id: run.id,
    title: run.title,
    ...(run.worktreeLifecycle !== undefined ? { worktreeLifecycle: run.worktreeLifecycle } : {}),
    ...(run.titleSummary !== undefined ? { titleSummary: run.titleSummary } : {}),
    ...(run.titleOrigin !== undefined ? { titleOrigin: run.titleOrigin } : {}),
    status: run.status,
    ...(run.activity !== undefined ? { activity: run.activity } : {}),
    createdAt: run.createdAt,
    ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
    ...(run.seenAt !== undefined ? { seenAt: run.seenAt } : {}),
    archived: run.archived,
    ...(run.autoResumeAt !== undefined ? { autoResumeAt: run.autoResumeAt } : {}),
    ...(run.awaitingAnswerSince !== undefined ? { awaitingAnswerSince: run.awaitingAnswerSince } : {}),
    workflow: run.workflow,
    ...(run.branch !== undefined ? { branch: run.branch } : {}),
    ...(run.dispatch !== undefined
      ? {
          dispatch: {
            rootRunId: run.dispatch.rootRunId,
            ...(run.dispatch.parentRunId !== undefined ? { parentRunId: run.dispatch.parentRunId } : {}),
            ...(run.dispatch.kind !== undefined ? { kind: run.dispatch.kind } : {}),
          },
        }
      : {}),
    ...(automationId !== undefined ? { automationId } : {}),
    ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
    lastActivityAt: lastActivityAt(run),
    // The tracker-reference inputs, verbatim — the cockpit's `taskReference()` owns the rule
    // that picks between them (see the schema's note).
    ...(run.pullRequestUrl !== undefined ? { pullRequestUrl: run.pullRequestUrl } : {}),
    ...(run.referencedPullRequestUrl !== undefined
      ? { referencedPullRequestUrl: run.referencedPullRequestUrl }
      : {}),
    // #854: the PR half of the same evidence rule — a `prNumber` the auto-namer scraped off a
    // task driving ANOTHER repository is refused by the client on the strength of these.
    ...(run.referencedPrCandidates !== undefined
      ? { referencedPrCandidates: run.referencedPrCandidates }
      : {}),
    ...(run.prNumber !== undefined ? { prNumber: run.prNumber } : {}),
    ...(run.prRefs !== undefined ? { prRefs: run.prRefs } : {}),
    ...(run.issueNumber !== undefined ? { issueNumber: run.issueNumber } : {}),
    ...(run.referencedIssueUrl !== undefined ? { referencedIssueUrl: run.referencedIssueUrl } : {}),
    // #819: evidence, not a link — the candidates are what let the client prove a bare
    // `issueNumber` is another repository's and paint no chip rather than a 404 one.
    ...(run.referencedIssueCandidates !== undefined
      ? { referencedIssueCandidates: run.referencedIssueCandidates }
      : {}),
    ...(run.markerRefs !== undefined ? { markerRefs: run.markerRefs } : {}),
    ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
    ...(run.peakRssBytes !== undefined ? { peakRssBytes: run.peakRssBytes } : {}),
    ...(run.peakProcCount !== undefined ? { peakProcCount: run.peakProcCount } : {}),
    // The live sample, on the same terms as `GET /runs`: process-wide sampler, so a
    // workspace-level answer can carry it for every project's runs at once.
    ...(usage ? { usage } : {}),
    };
  };

  /**
   * `GET /workspace/runs-index` — every registered project's recent tasks in one slim answer, so
   * ⌘K can find a task without knowing which project it lives in.
   *
   * Workspace-level and single-mount for the obvious reason: a project-scoped spelling of "all
   * projects" is a contradiction. The per-project source is chosen the same way the automation
   * coordinator's boot fan-out chooses it (`bootContext` for the boot project, `contexts.peek`
   * for anything this process already owns, disk otherwise) — and never `contexts.context()`,
   * which would build a context, prune worktrees and `recover()` running agents. Typing in a
   * search box must not resume work; see `runs/run-index.ts`.
   */

  return new Hono()
    .get('/workspace/runs-index', async (c) => {
      let projects: ProjectListEntry[] = [];
      try {
        const selector = capabilities().singleProject
          ? { projectId: await resolveBootProject() }
          : undefined;
        projects = await listProjects(selector);
      } catch {
        // unreadable workspace — an empty index, never a 500. The palette degrades to the
        // active project's own run list, which it holds either way.
      }
      const bootId = await resolveBootProject(projects);
      const runs: RunIndexEntry[] = [];
      const truncated: string[] = [];
      // Statuses the server already holds, shipped WITH the rows that carry the references. The
      // cockpit would otherwise ask for them a beat after the table paints — one round trip per
      // project, and a visible flash of un-coloured chips before it lands. Cache-only, so this
      // never touches `gh` and never slows the index down; anything cold stays absent and the
      // lazy `/github/ref-status` route fills it in.
      const referenceStatuses: RunsIndexResponse['referenceStatuses'] = {};
      for (const project of projects) {
        // No folder, no runs to read. `not-git` still has an `.ai/onni` worth indexing.
        if (project.status === 'missing') continue;
        const owned = project.id === bootId ? bootContext : contexts.peek(project.id);
        // Sorted by last activity, not creation: the cap must keep a weeks-old task finished
        // today, and the table shows this order as-is. Neither source's own order is trusted.
        //
        // Archived runs are INCLUDED. The active project's rows reach the palette through
        // `GET /runs`, which has always carried them, and excluding them here would mean a task
        // is findable while you stand in its project and vanishes the moment you leave — the
        // exact asymmetry a cross-project finder exists to remove.
        const recent = (
          owned ? owned.store.listRuns() : readRunIndexFromDisk(join(project.root, '.ai/onni'))
        ).sort(byLastActivityDesc);
        if (recent.length > RUNS_INDEX_PER_PROJECT) truncated.push(project.id);
        const mentioned: number[] = [];
        for (const run of recent.slice(0, RUNS_INDEX_PER_PROJECT)) {
          runs.push(runIndexEntry(project.id, run));
          mentioned.push(...mentionedReferenceNumbers(run));
        }
        if (mentioned.length > 0) {
          const cached = readCachedRefStatuses(project.root, mentioned);
          // Only when something was actually warm. A project key holding two empty maps is noise
          // that every consumer would have to look past, and it would blur the one rule this
          // payload has: absent means nothing is known.
          if (Object.keys(cached.prs).length > 0 || Object.keys(cached.issues).length > 0) {
            referenceStatuses[project.id] = cached;
          }
        }
      }
      // The slim rows carry no steps — sort on the value computed from them, never re-derive it.
      runs.sort((a, b) => compareIsoDesc(a.lastActivityAt, b.lastActivityAt));
      const body: RunsIndexResponse = {
        runs,
        perProjectLimit: RUNS_INDEX_PER_PROJECT,
        truncated,
        referenceStatuses,
      };
      return c.json(body);
    });
}
