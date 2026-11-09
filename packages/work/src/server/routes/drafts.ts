import { Hono } from 'hono';
import {
  DRAFT_MAX_IMAGES,
  draftImageInputSchema,
  draftImageParamSchema,
  draftSurfaceParamSchema,
  runIdParamSchema,
  setRunDraftInputSchema,
  type DeleteDraftResponse,
} from '@onni/contract';
import {
  countRunDraftImages,
  deleteRunDraftImage,
  deleteRunDraftSurface,
  readRunDraftImage,
  readRunDrafts,
  writeRunDraftImage,
  writeRunDraftSurface,
} from '../../runs/drafts.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator, paramZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

/** Composer drafts and attachments stay out of bounded ui-state (#939, spec `.ai/specs/2026-08-30-thread-composer-draft-persistence.md`). */
export function createDraftsRoutes() {
  return new Hono<ProjectApiEnv>()
    .get('/runs/:id/drafts', paramZodValidator(runIdParamSchema), (c) => {
      const { dataDir, store } = c.get('project');
      const run = store.getRun(c.req.param('id'));
      if (!run) return c.json({ error: 'not found' }, 404);
      return c.json(readRunDrafts(dataDir, run.id));
    })

    .put(
      '/runs/:id/drafts/:surface',
      paramZodValidator(draftSurfaceParamSchema),
      jsonZodValidator(setRunDraftInputSchema),
      (c) => {
        const { dataDir, store } = c.get('project');
        const { id, surface } = c.req.valid('param');
        const run = store.getRun(id);
        if (!run) return c.json({ error: 'not found' }, 404);
        // An empty write deletes, so non-cockpit clients obey the same cleared-when-emptied policy.
        const result = writeRunDraftSurface(dataDir, run.id, surface, c.req.valid('json'));
        if (!result.ok) return c.json({ error: result.error }, 400);
        return c.json(result.entry);
      },
    )

    .delete('/runs/:id/drafts/:surface', paramZodValidator(draftSurfaceParamSchema), (c) => {
      const { dataDir, store } = c.get('project');
      const { id, surface } = c.req.valid('param');
      const run = store.getRun(id);
      if (!run) return c.json({ error: 'not found' }, 404);
      deleteRunDraftSurface(dataDir, run.id, surface);
      const body: DeleteDraftResponse = { deleted: true };
      return c.json(body);
    })

    // Images are uploaded when attached, so bytes cross the wire once and draft records only
    // reference them. This path uses the global body limit, not the smaller ui-state limit.
    .post(
      '/runs/:id/drafts/:surface/images',
      paramZodValidator(draftSurfaceParamSchema),
      jsonZodValidator(draftImageInputSchema),
      (c) => {
        const { dataDir, store } = c.get('project');
        const { id, surface } = c.req.valid('param');
        const run = store.getRun(id);
        if (!run) return c.json({ error: 'not found' }, 404);
        const held = countRunDraftImages(dataDir, run.id, surface);
        if (held >= DRAFT_MAX_IMAGES) {
          return c.json({ error: `at most ${DRAFT_MAX_IMAGES} images per draft` }, 400);
        }
        const result = writeRunDraftImage(dataDir, run.id, c.req.valid('json'));
        if (!result.ok) return c.json({ error: result.error }, 400);
        return c.json(result.image);
      },
    )

    // A blob is minted before a draft record names it; run id scopes these lookups so pasting an
    // image works before the composer writes its first draft record.
    .get(
      '/runs/:id/drafts/:surface/images/:imageId',
      paramZodValidator(draftImageParamSchema),
      (c) => {
        const { dataDir, store } = c.get('project');
        const { id, imageId } = c.req.valid('param');
        const run = store.getRun(id);
        if (!run) return c.json({ error: 'not found' }, 404);
        const image = readRunDraftImage(dataDir, run.id, imageId);
        if (!image) return c.json({ error: 'not found' }, 404);
        return c.json(image);
      },
    )

    .delete(
      '/runs/:id/drafts/:surface/images/:imageId',
      paramZodValidator(draftImageParamSchema),
      (c) => {
        const { dataDir, store } = c.get('project');
        const { id, imageId } = c.req.valid('param');
        const run = store.getRun(id);
        if (!run) return c.json({ error: 'not found' }, 404);
        deleteRunDraftImage(dataDir, run.id, imageId);
        const body: DeleteDraftResponse = { deleted: true };
        return c.json(body);
      },
    );
}
