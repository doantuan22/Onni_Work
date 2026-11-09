import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  attachmentInputSchema,
  deleteUploadResponseSchema,
  setWorkspaceConfigInputSchema,
  setWorkspaceUiStateInputSchema,
  stagedUploadSchema,
  uploadIdParamSchema,
  workspaceBrandingLogoResponseSchema,
  type WorkspaceConfigResponse,
} from '@onni/contract';
import { agentUsageOverview } from '../../workspace/usage-overview.ts';
import { expandTilde, isAbsolutePath, onniHomeDir } from '../../paths.ts';
import { effectiveComposerDefault, loadWorkspaceConfig, mergeWriteWorkspaceConfig, type WorkspaceConfig } from '../../workspace/config.ts';
import { mergeWriteWorkspaceUiState, readWorkspaceUiState } from '../../workspace/ui-state.ts';
import { deleteUpload, writeUpload } from '../../uploads.ts';
import { renameWithRetry } from '../../fs-rename.ts';
import { isSafeRef, safeRemoteFor } from '../../skills-remote.ts';
import { PROVIDER_IDS } from '../../core/provider-auth.ts';
import { jsonZodValidator, multipartZodValidator, paramZodValidator } from '../validators.ts';
import type { ProjectContext, ProjectContexts } from '../project-context.ts';
import type { RunManager } from '../../workflows/run.ts';
import type { HostSampler } from '../../core/host-usage.ts';
import type { WorkspaceSemaphore } from '../../workspace/semaphore.ts';

const BRANDING_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const BRANDING_LOGO_TYPES = {
  'image/png': { ext: '.png', signature: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: '.jpg', signature: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: '.webp', signature: (b: Buffer) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  'image/gif': { ext: '.gif', signature: (b: Buffer) => ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)) },
  'image/avif': { ext: '.avif', signature: (b: Buffer) => b.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(b.toString('ascii', 8, 16)) },
  'image/svg+xml': { ext: '.svg', signature: (b: Buffer) => isSafeBrandSvg(b.toString('utf8')) },
} as const;
const BRANDING_LOGO_EXTENSIONS = Object.values(BRANDING_LOGO_TYPES).map(({ ext }) => ext);
const BRANDING_LOGO_FILE = 'branding-logo';

function brandingLogoType(bytes: Buffer): [string, (typeof BRANDING_LOGO_TYPES)[keyof typeof BRANDING_LOGO_TYPES]] | null {
  for (const [mime, type] of Object.entries(BRANDING_LOGO_TYPES)) {
    if (type.signature(bytes)) return [mime, type];
  }
  return null;
}

