import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import {
  workspacePanesInputSchema,
  workspacePanesSchema,
  type WorkspacePanes,
  type WorkspacePanesInput,
  type WorkspacePaneThread,
  type WorkspaceSplit,
} from '@onni/contract';
import { atomicWriteJsonSync } from '../../workspace/config.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

export const EMPTY_WORKSPACE_PANES: WorkspacePanes = {
  threads: [],
  split: 'none',
};

/**
 * Path to this project's persisted workspace multi-thread panes state.
 * Listed in DATA_GITIGNORE_ENTRIES so it never lands in repository git history.
 */
export function workspacePanesPath(dataDir: string): string {
  return join(dataDir, 'workspace-panes.json');
}

/**
 * Normalizes panes input:
 * - Drops duplicate paneIds (preserves first occurrence).
 * - Ensures active paneId exists in threads, otherwise removes active.
 * - Ensures split pane IDs exist in threads and are distinct, otherwise resets split to 'none'.
 */
export function normalizeWorkspacePanes(input: WorkspacePanesInput): WorkspacePanes {
  const seenPaneIds = new Set<string>();
  const threads: WorkspacePaneThread[] = [];

  for (const thread of input.threads) {
    if (seenPaneIds.has(thread.paneId)) {
      continue;
    }
    seenPaneIds.add(thread.paneId);
    threads.push(thread);
  }

  const active =
    input.active !== undefined && seenPaneIds.has(input.active)
      ? input.active
      : undefined;

  let split: WorkspaceSplit = 'none';
  if (input.split !== 'none') {
    const { a, b } = input.split;
    if (a !== b && seenPaneIds.has(a) && seenPaneIds.has(b)) {
      split = { a, b };
    }
  }

  return {
    threads,
    ...(active !== undefined ? { active } : {}),
    split,
  };
}

/**
 * Read this project's workspace pane state. Missing or corrupt files degrade
 * cleanly to the empty default without throwing or 404/500 errors.
 */
export function readWorkspacePanes(dataDir: string): WorkspacePanes {
  const path = workspacePanesPath(dataDir);
  try {
    if (!existsSync(path)) {
      return { ...EMPTY_WORKSPACE_PANES };
    }
    const raw = readFileSync(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const result = workspacePanesSchema.safeParse(parsed);
    if (!result.success) {
      return { ...EMPTY_WORKSPACE_PANES };
    }
    return normalizeWorkspacePanes(result.data);
  } catch {
    return { ...EMPTY_WORKSPACE_PANES };
  }
}

/**
 * Atomically persist workspace panes state with mode 0600.
 * Normalizes before saving. Returns the saved state or null on failure.
 */
export function writeWorkspacePanes(dataDir: string, value: WorkspacePanesInput): WorkspacePanes | null {
  const normalized = normalizeWorkspacePanes(value);
  const path = workspacePanesPath(dataDir);
  try {
    atomicWriteJsonSync(path, normalized);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Workspace pane state route family (design.md section 7 item 4).
 * Mounted under both `/api/v1/workspace/panes` and `/api/v1/p/:projectId/workspace/panes`.
 */
export function createWorkspacePanesRoutes() {
  return new Hono<ProjectApiEnv>()
    .get('/workspace/panes', (c) => {
      const { dataDir } = c.get('project');
      const panes = readWorkspacePanes(dataDir);
      return c.json(workspacePanesSchema.parse(panes));
    })
    .put(
      '/workspace/panes',
      jsonZodValidator(workspacePanesInputSchema),
      (c) => {
        const { dataDir } = c.get('project');
        const input = c.req.valid('json');
        const saved = writeWorkspacePanes(dataDir, input);
        if (!saved) {
          return c.json({ error: 'could not save workspace panes on this host' }, 409);
        }
        return c.json(workspacePanesSchema.parse(saved));
      },
    );
}
