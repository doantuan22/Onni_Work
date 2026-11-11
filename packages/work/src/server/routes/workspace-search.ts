import { join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  transcriptSearchQuerySchema as maybeContractQuerySchema,
  type TranscriptSearchPage,
} from '@onni/contract';
import { queryZodValidator } from '../validators.ts';
import {
  searchTranscripts,
  SearchCursorError,
  type CandidateRun,
  type TranscriptSearchOptions,
} from '../../runs/transcript-search.ts';
import { readRunIndexFromDisk, compareIsoDesc, lastActivityAt } from '../../runs/run-index.ts';
import { isSafeRunId, resolveRunEventsPath } from '../../runs/store.ts';
import type { ProjectContext, ProjectContexts } from '../project-context.ts';
import type { ProjectListEntry, ProjectListSelector } from '../../workspace/projects.ts';
import type { WorkspaceProject } from '../../workspace/config.ts';

const fallbackQuerySchema = z.object({
  q: z.string().min(1).max(200),
  projectId: z.string().optional(),
  runId: z.string().optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const transcriptSearchQuerySchema = maybeContractQuerySchema ?? fallbackQuerySchema;

export interface WorkspaceSearchDeps {
  listProjects: (selector?: ProjectListSelector) => Promise<ProjectListEntry[]>;
  resolveBootProject: (projects?: readonly WorkspaceProject[]) => Promise<string>;
  bootContext: ProjectContext;
  bootRoot: string;
  contexts: ProjectContexts;
  searchOptions?: TranscriptSearchOptions;
}

export function createWorkspaceSearchRoutes(deps: WorkspaceSearchDeps) {
  const { listProjects, resolveBootProject, bootContext, bootRoot, contexts, searchOptions } = deps;

  return new Hono().get(
    '/workspace/search',
    queryZodValidator(transcriptSearchQuerySchema),
    async (c) => {
      const query = c.req.valid('query');
      if (query.runId !== undefined && !isSafeRunId(query.runId)) {
        return c.json({ items: [] } satisfies TranscriptSearchPage);
      }

      let projects: ProjectListEntry[] = [];
      try {
        projects = await listProjects();
      } catch {
        // unreadable workspace — empty projects
      }

      const bootId = await resolveBootProject(projects).catch(() => 'default');
      if (!projects.some((p) => p.id === bootId)) {
        projects.unshift({ id: bootId, root: bootRoot, status: 'ok' } as ProjectListEntry);
      }

      const targetProjects = query.projectId
        ? projects.filter((p) => p.id === query.projectId)
        : projects;

      const candidateRuns: CandidateRun[] = [];
      for (const project of targetProjects) {
        if (project.status === 'missing') continue;
        const owned =
          project.id === bootId && bootContext
            ? bootContext
            : contexts.peek(project.id);

        const dataDir = owned ? owned.dataDir : join(project.root, '.ai/onni');
        const runs = owned ? owned.store.listRuns() : readRunIndexFromDisk(dataDir);

        for (const run of runs) {
          if (query.runId && run.id !== query.runId) continue;
          if (!isSafeRunId(run.id)) continue;
          const transcriptPath = resolveRunEventsPath(dataDir, run.id);
          if (!transcriptPath) continue;
          candidateRuns.push({
            projectId: project.id,
            runId: run.id,
            filePath: transcriptPath,
            runsDir: join(dataDir, 'runs'),
            lastActivityAt: lastActivityAt(run),
          });
        }
      }

      candidateRuns.sort((a, b) => compareIsoDesc(a.lastActivityAt ?? '', b.lastActivityAt ?? ''));

      try {
        const page: TranscriptSearchPage = await searchTranscripts(
          query,
          candidateRuns,
          searchOptions,
        );
        return c.json(page);
      } catch (error) {
        if (error instanceof SearchCursorError) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
    },
  );
}
