import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { createProjectInputSchema, updateProjectInputSchema, type Capabilities } from '@onni/contract';
import { PROJECT_ID_RE, defaultWorkspaceConfig, loadWorkspaceConfig, mergeWriteWorkspaceConfig, type WorkspaceProject } from '../../workspace/config.ts';
import { listProjects, normalizeProjectTags, probeProjectStatus, registerProject, removeProject, shouldRegisterProject, type ProjectListEntry } from '../../workspace/projects.ts';
import { expandTilde, isAbsolutePath } from '../../paths.ts';
import { checkoutRepo, type CloneRunner } from '../checkout.ts';
import { createProject, listGithubOwners, type CommandRunner } from '../create-project.ts';
import { isInsideBrowseRoot, isLexicallyInsideBrowseRoot, resolveBrowseRoot } from '../fs-browse.ts';
import type { ProjectContext, ProjectContexts } from '../project-context.ts';
import type { RunStatus } from '../../runs/store.ts';
import type { WorkspaceSemaphore } from '../../workspace/semaphore.ts';
import type { TrackerWatches } from '../tracker/watch.ts';
import type { WebhookCoordinator } from '../../webhooks/coordinator.ts';
import { jsonZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

export const projectIdSchema = z.union([z.literal('default'), z.string().regex(PROJECT_ID_RE)]);

/** `GET /api/projects` (multi-project spec) — the workspace registry with
 *  per-root status probes. Absolute `root`s belong HERE (same-origin, behind
 *  the cockpit) and are deliberately never mirrored into the CORS-open
 *  `/api/health` payload (#431 — see the health route). Never 404s. */
export interface ProjectsResponse {
  projects: ProjectListEntry[];
  bootProject: string;
  projectsDir: string;
}

/** `POST /api/projects` (multi-project spec, step 4.2) — the folder-browser
 *  dialog's commit step. The entry carries the same `status`/`branch` probe
 *  `GET /api/projects` attaches, so the cockpit sees one project shape.
 *  `error` is present ONLY on the 409 (already registered), where `project` is
 *  the EXISTING entry — the dialog navigates to it instead of dead-ending. */
export interface RegisterProjectResponse {
  project: ProjectListEntry;
  error?: string;
}

/** `DELETE /api/projects/:projectId` (multi-project spec, step 4.4) — the
 *  Projects settings pane's Remove. DEREGISTRATION ONLY: the entry leaves
 *  `~/.onni/config.json` and nothing under the project root is read, moved or
 *  deleted. `removed` is always true on a 200 (the failure paths are 404/409). */
export interface RemoveProjectResponse {
  removed: true;
  id: string;
}

/** `PATCH /api/projects/:projectId` (spec 2026-07-22-per-project-concurrency)
 *  — sets or clears a project's per-project `maxParallel`. The entry carries
 *  the same `status`/`branch` probe `GET /api/projects` attaches, so the
 *  cockpit sees one project shape. `null` in the request clears the override
 *  back to "inherit the workspace cap". */
export interface UpdateProjectResponse {
  project: ProjectListEntry;
}

// ---- GUI clone (multi-project spec, step 4.3) ----------------------------
// "Add project → Clone from GitHub": clone into the checkout root, then
// register the result through `registerFolder` below (same guards, same
// `project-added`). Everything dangerous — where the clone may land, and
// what a failed clone is allowed to delete — lives in src/server/checkout.ts.
//
// Long-running by design (the spec's contract): the response lands when the
// clone finishes, and the dialog's liveness comes from `checkout-progress`
// events on the workspace stream. `checkoutId` is the cockpit's own
// correlation token, echoed on every event so two tabs cloning at once never
// render each other's progress.
const checkoutSchema = z.object({
  url: z.string().trim().min(1).max(512),
  name: z.string().trim().max(128).optional(),
  checkoutId: z.string().trim().max(128).optional(),
});


type ProjectsRouteDeps = {
  capabilities: () => Capabilities;
  bootRoot: string;
  resolveBootProject: (projects?: readonly WorkspaceProject[]) => Promise<string>;
  contexts: ProjectContexts;
  workspaceEvents: { emit: (event: 'project-added' | 'project-removed' | 'checkout-progress', data: unknown) => void };
  trackerWatches: Pick<TrackerWatches, 'invalidateProject'>;
  stopTaskProcesses: (runId: string) => void;
  webhooks: Pick<WebhookCoordinator, 'remove'> | undefined;
  workspaceBrowseRoot: () => Promise<string>;
  singleProjectRefusal: (action: 'adding projects' | 'editing projects' | 'removing projects' | 'folder browsing') => { error: string };
  semaphore?: WorkspaceSemaphore;
  cloneRunner?: CloneRunner;
  projectCommandRunner?: CommandRunner;
};

export function projectsRoutes(deps: ProjectsRouteDeps) {
  const {
    capabilities,
    bootRoot,
    resolveBootProject,
    contexts,
    workspaceEvents,
    trackerWatches,
    stopTaskProcesses,
    webhooks,
    workspaceBrowseRoot,
    singleProjectRefusal,
  } = deps;

  // ---- workspace projects (multi-project spec) -----------------------------
  // The registered-project list for the cockpit sidebar. Same-origin (unlike
  // health), so absolute `root`s are fine here. `listProjects()` TTL-caches
  // its per-root status/branch probes, so a burst of renders never shells git
  // N times. Never 404s: empty or unreadable registry → `projects: []`.
  /** The configured checkout root, as WRITTEN (`~` kept — callers that touch
   *  the filesystem expand it). An unreadable workspace degrades to the
   *  default rather than failing the request: every caller here is a route
   *  that must keep answering. */
  const workspaceProjectsDir = async (): Promise<string> => {
    try {
      return (await loadWorkspaceConfig()).projectsDir;
    } catch {
      return defaultWorkspaceConfig().projectsDir;
    }
  };



  // ---- chained family: project registry (workspace-level) ----
  const projectsRoutes = new Hono<ProjectApiEnv>()
    .get('/projects', async (c) => {
      let projects: ProjectListEntry[] = [];
      let projectsDir = defaultWorkspaceConfig().projectsDir;
      try {
        projectsDir = (await loadWorkspaceConfig()).projectsDir;
        const selector = capabilities().singleProject
          ? { projectId: await resolveBootProject() }
          : undefined;
        projects = await listProjects(selector);
      } catch {
        // unreadable workspace — degrade to the empty registry + defaults
      }
      const bootProject = await resolveBootProject(projects);
      // The folder this server was started in, when the registry does not hold
      // it — listed ONLY while the registry is empty, which is the same "seed
      // once" rule `shouldAutoRegisterProject` applies to the registry write
      // (#774 follow-up). With no projects the launch folder IS the cockpit's
      // project, and a cockpit showing the one folder it can definitely serve
      // beats an empty sidebar — that also covers the unreadable workspace,
      // where nothing is registered as far as this process can tell.
      //
      // Once the user HAS projects, starting onni somewhere else is opening
      // the cockpit from a folder, not adding it: listing that folder put a row
      // in the sidebar, the ⌘K palette and Settings that the user never asked
      // for and has to clean up. The folder is still served — the boot context
      // answers `/p/<bootProject>/…` and the unscoped alias, and the scope gate
      // treats `bootProject` as known — so a legacy bookmark still resolves; it
      // simply is not a project. Saving it stays the explicit gesture it is
      // everywhere else: Settings → Add project, or `onni projects add`.
      //
      // It is marked `unregistered` rather than merged in silently, so Settings
      // offers to add it instead of offering Remove/Max parallel it cannot
      // honour.
      if (projects.length === 0) {
        const root = await realpath(bootRoot).catch(() => bootRoot);
        projects = [
          {
            id: bootProject,
            root,
            name: basename(root),
            // Never registered, so it has no registry timestamps to report —
            // empty rather than invented, and Settings renders "—" for them.
            addedAt: '',
            lastOpenedAt: '',
            source: 'local',
            unregistered: true,
            ...((await shouldRegisterProject(root)) ? {} : { notAddable: true as const }),
            ...(await probeProjectStatus(root)),
          },
          ...projects,
        ];
      }
      const body: ProjectsResponse = { projects, bootProject, projectsDir };
      return c.json(body);
    })

    .post('/projects', jsonZodValidator(() => registerProjectSchema, { message: 'root must be a non-empty path' }), async (c) => {
      const parsed = { data: c.req.valid('json') };
      const registered = await registerFolder(parsed.data.root, 'local');
      if (registered.status !== 200) return c.json(registered.body, registered.status);
      // Only a genuinely new project: a re-add answers 409 above and is not an event.
      return c.json(registered.body, 200);
    })

    .delete('/projects/:projectId', async (c) => {
      if (capabilities().singleProject) {
        return c.json(singleProjectRefusal('removing projects'), 409);
      }
      const raw = c.req.param('projectId');
      // Same gate the scoped-route resolver applies, and the same 404 wording —
      // a malformed id is an unknown project, not a validation essay.
      if (!projectIdSchema.safeParse(raw).success) {
        return c.json({ error: `unknown project: ${raw}` }, 404);
      }
      const bootId = await resolveBootProject();
      // `default` is the boot alias everywhere else in the API; honour it here
      // too rather than 404ing a spelling the cockpit is allowed to use.
      const id = raw === 'default' ? bootId : raw;

      let entry: WorkspaceProject | undefined;
      try {
        entry = (await loadWorkspaceConfig()).projects.find((p) => p.id === id);
      } catch {
        // unreadable workspace — there is nothing to remove, and saying so is
        // more useful than a 500 the user cannot act on
      }
      if (!entry) return c.json({ error: `unknown project: ${id}` }, 404);

      // The boot project is refused, not removed: this server is serving that
      // repo right now, and dropping its registry row would break the session's
      // own sidebar while the process keeps running out of it. Offline removal
      // is the honest gesture — `onni projects remove` has no such refusal
      // because it runs with no server. The pane disables the button and says
      // the same thing.
      if (id === bootId) {
        return c.json(
          {
            error: `onni is serving ${entry.name} right now — stop it and run \`onni projects remove ${id}\` to drop the registry entry`,
          },
          409,
        );
      }

      const active = activeRunCount(id);
      if (active > 0) {
        return c.json(
          {
            error: `${entry.name} has ${active} running task${active === 1 ? '' : 's'} — cancel or finish ${active === 1 ? 'it' : 'them'} before removing the project`,
            runningTasks: active,
          },
          409,
        );
      }

      let removed: boolean;
      try {
        removed = await removeProject(id);
      } catch (err) {
        // e.g. a read-only home — nothing was persisted (atomic tmp+rename).
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
      // Lost a race with another writer (or another onni process): the entry is
      // gone, which is what the caller wanted, but say it honestly.
      if (!removed) return c.json({ error: `unknown project: ${id}` }, 404);
      // Stop capture only after the registry commit; failed removal must leave
      // the registered project operational. Pause before disposing its context.
      const webhookWarning = await webhooks?.remove(entry.root);
      // In-process handles for a project no route can reach any more: store
      // closed (index flushed), manager's timers and usage subscription dropped.
      trackerWatches.invalidateProject(entry.root);
      // Its terminals live in the app-level registry, which no project route reaches once it is gone.
      for (const run of contexts.peek(id)?.store.listRuns() ?? []) stopTaskProcesses(run.id);
      contexts.dispose(id);
      workspaceEvents.emit('project-removed', { id });
      const body: RemoveProjectResponse = { removed: true, id, ...(webhookWarning ? { warning: webhookWarning } : {}) };
      return c.json(body);
    })

    // Edit the per-project registry fields the cockpit owns: the concurrency ceiling (spec
    // 2026-07-22-per-project-concurrency) and the grouping tags (spec
    // 2026-08-10-global-tasks-and-project-tags). A PATCH (not PUT) because it touches named
    // fields and leaves the rest of the entry alone, and a distinct route from POST
    // (register-a-folder) to keep register vs. edit semantics clear.
    //
    // The body schema is the CONTRACT's, passed directly rather than restated behind a thunk:
    // it is already in scope, and a second copy is a second thing to keep in step. Its bounds
    // mirror `workspaceProjectSchema` (config.ts) exactly, so a value this route accepts can
    // never be degraded away by the next load's `.catch`.
    //
    // Deliberately NOT the home of the agent-account selection: that lives in
    // `~/.onni/agent-accounts.json` beside the accounts it names, so a onni version that has
    // never heard of accounts cannot drop it (see workspace/agent-accounts.ts).
    .patch('/projects/:projectId', jsonZodValidator(updateProjectInputSchema), async (c) => {
      if (capabilities().singleProject) {
        return c.json(singleProjectRefusal('editing projects'), 409);
      }
      const raw = c.req.param('projectId');
      // Same gate + 404 wording as DELETE: a malformed id is an unknown project.
      if (!projectIdSchema.safeParse(raw).success) {
        return c.json({ error: `unknown project: ${raw}` }, 404);
      }
      const parsed = { data: c.req.valid('json') };
      // `default` is the boot alias the cockpit is allowed to use everywhere else.
      const id = raw === 'default' ? await resolveBootProject() : raw;
      const { maxParallel, tags } = parsed.data;

      // Read-first (mirroring DELETE, server.ts:1252-1258): a well-formed but
      // unknown id must 404 WITHOUT rewriting the config — otherwise it would both
      // do a needless full-config tmp+rename and, on a read-only home, surface the
      // write failure as a 500 where the honest answer is 404.
      let known = false;
      try {
        known = (await loadWorkspaceConfig()).projects.some((p) => p.id === id);
      } catch {
        // unreadable workspace — treat as unknown; the read-only case answers 404,
        // not a 500 the caller cannot act on (same reasoning as DELETE).
      }
      if (!known) return c.json({ error: `unknown project: ${id}` }, 404);

      let updated: WorkspaceProject | undefined;
      try {
        await mergeWriteWorkspaceConfig((config) => {
          const entry = config.projects.find((p) => p.id === id);
          if (!entry) return; // lost a race with a concurrent remove — answered below
          // Each key is applied only when the body NAMED it: a PATCH that says
          // nothing about a field must leave it exactly as it was, which is what
          // keeps the tags editor from clearing a concurrency ceiling (and the
          // pre-tags `{ maxParallel }` body from clearing tags). null clears;
          // a value sets. Mutated in place so `.passthrough()` keys survive.
          if (maxParallel !== undefined) {
            if (maxParallel === null) delete entry.maxParallel;
            else entry.maxParallel = maxParallel;
          }
          if (tags !== undefined) {
            // Normalized on the way IN, so every reader — this API, the CLI, the
            // global Tasks page — sees one spelling per tag and never has to
            // fold case itself.
            const normalized = normalizeProjectTags(tags);
            if (normalized === undefined) delete entry.tags;
            else entry.tags = normalized;
          }
          updated = entry;
        });
      } catch (err) {
        // e.g. a read-only home — nothing was persisted (atomic tmp+rename).
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
      // Raced with a concurrent removal between the read and the write.
      if (!updated) return c.json({ error: `unknown project: ${id}` }, 404);

      // The new ceiling takes effect WITHOUT a restart: refresh the shared
      // semaphore's snapshot and pump every manager — the same live-apply hook
      // `PUT /api/workspace/config` fires for a workspace-cap change.
      await deps.semaphore?.refresh();
      const body: UpdateProjectResponse = {
        project: { ...updated, ...(await probeProjectStatus(updated.root)) },
      };
      return c.json(body);
    })

    .post('/projects/checkout', jsonZodValidator(() => checkoutSchema, { message: 'url must be a GitHub repository' }), async (c) => {
      if (capabilities().singleProject) {
        return c.json(singleProjectRefusal('adding projects'), 409);
      }
      const parsed = { data: c.req.valid('json') };
      const { url, name, checkoutId } = parsed.data;
      const result = await checkoutRepo({
        url,
        name,
        checkoutId,
        projectsDir: expandTilde(await workspaceProjectsDir()),
        onProgress: (event) => workspaceEvents.emit('checkout-progress', event),
        // A closed dialog / navigated-away tab aborts the request; the clone is
        // killed and its partial directory removed rather than left running.
        signal: c.req.raw.signal,
        ...(deps.cloneRunner ? { run: deps.cloneRunner } : {}),
      });
      if (!result.ok) {
        // `reason` rides along on the 503 (`gh` unavailable) — the spec's
        // `{ error, reason }` degradation, mirroring the GitHub pane.
        return c.json(
          'reason' in result ? { error: result.error, reason: result.reason } : { error: result.error },
          result.status,
        );
      }
      const registered = await registerFolder(result.target, 'checkout');
      if (registered.status !== 200) {
        // The clone SUCCEEDED and its files are legitimately the user's, so this
        // path deliberately does NOT clean up — an unregisterable checkout is a
        // registry problem, not a reason to delete a repo we just fetched. Say
        // where it is so they can register it by hand.
        const { body } = registered;
        const error = 'error' in body && body.error ? body.error : 'could not register the checkout';
        return c.json({ error: `${error} (the clone is at ${result.target})` }, registered.status);
      }
      // The checkout dialog only clones GitHub repositories (`checkoutSchema`).
      return c.json(registered.body, 200);
    })

    // ---- new project (spec 2026-09-29-create-new-project) ------------------
    // "Add project → New project": a fresh git repo at `<projectsDir>/<name>`,
    // optionally backed by a new PRIVATE GitHub repository (never public — the
    // body has no visibility field to set), optionally generated from a
    // template. Same progress stream, same `registerFolder` commit, same
    // `{ error, reason }` degradation as the clone route above.
    .get('/projects/github-owners', async (c) => c.json(await listGithubOwners(deps.projectCommandRunner)))

    .post('/projects/create', jsonZodValidator(() => createProjectInputSchema, { message: 'project name must be a valid GitHub repository name — letters, digits, ".", "-" and "_" only, no spaces' }), async (c) => {
      if (capabilities().singleProject) {
        return c.json(singleProjectRefusal('adding projects'), 409);
      }
      const { name, github, checkoutId } = c.req.valid('json');
      const result = await createProject({
        name,
        github,
        checkoutId,
        projectsDir: expandTilde(await workspaceProjectsDir()),
        onProgress: (event) => workspaceEvents.emit('checkout-progress', event),
        signal: c.req.raw.signal,
        ...(deps.projectCommandRunner ? { run: deps.projectCommandRunner } : {}),
      });
      if (!result.ok) {
        // The stage, never the error text: that can carry paths and repository names.
        return c.json(
          'reason' in result ? { error: result.error, reason: result.reason } : { error: result.error },
          result.status,
        );
      }
      // GitHub-backed projects register as `checkout` (they have an origin the
      // clone flow would also produce); a local-only repo is `local`.
      const registered = await registerFolder(result.target, result.slug ? 'checkout' : 'local');
      if (registered.status !== 200) {
        const { body } = registered;
        const error = 'error' in body && body.error ? body.error : 'could not register the new project';
        return c.json({ error: `${error} (the project is at ${result.target})` }, registered.status);
      }
      // `new_local` / `new_github` / `new_template`, beside the folder and clone flows' labels.
      return c.json(registered.body, 200);
    });

  // Register an existing folder (multi-project spec, "Add project" — the
  // folder-browser dialog's commit step, step 4.2). Workspace-level like its
  // GET twin. Everything here is a guard; the registry write itself is one
  // idempotent `registerProject` call.
  const registerProjectSchema = z.object({
    root: z.string().trim().min(1).max(4096),
  });

  /**
   * The register-a-folder half of `POST /api/projects`, factored out so the
   * checkout route (step 4.3) commits its fresh clone through the SAME guards
   * and the same `project-added` emission rather than a second copy of them.
   * Returns the status + body for the caller to answer with.
   */
  const registerFolder = async (
    spelled: string,
    source: 'local' | 'checkout',
  ): Promise<
    // Discriminated on `status`, not one object with a union `body`: a flat
    // `{ status: 200 | 400 | 409 | 500; body: RegisterProjectResponse | { error } }` made
    // `c.json(body, status)` type the route's 200 as carrying the ERROR bodies too, which is a
    // shape neither POST route can answer with (`contract-parity.workspace.test.ts` pins it).
    // Split here so the success branch narrows at the call site instead.
    | { status: 200; body: RegisterProjectResponse }
    | { status: 400 | 409 | 500; body: RegisterProjectResponse | { error: string } }
  > => {
    if (capabilities().singleProject) {
      return { status: 409, body: singleProjectRefusal('adding projects') };
    }
    // `~` is expanded for the same reason `/api/fs/browse` expands it: the
    // dialog hands back absolute paths, but a hand-written body (curl, a
    // future CLI) spells home the way a shell does.
    const requested = expandTilde(spelled);
    if (!isAbsolutePath(requested)) {
      return {
        status: 400,
        body: { error: `not a folder: ${spelled} is not an absolute path` },
      };
    }
    // Hosted mode: the same root the picker is narrowed to, re-checked — see
    // `isInsideBrowseRoot`. Local mode deliberately has NO containment: a
    // project under `/srv/code` is a normal local setup and `onni serve`
    // registers it today.
    //
    // Containment is asked in two halves, around the stat, and the split is
    // deliberate.
    //
    // The LEXICAL half runs BEFORE the stat, and that order is the security
    // property: an out-of-root path must answer the SAME way whether or not it
    // exists, or the route becomes the existence oracle fs-browse narrows the
    // tree to prevent. Lexical, not realpath, because a realpath check answers
    // `false` for a path that IS inside the root and merely absent — which
    // would tell a hosted user who typo'd a folder under their own checkout
    // root that it is "outside the browsable root".
    const hostedBrowseRoot = capabilities().localHandoff
      ? null
      : resolveBrowseRoot(await workspaceBrowseRoot());
    if (hostedBrowseRoot !== null) {
      if (!(await isLexicallyInsideBrowseRoot(hostedBrowseRoot, requested))) {
        // No resolved path in the message (fs-browse's rule): saying where the
        // root is would hand a remote viewer the layout the narrowing hides.
        return {
          status: 400,
          body: { error: 'folder is outside the browsable root' },
        };
      }
    }
    // Existence is checked HERE rather than left to `registerProject` (which
    // degrades a failed realpath to a plain resolve): a registry full of
    // `missing` rows the user never had is worse than a 400 they can act on.
    const info = await stat(requested).catch(() => null);
    if (!info?.isDirectory()) return { status: 400, body: { error: `no such folder: ${spelled}` } };
    // The REALPATH half, now that the path is known to exist: a symlink inside
    // the root pointing out of it spells as contained and is not. Same message
    // as the lexical rejection, so the two halves stay indistinguishable from
    // outside.
    if (hostedBrowseRoot !== null && !(await isInsideBrowseRoot(hostedBrowseRoot, requested))) {
      return {
        status: 400,
        body: { error: 'folder is outside the browsable root' },
      };
    }
    // The boot-time auto-registration guard, applied to the manual gesture
    // too: `$HOME` and onni's own task worktrees are exactly as wrong a
    // project root when a human clicks "Add project" as when `onni serve`
    // would have registered them. Reachable from the dialog, which starts at
    // `~` and can add the folder it is showing.
    if (!(await shouldRegisterProject(requested))) {
      return {
        status: 400,
        body: {
          error: `not a project folder: ${spelled} is your home directory or a onni task worktree`,
        },
      };
    }
    // Asked BEFORE the write, because `registerProject` is idempotent and
    // cannot tell us afterwards whether it appended or just bumped
    // `lastOpenedAt`. Same realpath key the registry dedupes on.
    const real = await realpath(requested).catch(() => requested);
    let known = false;
    try {
      known = (await loadWorkspaceConfig()).projects.some((p) => p.root === real);
    } catch {
      // unreadable workspace — treat as unknown; the write below will fail loudly
    }
    // The boot project's id is reserved even when the registry does not hold
    // it: an unregistered boot folder is still being served under that slug,
    // so letting a same-basename folder take it would point a live URL at the
    // wrong repo. Reserved against OTHER roots only — adding the boot folder
    // itself is the one registration that should get exactly that slug.
    const bootReal = await realpath(bootRoot).catch(() => bootRoot);
    const reserved = real === bootReal ? [] : [await resolveBootProject()];
    let project: ProjectListEntry;
    try {
      const entry = await registerProject(requested, source, reserved);
      project = { ...entry, ...(await probeProjectStatus(entry.root)) };
    } catch (err) {
      // e.g. a read-only home — nothing was persisted (atomic tmp+rename).
      return {
        status: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
    if (known) {
      // 409 with the EXISTING entry (spec): the dialog treats it as "you
      // already have this one" and navigates there rather than dead-ending.
      return {
        status: 409,
        body: { project, error: `already registered as ${project.id}` },
      };
    }
    // Only a genuinely new project is an event — a re-add is a no-op for every
    // open cockpit's sidebar.
    workspaceEvents.emit('project-added', { project });
    return { status: 200, body: { project } };
  };

  // Deregister a project (multi-project spec, step 4.4 — Settings → Projects,
  // the per-row "Remove"). READ THIS BEFORE TOUCHING THE HANDLER: the ONLY
  // durable effect allowed here is dropping one entry from
  // `~/.onni/config.json`. There is deliberately no `rm`, no `rmdir`, no
  // `RunStore.open` (which would `mkdir` `<root>/.ai/onni/runs` and therefore
  // WRITE into a folder the user just asked us to forget) anywhere below —
  // `removeProject` is a registry filter and `contexts.dispose` only tears down
  // in-process handles. Re-registering the same root later finds every task,
  // worktree and transcript exactly where it was. The confirmation copy in the
  // cockpit promises precisely this; the promise is kept here.
  //
  // A run this server is responsible for blocks the removal with a 409 (spec):
  // deregistering mid-run would strand a live agent process under a root no
  // route can resolve any more — the run would keep burning tokens with no
  // cockpit able to show, message or cancel it.
  const ACTIVE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(['queued', 'running', 'waiting']);

  /**
   * How many of `projectId`'s runs this process is actively responsible for.
   *
   * Counted from the ALREADY-BUILT context only (`peek`, never `context()`):
   * a project with no context in this process has no manager, therefore no
   * agent to strand — and building one to answer the question would recover
   * and resume runs on a project being deleted, which is the exact opposite of
   * what the caller asked for. Reading the run index off disk instead was
   * rejected for the same reason as the `rm` above: `RunStore.open` creates
   * directories, and a stale `running` row left by a crashed process would
   * become a 409 the user could never clear.
   */
  const activeRunCount = (projectId: string): number => {
    const ctx = contexts.peek(projectId);
    if (!ctx) return 0;
    return ctx.store.listRuns().filter((run) => ACTIVE_RUN_STATUSES.has(run.status)).length;
  };

  return projectsRoutes;
}
