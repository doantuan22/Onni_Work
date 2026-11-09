import { lstat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Capabilities } from '@onni/contract';
import { PROVIDER_IDS, type ProviderAuthService, type ProviderId, type ProviderStatusResponse } from '../../core/provider-auth.ts';
import { agentCliRunner, detectOpenTargets, openInApp, openFileInDefaultApp } from '../open-in-app.ts';
import { agentAccountsEnabled } from '../capabilities.ts';
import { agentHomePaths, expandTilde } from '../../paths.ts';
import { allocateProjectSlug } from '../../workspace/projects.ts';
import {
  CONTROL_CHARS_RE,
  DEFAULT_AGENT_ACCOUNT_ID,
  defaultAgentAccountStore,
  isAbsoluteConfigDir,
  loadAgentAccounts,
  mergeWriteAgentAccounts,
  type AgentAccount,
  type AgentAccountStore,
} from '../../workspace/agent-accounts.ts';
import {
  defaultAgentProfile,
  listAgentProfiles,
  profileDirState,
  resolveStoredProfile,
  sameProfileDir,
  type ResolvedAgentProfile,
} from '../../workspace/agent-profiles.ts';
import { PROFILE_CAPABLE_PROVIDERS, supportsProfiles } from '../../core/agent-profiles.ts';
import { isInsideBrowseRoot, isLexicallyInsideBrowseRoot, resolveBrowseRoot } from '../fs-browse.ts';
import { readAccountIdentity } from '../../agent-config/account-identity.ts';
import { listConfigFiles, type AgentHomePaths } from '../../agent-config/catalog.ts';
import { statConfigPath } from '../../agent-config/files.ts';
import { jsonZodValidator, paramZodValidator, queryZodValidator } from '../validators.ts';
import { hostedProfileRefusal, providerParamSchema } from './providers.ts';
import type { ProjectContext } from '../project-context.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

/** Agent-account bodies (spec 2026-07-29-agent-profiles). Bounds mirror `agentProfileSchema` in
 *  src/workspace/config.ts exactly, so a value these accept can never be degraded away by the
 *  next load's `.catch`. The id is allocated server-side and is never a request field. */
const createAgentProfileSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  label: z.string().trim().max(200).optional(),
  configDir: z.string().trim().min(1).max(4096),
}).strict();

/** `POST …/agent-profiles/:id/open` — a catalog id (or `folder`) plus an optional open target. */
const openAgentAccountFileSchema = z.object({
  file: z.string().min(1).max(200),
  target: z.string().min(1).max(64).optional(),
}).strict();

const updateAgentProfileSchema = z.object({
  label: z.string().trim().max(200).optional(),
  configDir: z.string().trim().min(1).max(4096).optional(),
}).strict().refine(
  (value) => value.label !== undefined || value.configDir !== undefined,
  'send label or configDir',
);

/** `PUT …/agent-profiles/selection` — which account a project uses for one provider. `null`
 *  clears it back to the discovered account. */
const selectAgentProfileSchema = z.object({
  /** `null` targets the machine-wide default rather than one repo. */
  projectId: z.string().min(1).max(64).nullable(),
  provider: z.enum(PROVIDER_IDS),
  profileId: z.string().max(64).nullable(),
}).strict();

const hostedProfileOpenRefusal = {
  error: 'opening account files is disabled in hosted mode; open them directly on the machine hosting onni',
};


/**
 * Allocate a profile id from the label (or, with no label, the folder name).
 *
 * Reuses the project allocator's shape, and deliberately its reserved set too: `default` is the
 * discovered profile here exactly as it is the boot alias there, so a folder called `default/`
 * becomes `default-2` and can never shadow it.
 */
function allocateAgentProfileId(source: string, taken: Iterable<string>): string {
  // `allocateProjectSlug` already basenames its argument and enforces the shared
  // `^[a-z0-9][a-z0-9-]{0,63}$` shape, so `~/.claude-klaudiusz` slugs to `claude-klaudiusz`.
  return allocateProjectSlug(source, taken);
}


const queryValue = z.union([z.string(), z.array(z.string()).transform((v) => v[0] as string)]).optional();

