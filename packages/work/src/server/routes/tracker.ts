import { Hono } from 'hono';
import {
  trackerWatchInputSchema, trackerWatchParamsSchema, trackerWatchQuerySchema,
  trackerCandidatesQuerySchema, trackerListQuerySchema, trackerSearchQuerySchema, trackerItemQuerySchema, trackerReadScope,
  trackerCredentialsSchema, trackerItemParamsSchema, trackerAssociationInputSchema,
  trackerAutomationOptionsSchema, trackerAutomationOptionsQuerySchema,
} from '@onni/contract';
import { readTrackerAssociation, writeTrackerAssociation, clearTrackerAssociation } from '../../tracker-association.ts';
import type { ProjectContext } from '../project-context.ts';
import type { createTrackerService } from '../tracker/index.ts';
import type { TrackerWatches } from '../tracker/watch.ts';
import { jsonZodValidator, paramZodValidator, queryZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

type TrackerRouteDeps = {
  trackers: ReturnType<typeof createTrackerService>;
  trackerWatches: Pick<TrackerWatches, 'open' | 'read' | 'wait' | 'refresh'>;
  mutateTracker: <T>(key: string, action: () => Promise<T>) => Promise<T>;
  trackerChanged: (project: ProjectContext) => Promise<void>;
};

export function createTrackerRoutes(deps: TrackerRouteDeps) {
  const { trackers, trackerWatches, mutateTracker, trackerChanged } = deps;
  return new Hono<ProjectApiEnv>()
    .get('/tracker/automation-options', queryZodValidator(trackerAutomationOptionsQuerySchema), async c => {
      const project = c.get('project');
      const driver = await trackers.driver(project.root, project.dataDir);
      if ('available' in driver) return c.json(trackerAutomationOptionsSchema.parse(driver));
      if (!driver.automationOptions) return c.json(trackerAutomationOptionsSchema.parse({ available: false, code: 'unavailable', reason: 'Automation events are not available for this tracker' }));
      try {
        const options = await driver.automationOptions(c.req.valid('query'));
        return c.json(trackerAutomationOptionsSchema.parse({ available: true, association: driver.association, ...options }));
      } catch {
        return c.json(trackerAutomationOptionsSchema.parse({ available: false, code: 'unavailable', reason: 'Could not load tracker automation options. Try again.' }));
      }
    })
    .post('/tracker/watch', jsonZodValidator(trackerWatchInputSchema), async c => {
      try { return c.json(await trackerWatches.open(c.get('project'), c.req.valid('json')), 200); }
      catch { return c.json({ error: 'Could not observe this tracker. Reload the view or close unused tracker views.' }, 409); }
    })
    .get('/tracker/watch/:watchId', paramZodValidator(trackerWatchParamsSchema), queryZodValidator(trackerWatchQuerySchema), async c => {
      const { after } = c.req.valid('query');
      const project = c.get('project');
      const { watchId } = c.req.valid('param');
      const result = after === undefined
        ? await trackerWatches.read(project, watchId)
        : await trackerWatches.wait(project, watchId, after, c.req.raw.signal);
      if (!result) return c.json({ error: 'Tracker observation expired. Reopen the view.' }, 404);
      c.header('Cache-Control', 'no-store');
      return c.json(result, 200);
    })
    .post('/tracker/watch/:watchId', paramZodValidator(trackerWatchParamsSchema), async c => {
      const result = await trackerWatches.refresh(c.get('project'), c.req.valid('param').watchId);
      if (!result) return c.json({ error: 'Tracker observation expired. Reopen the view.' }, 404);
      return c.json(result, 200);
    })
    .get('/tracker/connection', async c => c.json(await trackers.connection(c.get('project').root)))
    .put('/tracker/connection', jsonZodValidator(trackerCredentialsSchema, { message: 'Invalid tracker credentials. Check the required fields.' }), async c => {
      const project = c.get('project');
      return mutateTracker(project.dataDir, async () => {
        const result = await trackers.saveConnection(project.root, c.req.valid('json'));
        if (!result) return c.json({ error: 'Could not save project credentials. Check local storage permissions. Demo mode cannot save credentials.' }, 409);
        await trackerChanged(project);
        return c.json(result, 200);
      });
    })
    .delete('/tracker/connection', async c => {
      const project = c.get('project');
      return mutateTracker(project.dataDir, async () => {
        if (!await trackers.removeConnection(project.root)) return c.json({ error: 'Could not remove project credentials.' }, 409);
        await trackerChanged(project);
        return c.json({ cleared: true as const }, 200);
      });
    })
    .get('/tracker/candidates', queryZodValidator(trackerCandidatesQuerySchema), async c => {
      const result = await trackers.candidates(c.get('project').root, c.req.valid('query'));
      if (!result.available && result.code === 'invalid_cursor') return c.json({ error: result.reason }, 400);
      return c.json(result, 200);
    })
    .get('/tracker/association', async (c) =>
      c.json({ association: await readTrackerAssociation(c.get('project').dataDir) }))
    .put('/tracker/association', jsonZodValidator(trackerAssociationInputSchema), async (c) => {
      const project = c.get('project');
      return mutateTracker(project.dataDir, async () => {
        const result = await trackers.resolve(project.root, c.req.valid('json'));
        if (!result.available) {
          if (result.code === 'not_found') return c.json({ error: result.reason }, 404);
          return c.json({ error: result.reason }, 409);
        }
        if (!await writeTrackerAssociation(project.dataDir, result.association)) {
          return c.json({ error: 'Could not save the tracker connection. Previous connection was preserved.' }, 409);
        }
        await trackerChanged(project);
        return c.json({ association: result.association }, 200);
      });
    })
    .delete('/tracker/association', async (c) => {
      const project = c.get('project');
      return mutateTracker(project.dataDir, async () => {
        if (!await clearTrackerAssociation(project.dataDir)) {
          return c.json({ error: 'Could not disconnect the tracker. Try again.' }, 409);
        }
        await trackerChanged(project);
        return c.json({ cleared: true as const }, 200);
      });
    })
    .get('/tracker', queryZodValidator(trackerListQuerySchema), async (c) => {
      const driver = await trackers.driver(c.get('project').root, c.get('project').dataDir);
      if ('available' in driver) return c.json(driver, 200);
      const { expectedScope } = c.req.valid('query');
      if (expectedScope !== undefined && expectedScope !== trackerReadScope(driver.association)) {
        return c.json({ available: false as const, code: 'source_changed' as const, reason: 'This tracker connection or scope changed. Reload the tracker view.' }, 200);
      }
      const result = await driver.listIssues(c.req.valid('query'));
      if (!result.available && result.code === 'invalid_cursor') return c.json({ error: result.reason }, 400);
      return c.json(result, 200);
    })
    .get('/tracker/search', queryZodValidator(trackerSearchQuerySchema), async (c) => {
      const driver = await trackers.driver(c.get('project').root, c.get('project').dataDir);
      if ('available' in driver) return c.json(driver, 200);
      const { expectedScope } = c.req.valid('query');
      if (expectedScope !== undefined && expectedScope !== trackerReadScope(driver.association)) {
        return c.json({ available: false as const, code: 'source_changed' as const, reason: 'This tracker connection or scope changed. Reload the tracker view.' }, 200);
      }
      const result = await driver.searchItems(c.req.valid('query'));
      if (!result.available && result.code === 'invalid_cursor') return c.json({ error: result.reason }, 400);
      return c.json(result, 200);
    })
    .get('/tracker/:id', paramZodValidator(trackerItemParamsSchema), queryZodValidator(trackerItemQuerySchema), async (c) => {
      const driver = await trackers.driver(c.get('project').root, c.get('project').dataDir);
      if ('available' in driver) return c.json(driver, 200);
      const { expectedScope } = c.req.valid('query');
      if (expectedScope !== undefined && expectedScope !== trackerReadScope(driver.association)) {
        return c.json({ available: false as const, code: 'source_changed' as const, reason: 'This tracker connection or scope changed. Reload the tracker view.' }, 200);
      }
      const result = await driver.getItem(c.req.valid('param').id);
      if (!result.available && result.code === 'not_found') return c.json({ error: result.reason }, 404);
      return c.json(result, 200);
    });
}
