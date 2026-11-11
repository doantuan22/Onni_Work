import { join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  threadsPageSchema,
  threadsQuerySchema,
  type Capabilities,
  type ThreadsPage,
  type ThreadSummary,
} from '@onni/contract';
import { queryZodValidator } from '../validators.ts';
import {
  byLastActivityDesc,
  compareIsoDesc,
  lastActivityAt,
  readRunIndexFromDisk,
} from '../../runs/run-index.ts';
import {
  readRunPreviewFromDisk,
  type RunRecord,
} from '../../runs/store.ts';
import type { ProjectListEntry, ProjectListSelector } from '../../workspace/projects.ts';
import type { WorkspaceProject } from '../../workspace/config.ts';
import type { ProjectContext, ProjectContexts } from '../project-context.ts';

export type WorkspaceThreadsRouteDeps = {
  capabilities: () => Capabilities;
  resolveBootProject: (projects?: readonly WorkspaceProject[]) => Promise<string>;
  listProjects: (selector?: ProjectListSelector) => Promise<ProjectListEntry[]>;
  bootContext: ProjectContext;
  contexts: ProjectContexts;
};

const RUNS_INDEX_PER_PROJECT = 200;

const cursorPayloadSchema = z.object({
  v: z.literal(1),
  updatedAt: z.string(),
  runId: z.string(),
});
type CursorPayload = z.infer<typeof cursorPayloadSchema>;

export function encodeThreadCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeThreadCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = cursorPayloadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function compareThreads(
  a: { updatedAt: string; runId: string },
  b: { updatedAt: string; runId: string },
): number {
  const timeDiff = compareIsoDesc(a.updatedAt, b.updatedAt);
  if (timeDiff !== 0) return timeDiff;
  return a.runId.localeCompare(b.runId);
}

export function matchesStatusFilter(run: RunRecord, statusQuery?: string): boolean {
  if (!statusQuery) {
    return !run.archived;
  }
  const tokens = statusQuery.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) {
    return !run.archived;
  }
  const asksForArchived = tokens.includes('archived');
  if (run.archived) {
    return asksForArchived;
  }
  const statusTokens = tokens.filter((t) => t !== 'archived');
  if (statusTokens.length === 0) {
    return false;
  }
  return statusTokens.includes(run.status.toLowerCase());
}

export function computeThreadUnread(
  run: Pick<
    RunRecord,
    'status' | 'archived' | 'lastSeq' | 'lastViewedSeq' | 'finishedAt' | 'seenAt' | 'autoResumeAt' | 'awaitingAnswerSince'
  >,
): boolean {
  if (run.archived) return false;
  if (run.status === 'cancelled') return false;

  if (typeof run.lastSeq === 'number') {
    if (typeof run.lastViewedSeq === 'number') {
      return run.lastViewedSeq < run.lastSeq;
    }
    if (
      run.status === 'queued' ||
      run.status === 'running' ||
      run.status === 'waiting' ||
      run.status === 'review'
    ) {
      return run.lastSeq > 0;
    }
  }

  if (run.status === 'done' || run.status === 'failed') {
    if (run.status === 'failed' && (run.autoResumeAt !== undefined || run.awaitingAnswerSince !== undefined)) {
      return false;
    }
    if (run.finishedAt === undefined) return false;
    return run.seenAt === undefined || run.seenAt < run.finishedAt;
  }

  return false;
}

interface ThreadCandidate {
  run: RunRecord;
  project: ProjectListEntry;
  owned?: ProjectContext;
  updatedAt: string;
  awaitingAsk: boolean;
  workerCount: number;
}

