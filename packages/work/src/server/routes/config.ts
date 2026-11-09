import { mkdir, readFile, writeFile } from 'node:fs/promises';\r\nimport { join } from 'node:path';\r\nimport { Hono } from 'hono';\r\nimport { z } from 'zod';\r\nimport { setConfigInputSchema } from '@onni/contract';\r\nimport { AGENT_MODELS_LOCKED_ERROR, agentModelsLocked } from '../../core/agent-model-policy.ts';\r\nimport { readAgentModelDefaults } from '../../agent-config/models.ts';\r\nimport type { AgentModelDefaults } from '../../agent-config/models.ts';\r\nimport { loadConfig, type OnniConfig } from '../../config.ts';\r\nimport { atomicLifecycleWrite, LifecycleStoreError } from '../../worktree-lifecycle/store.ts';\r\nimport { applyLifecycleConfigUpdate, isLifecycleConfigTracked, lifecycleConfigFromRaw, LifecycleConfigError, readLifecycleConfigOrDefault, readLifecycleConfigRaw, TRACKED_CONFIG_ERROR, withLifecycleConfigLock } from '../../worktree-lifecycle/config.ts';\r\nimport { validateLifecycleCommand } from '../../worktree-lifecycle/templates.ts';\r\nimport { lifecycleError } from '../worktree-lifecycle.ts';\r\nimport type { ProjectContext } from '../project-context.ts';\r\nimport { jsonZodValidator } from '../validators.ts';\r\n\r\ntype ProjectApiEnv = { Variables: { project: ProjectContext } };
export function createConfigRoutes() {
\r\n  // An explicit "auto" default becomes `''` on the wire (#906): the empty id IS
  // auto in every model picker, so an older cockpit reading this answer shows
  // auto too rather than tripping over an unknown sentinel. Only `true` counts —
  // `false` is the absence of an opinion, not an opinion.
  // Typed rather than left to `Object.fromEntries`' index signature: `configAnswer`'s return type
  // is asserted `Exact` against `configResponseSchema` (contract-parity.workspace.test.ts), and an
  // index signature leaking into the spread would widen `defaultModels` past the contract.
  const autoModelOverrides = (auto: OnniConfig['defaultModelsAuto']): AgentModelDefaults =>
    Object.fromEntries(
      Object.entries(auto ?? {})
        .filter(([, isAuto]) => isAuto === true)
        .map(([runner]) => [runner, '']),
    );

  // The Settings → Agents knobs in one read (R6 Step 1.5) — an ADDITIVE
  // sibling of PUT /api/config below; /api/health keeps its protected shape.
  const configAnswer = async (repoRoot: string, config: OnniConfig) => {
    const lifecycle = await readLifecycleConfigOrDefault(repoRoot, { trust: false });
    const nativeModels = await readAgentModelDefaults(repoRoot);
    const modelsLocked = agentModelsLocked(repoRoot);
    return {
      baseBranch: config.baseBranch ?? null,
      defaultRunner: config.defaultRunner,
      systemPrompt: config.systemPrompt ?? null,
      branchNaming: config.branchNaming ?? null,
      // Native defaults seed each runner independently. A Onni preset remains
      // selectable unless the operator opts into the fixed-model policy.
      // An explicit auto override (#906) answers `''` for that runner — the one
      // way to say "ignore the agent's own configured default" without editing
      // the vendor's settings file. It layers over the native seed and under a
      // repo preset, so setting a preset later simply wins.
      defaultModels: modelsLocked
        ? nativeModels
        : {
            ...nativeModels,
            ...autoModelOverrides(config.defaultModelsAuto),
            ...(config.defaultModels ?? {}),
          },
      modelsLocked,
      maxParallel: config.maxParallel,
      memoryLimitMb: config.memoryLimitMb ?? null,
      // Count-based worktree retention (#483): keep the last N finished worktrees
      // on disk. 0 = unlimited. Always materialized (schema default 10).
      worktreeRetention: config.worktreeRetention,
      ...(lifecycle.configured ? { worktreeLifecycle: lifecycle.config, worktreeLifecycleRevision: lifecycle.revision! } : {}),
      // Live title updates (task auto-naming spec): tri-state — null means "no
      // config key, the ONNI_TITLE_UPDATES env default (ON) decides".
      liveTitleUpdates: config.liveTitleUpdates ?? null,
      // Optional review gate (#489): tri-state — null means "no config key, the
      // ONNI_REVIEW_GATE env default (OFF) decides".
      reviewGate: config.reviewGate ?? null,
      profile: config.profile ?? null,
      taskWorkspace: config.taskWorkspace ?? null,
      landing: config.landing ?? null,
      landingBlocked:
        config.landing === 'auto' && (await isLifecycleConfigTracked(repoRoot).catch(() => true))
          ? 'auto-land is not honored: .ai/onni/config.json is tracked by git, and only local configuration can grant it'
          : null,
      requiredChecks: config.requiredChecks ?? [],
      defaultSkill: config.defaultSkill ?? null,
      askSkill: config.askSkill ?? null,
      teamSkills: config.skillsRepos.length > 0,
    };
  };
  // ---- chained family: per-repo config (project-scoped) ----
  const configRoutes = new Hono<ProjectApiEnv>()
    .get('/config', async (c) => {
      const repoRoot = c.get('project').root;
      try { return c.json(await configAnswer(repoRoot, await loadConfig(repoRoot))); }
      catch (error) { return lifecycleError(c, error); }
    })

    .put('/config', jsonZodValidator(setConfigInputSchema), async (c) => {
      const { root: repoRoot, dataDir } = c.get('project');
      const parsed = { data: c.req.valid('json') };
      // The auto override is a model choice too (#906), so the fixed-model
      // policy refuses it on exactly the same terms as a preset.
      if (
        agentModelsLocked(repoRoot) &&
        (parsed.data.defaultModels !== undefined || parsed.data.defaultModelsAuto !== undefined)
      ) {
        return c.json({ error: AGENT_MODELS_LOCKED_ERROR }, 409);
      }
      try {
        const configPath = join(dataDir, 'config.json');
        const save = async (locked: boolean) => {
          let raw: Record<string, unknown> = {};
          try { raw = await readLifecycleConfigRaw(repoRoot); }
          catch (error) {
            // Malformed or unreadable — start fresh, as before scripts existed. Unlocked (symlinked
            // data dir) reads the file the way the old route did.
            if (locked && !(error instanceof LifecycleConfigError)) throw error;
            if (!locked) {
              try {
                const existing: unknown = JSON.parse(await readFile(configPath, 'utf8'));
                if (existing && typeof existing === 'object' && !Array.isArray(existing)) raw = existing as Record<string, unknown>;
              } catch { /* missing or malformed — start fresh */ }
            }
          }
          lifecycleConfigFromRaw(raw); // An unrelated save cannot silently repair or reset unsupported hooks.
          if (parsed.data.worktreeLifecycle !== undefined) {
            if (parsed.data.worktreeLifecycleRevision === undefined) throw new Error('Reload settings before saving worktree scripts: revision is required');
            if (parsed.data.worktreeLifecycle !== null) {
              for (const entry of [...parsed.data.worktreeLifecycle.afterCreate, ...parsed.data.worktreeLifecycle.beforeRemove]) validateLifecycleCommand(entry.command);
              const scripts = parsed.data.worktreeLifecycle.afterCreate.length + parsed.data.worktreeLifecycle.beforeRemove.length;
              if (scripts > 0 && await isLifecycleConfigTracked(repoRoot)) throw new LifecycleConfigError(TRACKED_CONFIG_ERROR);
            }
            raw = applyLifecycleConfigUpdate(raw, parsed.data.worktreeLifecycle, parsed.data.worktreeLifecycleRevision);
          }
          if (parsed.data.baseBranch !== undefined) {
            if (parsed.data.baseBranch === null) delete raw.baseBranch;
            else raw.baseBranch = parsed.data.baseBranch;
          }
          if (parsed.data.defaultRunner !== undefined) raw.defaultRunner = parsed.data.defaultRunner;
          if (parsed.data.systemPrompt !== undefined) {
            // '' and null both clear: an emptied textarea means "no extra prompt".
            if (parsed.data.systemPrompt === null || parsed.data.systemPrompt === '') {
              delete raw.systemPrompt;
            } else {
              raw.systemPrompt = parsed.data.systemPrompt;
            }
          }
          if (parsed.data.branchNaming !== undefined) {
            // Same clearing rule as systemPrompt: an emptied textarea means `onni/<id8>` again.
            if (parsed.data.branchNaming === null || parsed.data.branchNaming === '') {
              delete raw.branchNaming;
            } else {
              raw.branchNaming = parsed.data.branchNaming;
            }
          }
          if (parsed.data.maxParallel !== undefined) raw.maxParallel = parsed.data.maxParallel;
          if (parsed.data.worktreeRetention !== undefined) {
            // null clears back to the default (10); a number (including 0 = unlimited)
            // is stored as-is.
            if (parsed.data.worktreeRetention === null) delete raw.worktreeRetention;
            else raw.worktreeRetention = parsed.data.worktreeRetention;
          }
          if (parsed.data.liveTitleUpdates !== undefined) {
            if (parsed.data.liveTitleUpdates === null) delete raw.liveTitleUpdates;
            else raw.liveTitleUpdates = parsed.data.liveTitleUpdates;
          }
          if (parsed.data.reviewGate !== undefined) {
            if (parsed.data.reviewGate === null) delete raw.reviewGate;
            else raw.reviewGate = parsed.data.reviewGate;
          }
          // Trunk-based keys (spec 2026-10-20-trunk-based-projects): null or '' clears.
          for (const key of ['profile', 'taskWorkspace', 'landing', 'defaultSkill', 'askSkill'] as const) {
            const value = parsed.data[key];
            if (value === undefined) continue;
            if (value === null || value === '') delete raw[key];
            else raw[key] = value;
          }
          if (parsed.data.requiredChecks !== undefined) {
            if (!parsed.data.requiredChecks?.length) delete raw.requiredChecks;
            else raw.requiredChecks = parsed.data.requiredChecks;
          }
          if (parsed.data.teamSkills === false) raw.skillsRepos = [];
          else if (parsed.data.teamSkills === true && Array.isArray(raw.skillsRepos) && raw.skillsRepos.length === 0) {
            delete raw.skillsRepos;
          }
          if (parsed.data.memoryLimitMb !== undefined) {
            // null or 0 both mean "no ceiling" — drop the key back to the default.
            if (parsed.data.memoryLimitMb === null || parsed.data.memoryLimitMb === 0) {
              delete raw.memoryLimitMb;
            } else {
              raw.memoryLimitMb = parsed.data.memoryLimitMb;
            }
          }
          if (parsed.data.defaultModels !== undefined) {
            // Per-runner merge, so setting codex's preset never clobbers claude's.
            const current =
              raw.defaultModels && typeof raw.defaultModels === 'object'
                ? { ...(raw.defaultModels as Record<string, unknown>) }
                : {};
            for (const [runner, model] of Object.entries(parsed.data.defaultModels)) {
              if (model === undefined) continue;
              if (model === null || model === '') delete current[runner];
              else current[runner] = model;
            }
            if (Object.keys(current).length === 0) delete raw.defaultModels;
            else raw.defaultModels = current;
          }
          if (parsed.data.defaultModelsAuto !== undefined) {
            // Same per-runner merge as the presets above, and the same "store only a
            // real opinion" rule: `false`/`null` deletes rather than persisting a
            // key that means nothing (#906).
            const current =
              raw.defaultModelsAuto && typeof raw.defaultModelsAuto === 'object'
                ? { ...(raw.defaultModelsAuto as Record<string, unknown>) }
                : {};
            for (const [runner, isAuto] of Object.entries(parsed.data.defaultModelsAuto)) {
              if (isAuto === undefined) continue;
              if (isAuto) current[runner] = true;
              else delete current[runner];
            }
            if (Object.keys(current).length === 0) delete raw.defaultModelsAuto;
            else raw.defaultModelsAuto = current;
          }
          if (locked) await atomicLifecycleWrite(configPath, raw);
          else {
            await mkdir(dataDir, { recursive: true });
            await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
          }
        };
        // All config writers share this short lock with the transition's final revision check.
        try { await withLifecycleConfigLock(repoRoot, () => save(true)); }
        catch (error) {
          // The lifecycle store refuses a symlinked data dir; settings without scripts still save.
          if (!(error instanceof LifecycleStoreError) || parsed.data.worktreeLifecycle !== undefined) throw error;
          await save(false);
        }
        return c.json(await configAnswer(repoRoot, await loadConfig(repoRoot)));
      } catch (error) { return lifecycleError(c, error); }
    });

  return configRoutes;
}