type AgentProfilesRouteDeps = {
  providerAuth: ProviderAuthService;
  providerStatus: (options?: { refresh?: boolean }) => Promise<ProviderStatusResponse>;
  capabilities: () => Capabilities;
  bindHost: string | undefined;
  workspaceBrowseRoot: () => Promise<string>;
  bootRoot: string;
  resolveWorkspaceProfile: (provider: ProviderId, profileId?: string) => Promise<{ profile: ResolvedAgentProfile } | { error: string }>;
  projectRootFor: (projectId: string) => Promise<string | null>;
  openFile: typeof openFileInDefaultApp;
  openApp: typeof openInApp;
};

export function agentProfilesRoutes(deps: AgentProfilesRouteDeps) {
  const {
    providerAuth,
    providerStatus,
    capabilities,
    bindHost,
    workspaceBrowseRoot,
    bootRoot,
    resolveWorkspaceProfile,
    projectRootFor,
    openFile,
    openApp,
  } = deps;

  // ---- chained family: agent profiles / accounts (workspace-level) ----------
  // Extra config dirs for a SECOND login of the same agent CLI (spec
  // 2026-07-29-agent-profiles). Workspace-level and therefore SINGLE-MOUNT: an account belongs to
  // the person and the machine, never to a repo, and a project-scoped spelling would be a second
  // surface to protect with no consumer. Which account a project uses is a field on
  // `PATCH /api/v1/projects/:projectId` instead.
  //
  // Remote access is explicitly opt-in: a profile points an agent at a directory on the host, and
  // the listing echoes absolute paths carrying the username. `ONNI_REMOTE_AGENT_ACCOUNTS=1` says
  // the operator has placed the remote cockpit behind an authenticated perimeter. Desktop-open
  // actions remain local-only regardless of that flag.

  /**
   * This agent's own USER-scope config files, resolved inside ONE account's folder.
   *
   * Straight from the catalog — the single home of config-file vendor knowledge — with an
   * `AgentHomePaths` whose slot for this provider is the account's dir. That is what makes a second
   * login's `settings.json` the file you open rather than the default account's, and it keeps the
   * ids opaque and stable so the open route below never takes a path from the client.
   */
  const accountFiles = async (profile: ResolvedAgentProfile) => {
    const home: AgentHomePaths = {
      ...agentHomePaths(),
      ...(profile.provider === 'claude' ? { claude: profile.path } : {}),
      ...(profile.provider === 'codex' ? { codex: profile.path } : {}),
      ...(profile.provider === 'opencode' ? { opencodeConfig: profile.path } : {}),
      ...(profile.provider === 'cursor' ? { cursor: profile.path } : {}),
    };
    const defs = listConfigFiles().filter(
      (def) => def.scope === 'user' && def.runners.includes(profile.provider),
    );
    return Promise.all(
      defs.map(async (def) => {
        const path = def.resolve(bootRoot, home);
        return { id: def.id, label: basename(path), path, exists: (await statConfigPath(path)).exists };
      }),
    );
  };

  /** Build the wire row for one resolved profile: its dir state plus whatever auth is cached. */
  const agentProfileBody = async (profile: ResolvedAgentProfile) => ({
    id: profile.id,
    provider: profile.provider,
    label: profile.label,
    configDir: profile.configDir,
    path: profile.path,
    ...(await profileDirState(profile.provider, profile.path)),
    isDefault: profile.isDefault,
    // CACHED auth only — this listing must never pay a CLI spawn.
    //
    // Probing here cost a shell-out per provider PLUS one per extra account: ~0.7s with no extra
    // accounts and over 2s with a few, on every cold load, for a route whose real job (what
    // accounts exist) is a JSON read and a handful of stats. `GET /api/v1/health` already
    // established the rule — it serves whatever the cache holds and never pays a `gh` shell-out.
    // An absent `status` means "not determined yet", which the cockpit renders as Checking… and
    // then fills in from the per-account status route below.
    //
    // SPREAD, not `status: maybeUndefined`: hono would type the key as always-present while
    // `JSON.stringify` drops it, which is exactly the drift `contract-parity` catches (AGENTS.md
    // names this as one of the two recurring mismatches).
    ...(() => {
      const cached = profile.isDefault
        ? providerAuth.peekStatus()?.providers.find((row) => row.provider === profile.provider)
        : providerAuth.peekProfileStatus(profile.provider, profile.id);
      return cached ? { status: cached } : {};
    })(),
    files: await accountFiles(profile),
  });

  /**
   * Resolve `:id` to an account for the per-account reads below. Unlike `resolveWorkspaceProfile`
   * this accepts the reserved `default` for a NAMED provider, which these routes cannot infer — so
   * the id may be `default:<provider>` as well as a stored account id.
   */
  const accountById = async (id: string): Promise<ResolvedAgentProfile | null> => {
    const [head, tail] = id.split(':');
    if (head === DEFAULT_AGENT_ACCOUNT_ID) {
      const provider = PROVIDER_IDS.find((p) => p === tail);
      return provider ? defaultAgentProfile(provider) : null;
    }
    try {
      const stored = (await loadAgentAccounts()).accounts.find((a) => a.id === id);
      return stored ? resolveStoredProfile(stored) : null;
    } catch {
      return null;
    }
  };

  /** Validate a client-supplied config dir. Returns the error text, or null when it is usable. */
  const checkProfileDir = async (configDir: string): Promise<string | null> => {
    if (CONTROL_CHARS_RE.test(configDir)) return 'folder must not contain control characters';
    const expanded = expandTilde(configDir);
    // Absolute after expansion: a relative dir would resolve against whatever cwd the agent
    // happens to be spawned in, which for a task is a throwaway worktree. Through
    // `isAbsoluteConfigDir`, never a leading-`/` test — see its note: a string test refuses every
    // real Windows path, and this is the only gate the Add-account dialog has.
    if (!isAbsoluteConfigDir(expanded)) return `folder must be an absolute path: ${configDir}`;
    // A remote caller may only name paths inside the same root exposed by the folder browser.
    // Containment is asked in two halves, exactly as `POST /api/projects` asks it, and the order
    // is the security property.
    if (!capabilities().localHandoff) {
      const root = resolveBrowseRoot(await workspaceBrowseRoot());
      // No resolved path in the message (fs-browse's rule, and the same string both halves
      // return): saying where the root is would hand a remote viewer the layout the narrowing
      // hides, and two distinguishable rejections would be a shape to probe with.
      const outside = 'folder is outside the browsable root';
      // The LEXICAL half, before the candidate is touched: an out-of-root SPELLING is refused
      // whether or not it is there, so the route never becomes an existence oracle. Lexical
      // rather than realpath, because an account folder is allowed not to exist yet — Connect is
      // what creates it — and a realpath check would tell someone who typo'd a folder under
      // their own home that it is "outside the browsable root".
      if (!(await isLexicallyInsideBrowseRoot(root, expanded))) return outside;
      // Resolve the nearest existing entry, including dangling symlinks. Checking only the
      // leaf would let a new folder beneath an escaping symlink pass. Only ENOENT permits
      // walking upwards; unreadable paths fail closed, with the same refusal.
      let ancestor = expanded;
      for (;;) {
        try {
          await lstat(ancestor);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return outside;
          const parent = dirname(ancestor);
          if (parent === ancestor) return outside;
          ancestor = parent;
        }
      }
      if (!(await isInsideBrowseRoot(root, ancestor))) return outside;
    }
    return null;
  };

  /** Refuse a dir that is already some other account's (or the default's), compared through
   *  `realpath` — two spellings of one directory would be two accounts silently sharing one
   *  session store, and "which one am I logged into?" would stop having an answer. */
  const conflictingProfile = async (
    profiles: readonly AgentAccount[],
    provider: ProviderId,
    path: string,
    exceptId?: string,
  ): Promise<string | null> => {
    if (await sameProfileDir(path, defaultAgentProfile(provider).path)) {
      return 'that is already this agent\'s default folder';
    }
    for (const candidate of profiles) {
      if (candidate.provider !== provider || candidate.id === exceptId) continue;
      if (await sameProfileDir(path, expandTilde(candidate.configDir))) {
        return `that folder is already used by "${candidate.label || candidate.id}"`;
      }
    }
    return null;
  };

  return new Hono<ProjectApiEnv>()
    .get('/workspace/agent-profiles', async (c) => {
      const editable = agentAccountsEnabled(process.env, bindHost);
      // Hosted mode without the explicit permission withholds the listing entirely rather than
      // serving it read-only: the paths are the host disclosure, so an empty list is the only
      // honest answer.
      //
      // ONE body object, never a hosted `return` and a local `return`: two returns let hono
      // narrow `editable` to the literal `false`/`true` of each branch, and the contract's
      // honest `z.boolean()` then reads as wider than the route. Same shape as
      // `listAgentConfig`, which carries the same flag for the same reason.
      let store = defaultAgentAccountStore();
      if (editable) {
        try {
          store = await loadAgentAccounts();
        } catch {
          // an unreadable home degrades to "no extra accounts", never a failed request
        }
      }
      const profiles = editable
        ? await Promise.all(listAgentProfiles(store, PROVIDER_IDS).map(agentProfileBody))
        : [];
      return c.json({
        editable,
        profiles,
        profileCapableProviders: [...PROFILE_CAPABLE_PROVIDERS],
        // Which account each project uses, keyed by repo root. Served here rather than on the
        // project registry because it lives in the same file as the accounts it names.
        selections: editable ? store.selections : {},
        /** The machine-wide fallback, for repos that have chosen nothing. Withheld in hosted mode
         *  on the same terms as the rest of this family. */
        defaults: editable ? store.defaults : {},
      });
    })

    .post('/workspace/agent-profiles', jsonZodValidator(() => createAgentProfileSchema), async (c) => {
      if (!agentAccountsEnabled(process.env, bindHost)) return c.json(hostedProfileRefusal, 409);
      const { provider, configDir, label } = c.req.valid('json');
      if (!supportsProfiles(provider)) {
        return c.json({ error: `${provider} cannot carry more than one account` }, 400);
      }
      const dirError = await checkProfileDir(configDir);
      if (dirError) return c.json({ error: dirError }, 400);

      // Read-first, exactly like `POST /projects`: the duplicate check needs `realpath`, and the
      // merge-write mutator is deliberately SYNCHRONOUS so the read→rename window stays as small
      // as it is for every other writer of this file. Two processes adding the same folder in
      // that window would both win — a cosmetic duplicate, not a correctness problem, since the
      // schema's id dedupe is what keeps resolution deterministic.
      let existing: readonly AgentAccount[] = [];
      try {
        existing = (await loadAgentAccounts()).accounts;
      } catch {
        // unreadable store — the merge-write below reports the real failure
      }
      const conflict = await conflictingProfile(existing, provider, expandTilde(configDir));
      if (conflict !== null) return c.json({ error: conflict }, 409);

      let created: AgentAccount | undefined;
      try {
        await mergeWriteAgentAccounts((store) => {
          const id = allocateAgentProfileId(label ?? configDir, store.accounts.map((a) => a.id));
          created = {
            id,
            provider,
            configDir,
            label: label?.trim() || id,
            addedAt: new Date().toISOString(),
          };
          store.accounts.push(created);
        });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
      if (!created) return c.json({ error: 'account could not be saved' }, 500);
      // A brand-new account is the one thing the boot warm could not have known about, so learn it
      // now rather than only when something asks. Still off the response: the row is returned with
      // `status` absent (the listing's rule), the pane shows Checking…, and its follow-up request
      // joins this same in-flight probe.
      const account = resolveStoredProfile(created);
      const created201 = await agentProfileBody(account);
      void providerAuth
        .profileStatus(account.provider, { id: account.id, configDir: account.path })
        .catch(() => {});
      return c.json({ profile: created201 }, 201);
    })

    .patch(
      '/workspace/agent-profiles/:id',
      paramZodValidator(z.object({ id: z.string() })),
      jsonZodValidator(() => updateAgentProfileSchema),
      async (c) => {
        if (!agentAccountsEnabled(process.env, bindHost)) return c.json(hostedProfileRefusal, 409);
        const id = c.req.param('id');
        const { label, configDir } = c.req.valid('json');
        if (configDir !== undefined) {
          const dirError = await checkProfileDir(configDir);
          if (dirError) return c.json({ error: dirError }, 400);
        }

        // Read-first (see POST above, and `PATCH /projects`): a well-formed but unknown id must
        // 404 WITHOUT rewriting the config, and the duplicate check needs async `realpath`.
        let existing: readonly AgentAccount[] = [];
        try {
          existing = (await loadAgentAccounts()).accounts;
        } catch {
          // unreadable store — treated as unknown, like DELETE and PATCH /projects
        }
        const current = existing.find((a) => a.id === id);
        if (!current) return c.json({ error: `unknown account: ${id}` }, 404);
        if (configDir !== undefined) {
          const conflict = await conflictingProfile(existing, current.provider, expandTilde(configDir), id);
          if (conflict !== null) return c.json({ error: conflict }, 409);
        }

        let updated: AgentAccount | undefined;
        try {
          await mergeWriteAgentAccounts((store) => {
            const entry = store.accounts.find((a) => a.id === id);
            if (!entry) return; // lost a race with a concurrent delete — answered below
            // Mutated in place so `.passthrough()` keys on the row survive.
            if (label !== undefined) entry.label = label.trim() || entry.id;
            if (configDir !== undefined) entry.configDir = configDir;
            updated = entry;
          });
        } catch (err) {
          return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
        if (!updated) return c.json({ error: `unknown account: ${id}` }, 404);
        // The dir may have moved under a cached probe — drop THIS account's answer so the response
        // reports the new folder's state rather than the old one's, and leave every other account's
        // warm answer alone (it is still true). Then re-learn it in the background, so the server's
        // knowledge is complete again whether or not a cockpit is open to ask; the pane's own
        // request for this row joins the same in-flight probe rather than spawning a second.
        const repointed = resolveStoredProfile(updated);
        providerAuth.forgetProfileStatus(repointed.provider, repointed.id);
        const body = await agentProfileBody(repointed);
        void providerAuth
          .profileStatus(repointed.provider, { id: repointed.id, configDir: repointed.path })
          .catch(() => {});
        return c.json({ profile: body });
      },
    )

    /**
     * One account's authentication state, probed for real.
     *
     * Separate from the listing because a probe shells out to an agent CLI: keeping it here lets
     * the pane paint immediately and fill each row in as its answer lands, instead of every cold
     * load blocking on N spawns. `refresh=1` drops this account's cached answer and re-probes, for
     * the "Check again" affordance — the cache itself holds a connected answer for minutes and an
     * unsettled one for a minute (`cacheTtlFor` in `core/provider-auth.ts`).
     */
    .get(
      '/workspace/agent-profiles/:id/status',
      paramZodValidator(z.object({ id: z.string() })),
      queryZodValidator(z.object({
        refresh: queryValue.refine((v) => v === undefined || v === '1'),
        recheck: queryValue.refine((v) => v === undefined || v === '1'),
      }), { message: 'refresh and recheck must be 1 when provided' }),
      async (c) => {
        if (!agentAccountsEnabled(process.env, bindHost)) return c.json(hostedProfileRefusal, 409);
        const account = await accountById(c.req.param('id'));
        if (!account) return c.json({ error: `unknown account: ${c.req.param('id')}` }, 404);
        const query = c.req.valid('query');
        const recheck = query.recheck === '1';
        const refresh = query.refresh === '1' || recheck;
        // The discovered account's row is the one `GET /api/v1/providers/status` owns, so it comes
        // from there — enablement included, which a bare probe does not know about.
        if (account.isDefault) {
          const all = await providerStatus(refresh ? { refresh: true } : undefined);
          const row = all.providers.find((candidate) => candidate.provider === account.provider);
          return c.json({ status: row ?? { provider: account.provider, status: 'unknown' as const } });
        }
        // "Check again" re-probes THIS account only — the other accounts' warm answers are not
        // invalidated by asking about this one. Only `recheck` (the pane's button) may lift a dead
        // login; New task's verify-before-refuse re-probes with `refresh` alone (telemetry 9e4a95db).
        if (refresh) providerAuth.forgetProfileStatus(account.provider, account.id);
        if (recheck) providerAuth.recheckProfileAuthFailure(account.provider, account.id);
        return c.json({
          status: await providerAuth.profileStatus(account.provider, {
            id: account.id,
            configDir: account.path,
          }),
        });
      },
    )

    /**
     * Who this account is signed in AS — the pane's "Show details".
     *
     * A separate, on-demand route rather than a field on the listing, and that is what makes
     * "hidden by default" real: an email carried by the listing would already be in the response,
     * the query cache and devtools, whatever the UI chose to render. `provider-auth.ts` keeps
     * identity out of ITS boundary on purpose; this is the deliberate, local-only, opt-in
     * exception — not a widening of that rule. Never logged, never persisted.
     */
    .get(
      '/workspace/agent-profiles/:id/details',
      paramZodValidator(z.object({ id: z.string() })),
      async (c) => {
        if (!agentAccountsEnabled(process.env, bindHost)) return c.json(hostedProfileRefusal, 409);
        const account = await accountById(c.req.param('id'));
        if (!account) return c.json({ error: `unknown account: ${c.req.param('id')}` }, 404);
        return c.json(await readAccountIdentity(account.provider, account.path));
      },
    )

    /**
     * Open one of this account's own config files — or its folder — in a local app.
     *
     * `file` is a catalog ID from the account's own `files`, never a path: the client cannot name a
     * location, so there is no traversal surface here at all (the same rule
     * `/api/v1/agent-config/:id` follows). `folder` is the one extra keyword, and it resolves to
     * the account's dir rather than anything the caller spelled.
     */
    .post(
      '/workspace/agent-profiles/:id/open',
      paramZodValidator(z.object({ id: z.string() })),
      jsonZodValidator(() => openAgentAccountFileSchema),
      async (c) => {
        if (!capabilities().localHandoff) return c.json(hostedProfileOpenRefusal, 409);
        const account = await accountById(c.req.param('id'));
        if (!account) return c.json({ error: `unknown account: ${c.req.param('id')}` }, 404);
        const { file, target } = c.req.valid('json');

        let path: string;
        if (file === 'folder') {
          path = account.path;
        } else {
          const match = (await accountFiles(account)).find((f) => f.id === file);
          if (!match) return c.json({ error: `unknown file: ${file}` }, 404);
          path = match.path;
        }
        // A file the agent has not written yet has nothing to open; say so rather than hand the OS
        // a missing path and report success.
        if (!(await statConfigPath(path)).exists && file !== 'folder') {
          return c.json({ error: `this account has no ${basename(path)} yet` }, 409);
        }
        // `target` names a detected app; absent means the OS default handler. Either way the PATH
        // came from the catalog, so an editor is only ever pointed inside this account's folder.
        //
        // Which targets APPLY is checked here rather than left to the UI, because two of them are
        // actively wrong rather than merely useless: `terminal` runs `cd <path>`, which fails on a
        // file, and a `cli:<runner>` handoff would start an agent session inside the config folder.
        // A route is a surface of its own; it refuses what it cannot do correctly.
        if (target !== undefined) {
          if (agentCliRunner(target) !== null) {
            return c.json({ error: 'agent CLIs open a task worktree, not a config folder' }, 400);
          }
          if (target === 'terminal' && file !== 'folder') {
            return c.json({ error: 'a terminal opens a folder, not a file' }, 400);
          }
          if (!detectOpenTargets().some((candidate) => candidate.id === target)) {
            return c.json({ error: `no such app on this machine: ${target}` }, 400);
          }
        }
        const opened = target === undefined
          ? await openFile(path)
          : await openApp(target, path);
        if (!opened) return c.json({ error: `could not open ${basename(path)}`, path }, 409);
        return c.json({ opened: true as const, path });
      },
    )

    // Which account a PROJECT uses. On the accounts family rather than `PATCH /api/v1/projects`
    // because the selection is stored beside the accounts it names — one file, one atomic write,
    // and nothing about it can be dropped by a onni version that never heard of accounts.
    .put(
      '/workspace/agent-profiles/selection',
      jsonZodValidator(() => selectAgentProfileSchema),
      async (c) => {
        if (!agentAccountsEnabled(process.env, bindHost)) return c.json(hostedProfileRefusal, 409);
        const { projectId, provider, profileId } = c.req.valid('json');
        // `null` writes the MACHINE-WIDE default instead of one repo's selection: the account any
        // repo that has chosen nothing uses, so a second login is set up once rather than per
        // checkout. No project to resolve, and therefore no 404 path.
        let root: string | null = null;
        if (projectId !== null) {
          // Keyed by repo ROOT, so the selection survives the registry being rebuilt and needs no
          // cross-reference into config.json. An unknown project is a 404 rather than an orphan
          // entry nobody will ever read.
          root = await projectRootFor(projectId);
          if (root === null) return c.json({ error: `unknown project: ${projectId}` }, 404);
        }
        // A user naming an account that does not exist gets told so — the opposite of how RUN
        // resolution treats a dangling stored id, and deliberately: a run has no better answer
        // than the default, a person does.
        if (profileId !== null && profileId !== DEFAULT_AGENT_ACCOUNT_ID) {
          const account = await resolveWorkspaceProfile(provider, profileId);
          if ('error' in account) return c.json({ error: account.error }, 400);
        }
        let store: AgentAccountStore;
        try {
          store = await mergeWriteAgentAccounts((current) => {
            // One rule, two targets: the machine default is the same per-provider shape as a repo's
            // selection, so it clears the same way rather than growing its own spelling.
            const selection = root === null ? current.defaults : current.selections[root] ?? {};
            // `null` and the reserved `default` both mean "back to the discovered account", which
            // is stored as ABSENCE — the default id is never written to the file.
            if (profileId === null || profileId === DEFAULT_AGENT_ACCOUNT_ID) delete selection[provider];
            else selection[provider] = profileId;
            // The machine default keeps an emptied object where a repo selection is deleted, and
            // that asymmetry is the schema's, not an oversight: `defaults` is one FIXED field with
            // `.default(() => ({}))`, so `mergeWriteAgentAccounts` re-materializes it on the next
            // write no matter what this one omits (verified). `selections` is a growing MAP, where
            // an emptied entry is a row per repo ever touched that says nothing. The rule stated
            // for `agentDefaults.models` — "absence is the same answer" — applies there because
            // that key is `.optional()`, so deleting it actually sticks.
            if (root === null) current.defaults = selection;
            else if (Object.keys(selection).length === 0) delete current.selections[root];
            else current.selections[root] = selection;
          });
        } catch (err) {
          return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
        return c.json({ selections: store.selections, defaults: store.defaults });
      },
    )

    .delete(
      '/workspace/agent-profiles/:id',
      paramZodValidator(z.object({ id: z.string() })),
      async (c) => {
        if (!agentAccountsEnabled(process.env, bindHost)) return c.json(hostedProfileRefusal, 409);
        const id = c.req.param('id');
        let removed = false;
        // Captured inside the mutator, because after the write there is nothing left to ask which
        // provider this account belonged to — and the eviction below is keyed by it.
        let removedProvider: ProviderId | undefined;
        try {
          await mergeWriteAgentAccounts((store) => {
            const before = store.accounts.length;
            removedProvider = store.accounts.find((a) => a.id === id)?.provider;
            store.accounts = store.accounts.filter((a) => a.id !== id);
            removed = store.accounts.length < before;
            if (!removed) return;
            // Scrub every reference IN THE SAME MUTATOR — the reason selections share this file.
            // A two-call delete-then-scrub can be observed mid-way by another onni process on
            // this machine, which would then resolve a dangling id; harmless today (it degrades
            // to the default) but only by luck.
            for (const [root, selection] of Object.entries(store.selections)) {
              for (const key of Object.keys(selection) as Array<keyof typeof selection>) {
                if (selection[key] === id) delete selection[key];
              }
              if (Object.keys(selection).length === 0) delete store.selections[root];
            }
          });
        } catch (err) {
          return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
        if (!removed) return c.json({ error: `unknown account: ${id}` }, 404);
        // Only this account's answer: it is about to stop existing, and holding it would let a
        // re-added account with the same id read the deleted one's state — its incident included.
        if (removedProvider) providerAuth.forgetProfile(removedProvider, id);
        else providerAuth.forgetProfileStatus(removedProvider, id);
        return c.json({ removed: true as const, id });
      },
    );

}