function isSafeBrandSvg(svg: string): boolean {
  const checked = svg.replace(/xmlns=(['"])http:\/\/www\.w3\.org\/2000\/svg\1/i, '');
  if (checked.length === 0 || /<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|<image\b|<use\b|<iframe\b|<style\b|\bon\w+\s*=|(?:href|src)\s*=|url\s*\(/i.test(checked)) return false;
  return /^\s*<svg\b[\s\S]*<\/svg>\s*$/i.test(checked) && !/javascript:|data:|https?:|file:/i.test(checked);
}

/**
 * `POST /workspace/branding-logo`'s request boundary — presence, size, declared type and (since
 * those three are only what the browser CLAIMS about the file) the real content-sniffed format,
 * all as one schema so the route type records a `File` field rather than the handler trusting
 * whatever `parseBody()` handed it.
 *
 * EVERY check in the chain runs — zod does not stop at the first failure — so each one has to
 * stand on its own against input the one before it would have rejected. A request can therefore
 * collect more than one message, which is the honest trade for never letting a later check
 * dereference something an earlier one only *meant* to have filtered out.
 */
export const brandingLogoUploadSchema = z.object({
  file: z
    .instanceof(File, { message: 'Choose an image file' })
    .refine((f) => f.size >= 1 && f.size <= BRANDING_LOGO_MAX_BYTES, { message: 'Logo must be smaller than 2 MB' })
    // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so a part declaring
    // `Content-Type: constructor` (or `toString`, `valueOf`, `hasOwnProperty`, `__proto__`)
    // passed this gate, and the sniff below then read `.signature` off `Object` — undefined —
    // and threw. A throw inside an async refine is NOT caught by `safeParseAsync`, so the
    // request answered 500 instead of this message.
    .refine((f) => Object.hasOwn(BRANDING_LOGO_TYPES, f.type), { message: 'Use PNG, JPEG, WebP, GIF, AVIF, or a safe SVG image' })
    .refine(
      async (f) => {
        // Looked up defensively even though the refine above already rejected an unsupported
        // type: zod runs EVERY check in a chain, it does not stop at the first failure, so this
        // still executes for a type that is not in the table. Reading `.signature` off whatever
        // the chain handed back then threw, and a throw inside an async refine escapes
        // `safeParseAsync` — the route answered 500 instead of a validation error.
        if (!Object.hasOwn(BRANDING_LOGO_TYPES, f.type)) return false;
        const imageType = BRANDING_LOGO_TYPES[f.type as keyof typeof BRANDING_LOGO_TYPES];
        return imageType.signature(Buffer.from(await f.arrayBuffer()));
      },
      { message: 'File contents do not match a supported image format' },
    ),
});

function logoAssetUrl(): string | null {
  for (const filename of [BRANDING_LOGO_FILE, ...BRANDING_LOGO_EXTENSIONS.map((ext) => `${BRANDING_LOGO_FILE}${ext}`)]) {
    const path = join(onniHomeDir(), filename);
    if (!existsSync(path)) continue;
    try {
      const bytes = readFileSync(path);
      if (!brandingLogoType(bytes)) continue;
      const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      return `/api/v1/workspace/branding-logo?v=${digest}`;
    } catch { /* unreadable logo degrades to no logo */ }
  }
  return null;
}

type ProjectApiEnv = { Variables: { project: ProjectContext } };

type WorkspaceConfigRouteDeps = {
  manager: RunManager;
  contexts: ProjectContexts;
  hostSampler: HostSampler;
  semaphore?: WorkspaceSemaphore;
  probeWritableDir: (dir: string, create: boolean) => Promise<string | null>;
  uiStateBodyLimit: number;
};

export function workspaceConfigRoutes(deps: WorkspaceConfigRouteDeps) {
  const {
    manager,
    contexts,
    hostSampler,
    probeWritableDir,
    uiStateBodyLimit: UI_STATE_BODY_LIMIT,
  } = deps;

  // ---- workspace settings (multi-project spec, step 2.7) -------------------
  // WORKSPACE-level routes: single-mount (never mirrored under /api/p/),
  // same-origin. The config routes carry the settings UI's slice of
  // `~/.onni/config.json` — global knobs only; the registry stays on
  // /api/projects above, and schemaVersion (a migration cursor, not a
  // setting) is deliberately omitted.
  const workspaceConfigBody = (config: WorkspaceConfig): WorkspaceConfigResponse => ({
    branding: {
      name: config.branding.name ?? 'OnniCode',
      logoUrl: logoAssetUrl(),
    },
    browseRoot: config.browseRoot,
    projectsDir: config.projectsDir,
    orgSkillsRepos: config.orgSkillsRepos ?? [],
    systemPrompt: config.systemPrompt ?? null,
    limits: config.limits,
    safety: config.safety,
    managerWorker: config.managerWorker,
    taskPresets: config.taskPresets,
    agentPermissions: config.agentPermissions,
    composerDefaults: {
      autonomous: config.composerDefaults.autonomous ?? null,
      worktree: config.composerDefaults.worktree ?? null,
      inheritedAutonomous:
        process.env.ONNI_AUTONOMOUS_DEFAULT === '0'
          ? false
          : process.env.ONNI_AUTONOMOUS_DEFAULT === '1'
            ? true
            : 'source-dependent',
      inheritedWorktree: effectiveComposerDefault(
        undefined,
        process.env.ONNI_WORKTREE_DEFAULT,
        true,
      ),
    },
    resources: {
      maxParallel: config.resources.maxParallel,
      maxMonitoringSessions: config.resources.maxMonitoringSessions,
      idleTimeoutMinutes: config.resources.idleTimeoutMinutes,
      monitoringWakeIntervalMinutes: config.resources.monitoringWakeIntervalMinutes,
      autoResumeOnUsageLimit: config.resources.autoResumeOnUsageLimit,
      memoryLimitMb: config.resources.memoryLimitMb,
      worktreeRetentionDefault: config.resources.worktreeRetentionDefault,
    },
    // SPREAD, never `runner: maybeUndefined`: hono would type the key as always-present while
    // `JSON.stringify` drops it, which is the exact drift `contract-parity` catches. And absent has
    // to keep meaning "no opinion" here, or the fallback collapses into "always claude".
    agentDefaults: {
      ...(config.agentDefaults.runner !== undefined ? { runner: config.agentDefaults.runner } : {}),
      ...(config.agentDefaults.models !== undefined ? { models: config.agentDefaults.models } : {}),
    },
  });
  // ---- chained family: workspace settings + GUI prefs (workspace-level) ----
  return new Hono<ProjectApiEnv>()
    .get('/workspace/config', async (c) => c.json(workspaceConfigBody(await loadWorkspaceConfig())))

    // Emergency stop (docs/design/unattended-safety.md §6): every live run in every open project.
    .post('/workspace/stop-all', (c) => {
      const managers = new Set([deps.manager, ...contexts.ids().flatMap((id) => contexts.peek(id)?.manager ?? [])]);
      let stopped = 0;
      for (const manager of managers) stopped += manager.cancelAll();
      return c.json({ stopped });
    })

    // Live host totals for a REMOTE cockpit (spec `.ai/specs/2026-09-20-host-resource-telemetry.md`):
    // the local cockpit gets them pushed over the `host` topic, but a remote one opens no
    // WebSocket, so this is its snapshot + reconcile target. Same staleness-ruled sampler read as
    // the topic — never a second compute path — and `cpuPct` is absent until a bounded delta
    // window exists (the card renders `sampling…` and follows up once ~2.5 s later). The read
    // keeps the sampler warm, so a cockpit polling this route gets a fresh delta each time.
    // Per-agent usage limits (P8): Claude's last observed windows, Codex live, the rest `unsupported`.
    // `?refresh=1` skips the 30 s cache (the widget's refresh button); never a task launch.
    .get('/workspace/usage', async (c) => c.json(await agentUsageOverview({ force: c.req.query('refresh') === '1' })))

    .get('/workspace/host-usage', async (c) => {
      const usage = hostSampler.sampleHostUsage();
      hostSampler.keepWarm();
      return c.json(usage);
    })

    .put('/workspace/config', jsonZodValidator(() => setWorkspaceConfigInputSchema), async (c) => {
      const parsed = { data: c.req.valid('json') };
      const { browseRoot, projectsDir, orgSkillsRepos, systemPrompt, composerDefaults, resources, agentDefaults, branding } = parsed.data;
      const { limits: limitsPatch, safety: safetyPatch, managerWorker: managerWorkerPatch, agentPermissions: permissionsPatch, taskPresets: taskPresetsPatch } = parsed.data;
      if (managerWorkerPatch && managerWorkerPatch.defaultPresetId !== null && !managerWorkerPatch.presets.some((p) => p.id === managerWorkerPatch.defaultPresetId)) {
        return c.json({ error: 'the default preset must be one of the saved presets' }, 400);
      }
      if (taskPresetsPatch && new Set(taskPresetsPatch.map((preset) => preset.id)).size !== taskPresetsPatch.length) {
        return c.json({ error: 'task preset ids must be unique' }, 400);
      }
      for (const src of orgSkillsRepos ?? []) {
        if (safeRemoteFor(src.repo) === null || !isSafeRef(src.ref)) {
          return c.json({ error: `unsafe skills repo: ${src.repo}@${src.ref}` }, 400);
        }
        // Global setting, shared by processes started in different directories: a relative path
        // would resolve differently in each, while the cache directory is the same.
        if (/^\.{1,2}([\\/]|$)/.test(src.repo)) {
          return c.json({ error: `use an absolute path for a local skills repo: ${src.repo}` }, 400);
        }
      }
      for (const [configuredRoot, create] of [
        [browseRoot, false],
        [projectsDir, true],
      ] as const) {
        if (configuredRoot === undefined) continue;
        // Validated ON CHANGE, never at load (spec): browse roots must already
        // exist; checkout roots use `mkdir -p`. Both get a real write probe.
        // Any failure → 400 and NO change persisted.
        const expanded = expandTilde(configuredRoot);
        if (!isAbsolutePath(expanded)) {
          return c.json({ error: `not writable: ${configuredRoot} is not an absolute path` }, 400);
        }
        if (!create) {
          try {
            if (!(await stat(expanded)).isDirectory()) {
              return c.json({ error: `browse folder is not a directory: ${configuredRoot}` }, 400);
            }
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              return c.json({ error: `browse folder does not exist: ${configuredRoot}` }, 400);
            }
            return c.json({ error: `browse folder unavailable: ${err instanceof Error ? err.message : String(err)}` }, 400);
          }
        }
        const probeError = await probeWritableDir(expanded, create);
        if (probeError !== null) return c.json({ error: `not writable: ${probeError}` }, 400);
      }
      let written: WorkspaceConfig;
      try {
        written = await mergeWriteWorkspaceConfig((config) => {
          if (branding?.name === null) delete config.branding.name;
          else if (branding?.name !== undefined) config.branding.name = branding.name;
          // Roots are stored as written (`~` kept); only the probe expands them.
          if (browseRoot !== undefined) config.browseRoot = browseRoot;
          if (projectsDir !== undefined) config.projectsDir = projectsDir;
          if (orgSkillsRepos !== undefined) {
            if (orgSkillsRepos.length === 0) delete config.orgSkillsRepos;
            else config.orgSkillsRepos = orgSkillsRepos;
          }
          if (systemPrompt === null || systemPrompt === '') delete config.systemPrompt;
          else if (systemPrompt !== undefined) config.systemPrompt = systemPrompt;
          if (limitsPatch !== undefined) config.limits = limitsPatch;
          if (managerWorkerPatch !== undefined) config.managerWorker = managerWorkerPatch;
          if (taskPresetsPatch !== undefined) config.taskPresets = taskPresetsPatch;
          if (permissionsPatch?.antigravity !== undefined) config.agentPermissions = { ...config.agentPermissions, antigravity: permissionsPatch.antigravity };
          if (safetyPatch !== undefined) config.safety = { ...config.safety, ...safetyPatch };
          if (composerDefaults?.autonomous === null) delete config.composerDefaults.autonomous;
          else if (composerDefaults?.autonomous !== undefined) {
            config.composerDefaults.autonomous = composerDefaults.autonomous;
          }
          if (composerDefaults?.worktree === null) delete config.composerDefaults.worktree;
          else if (composerDefaults?.worktree !== undefined) {
            config.composerDefaults.worktree = composerDefaults.worktree;
          }
          if (resources?.maxParallel !== undefined) config.resources.maxParallel = resources.maxParallel;
          if (resources?.maxMonitoringSessions !== undefined) {
            config.resources.maxMonitoringSessions = resources.maxMonitoringSessions;
          }
          if (resources?.idleTimeoutMinutes !== undefined) {
            config.resources.idleTimeoutMinutes = resources.idleTimeoutMinutes;
          }
          if (resources?.monitoringWakeIntervalMinutes !== undefined) {
            config.resources.monitoringWakeIntervalMinutes = resources.monitoringWakeIntervalMinutes;
          }
          if (resources?.autoResumeOnUsageLimit !== undefined) {
            config.resources.autoResumeOnUsageLimit = resources.autoResumeOnUsageLimit;
          }
          if (resources?.memoryLimitMb !== undefined) config.resources.memoryLimitMb = resources.memoryLimitMb;
          if (resources?.worktreeRetentionDefault !== undefined) {
            config.resources.worktreeRetentionDefault = resources.worktreeRetentionDefault;
          }
          // `null` CLEARS back to "no opinion" — a partial patch cannot say that by omission,
          // and leaving a stale runner behind would keep overriding repos that never chose.
          if (agentDefaults?.runner === null) delete config.agentDefaults.runner;
          else if (agentDefaults?.runner !== undefined) config.agentDefaults.runner = agentDefaults.runner;
          for (const runner of PROVIDER_IDS) {
            const model = agentDefaults?.models?.[runner];
            if (model === undefined) continue;
            const models = config.agentDefaults.models ?? {};
            if (model === null) delete models[runner];
            else models[runner] = model;
            // An empty object would persist a key that says nothing; absence is the same answer.
            if (Object.keys(models).length === 0) delete config.agentDefaults.models;
            else config.agentDefaults.models = models;
          }
        });
      } catch (err) {
        // e.g. a read-only home — nothing was persisted (atomic tmp+rename).
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
      // A resource change takes effect WITHOUT a restart: refresh the shared
      // semaphore's in-memory snapshot and pump every manager (step 2.5's hook).
      if (resources !== undefined || limitsPatch !== undefined || safetyPatch !== undefined) await deps.semaphore?.refresh();
      return c.json(workspaceConfigBody(written));
    })

    .use('/workspace/branding-logo', bodyLimit({ maxSize: BRANDING_LOGO_MAX_BYTES + 64 * 1024 }))

    .get('/workspace/branding-logo', async (c) => {
      for (const filename of [BRANDING_LOGO_FILE, ...BRANDING_LOGO_EXTENSIONS.map((ext) => `${BRANDING_LOGO_FILE}${ext}`)]) {
        try {
          const bytes = await readFile(join(onniHomeDir(), filename));
          const imageType = brandingLogoType(bytes);
          if (!imageType) continue;
          const [mime] = imageType;
          return c.body(new Uint8Array(bytes), 200, { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
        } catch { /* check the next supported image */ }
      }
      return c.json({ error: 'Brand logo not found' }, 404);
    })
    .post('/workspace/branding-logo', multipartZodValidator(() => brandingLogoUploadSchema), async (c) => {
      const { file } = c.req.valid('form');
      const bytes = Buffer.from(await file.arrayBuffer());
      await mkdir(onniHomeDir(), { recursive: true, mode: 0o700 });
      const path = join(onniHomeDir(), BRANDING_LOGO_FILE);
      const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, bytes, { mode: 0o600, flag: 'wx' });
        await renameWithRetry(tmp, path);
      } catch (error) {
        await unlink(tmp).catch(() => {});
        throw error;
      }
      return c.json(workspaceBrandingLogoResponseSchema.parse({ logoUrl: logoAssetUrl() }));
    })
    .delete('/workspace/branding-logo', async (c) => {
      await Promise.all([BRANDING_LOGO_FILE, ...BRANDING_LOGO_EXTENSIONS.map((ext) => `${BRANDING_LOGO_FILE}${ext}`)]
        .map((filename) => unlink(join(onniHomeDir(), filename)).catch(() => {})));
      return c.json(workspaceBrandingLogoResponseSchema.parse({ logoUrl: null }));
    })

    // Staged attachments (telemetry 7054e5f2): the composer uploads each file when it is attached
    // and the message references it, so attachments stop sharing one request body. One file per
    // request rides the global body limit.
    .post('/workspace/uploads', jsonZodValidator(attachmentInputSchema), (c) => {
      const result = writeUpload(c.req.valid('json'));
      // The fs error names a path under the user's home; the cockpit reports this answer to telemetry.
      if (!result.ok) return c.json({ error: 'could not stage the attachment' }, 500);
      return c.json(stagedUploadSchema.parse(result.upload));
    })
    .delete('/workspace/uploads/:uploadId', paramZodValidator(uploadIdParamSchema), (c) => {
      deleteUpload(c.req.valid('param').uploadId);
      return c.json(deleteUploadResponseSchema.parse({ deleted: true }));
    })

    // Global GUI state (`~/.onni/ui-state.json`) — same parse/key-cap/shallow-
    // merge semantics as the per-repo /api/v1/ui-state route below (the shared half
    // is `uiStateBodySchema`), but backed by the workspace file.
    .get('/workspace/ui-state', async (c) => c.json(await readWorkspaceUiState()))

    // The tighter body cap rides on `use` rather than inline on the route: `bodyLimit` is typed
    // as a bare MiddlewareHandler, and passing one to `.put()` collapses the route's schema, so
    // the PUT went missing from `AppType` and `hc` could not see its body at all. `use` runs at
    // the same point (before the handler, so the cap still precedes any read) and leaves the
    // chain's type accumulation alone. Method-agnostic here, which the GET does not mind.
    .use('/workspace/ui-state', bodyLimit({ maxSize: UI_STATE_BODY_LIMIT }))

    .put('/workspace/ui-state', jsonZodValidator(setWorkspaceUiStateInputSchema), async (c) => {
      const parsed = { data: c.req.valid('json') };
      try {
        return c.json(
          await mergeWriteWorkspaceUiState((state) => ({
            ...state,
            ...parsed.data,
          })),
        );
      } catch (err) {
        // A read-only home degrades to an unsaved pref, never a crash.
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    });

}