export function createWorkspaceThreadsRoutes(deps: WorkspaceThreadsRouteDeps) {
  const { capabilities, resolveBootProject, listProjects, bootContext, contexts } = deps;

  return new Hono().get(
    '/workspace/threads',
    queryZodValidator(threadsQuerySchema),
    async (c) => {
      const query = c.req.valid('query');

      let decodedCursor: CursorPayload | null = null;
      if (query.cursor !== undefined) {
        decodedCursor = decodeThreadCursor(query.cursor);
        if (!decodedCursor) {
          return c.json({ error: 'invalid cursor' }, 400);
        }
      }

      let projects: ProjectListEntry[] = [];
      try {
        const selector = capabilities().singleProject
          ? { projectId: await resolveBootProject() }
          : undefined;
        projects = await listProjects(selector);
      } catch {
        // unreadable workspace
      }

      if (query.projectId !== undefined) {
        projects = projects.filter((p) => p.id === query.projectId);
      }

      const bootId = await resolveBootProject(projects);
      const candidates: ThreadCandidate[] = [];
      const truncatedProjects: string[] = [];

      for (const project of projects) {
        if (project.status === 'missing') continue;
        const owned = project.id === bootId ? bootContext : contexts.peek(project.id);
        const allRuns = (
          owned ? owned.store.listRuns() : readRunIndexFromDisk(join(project.root, '.ai/onni'))
        ).sort(byLastActivityDesc);

        if (allRuns.length > RUNS_INDEX_PER_PROJECT) {
          truncatedProjects.push(project.id);
        }

        const projectRuns = allRuns.slice(0, RUNS_INDEX_PER_PROJECT);

        const workerCountMap = new Map<string, number>();
        for (const run of projectRuns) {
          const parentId = run.dispatch?.parentRunId;
          if (parentId) {
            workerCountMap.set(parentId, (workerCountMap.get(parentId) ?? 0) + 1);
          }
        }

        for (const run of projectRuns) {
          if (!matchesStatusFilter(run, query.status)) continue;

          const updatedAt = lastActivityAt(run);
          const awaitingAsk = Boolean(
            run.awaitingAnswerSince ||
            run.dispatch?.pendingAsk ||
            run.dispatch?.softAsk,
          );
          const workerCount = workerCountMap.get(run.id) ?? 0;

          candidates.push({
            run,
            project,
            owned,
            updatedAt,
            awaitingAsk,
            workerCount,
          });
        }
      }

      candidates.sort((a, b) => compareThreads(
        { updatedAt: a.updatedAt, runId: a.run.id },
        { updatedAt: b.updatedAt, runId: b.run.id },
      ));

      let eligible = candidates;
      if (decodedCursor) {
        const cursorRef = { updatedAt: decodedCursor.updatedAt, runId: decodedCursor.runId };
        const startIndex = candidates.findIndex((item) =>
          compareThreads({ updatedAt: item.updatedAt, runId: item.run.id }, cursorRef) > 0,
        );
        eligible = startIndex === -1 ? [] : candidates.slice(startIndex);
      }

      const limit = query.limit;
      const paged = eligible.slice(0, limit);
      const hasMore = eligible.length > limit;

      const items: ThreadSummary[] = paged.map((item) => {
        const preview = item.owned
          ? item.owned.store.getRunPreview(item.run.id)
          : readRunPreviewFromDisk(join(item.project.root, '.ai/onni/runs', `${item.run.id}.ndjson`));

        const unread = computeThreadUnread(item.run);
        const parentRunId = item.run.dispatch?.parentRunId;

        return {
          runId: item.run.id,
          projectId: item.project.id,
          title: item.run.title,
          status: item.run.status,
          updatedAt: item.updatedAt,
          ...(preview !== undefined ? { preview } : {}),
          awaitingAsk: item.awaitingAsk,
          workerCount: item.workerCount,
          ...(parentRunId !== undefined ? { parentRunId } : {}),
          unread,
        };
      });

      let nextCursor: string | undefined;
      if (hasMore && paged.length > 0) {
        const last = paged[paged.length - 1]!;
        nextCursor = encodeThreadCursor({
          v: 1,
          updatedAt: last.updatedAt,
          runId: last.run.id,
        });
      }

      const body: ThreadsPage = {
        items,
        ...(nextCursor !== undefined ? { nextCursor } : {}),
        ...(truncatedProjects.length > 0 ? { truncatedProjects } : {}),
      };

      return c.json(body);
    },
  );
}
