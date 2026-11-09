import { Hono } from 'hono';
import { z } from 'zod';
import type { Capabilities } from '@onni/contract';
import { PROVIDER_IDS, type ProviderAuthService, type ProviderId, type ProviderStatus, type ProviderStatusResponse } from '../../core/provider-auth.ts';
import { applyProviderEnablement } from '../../core/provider-availability.ts';
import { agentAccountsEnabled } from '../capabilities.ts';
import { type ResolvedAgentProfile } from '../../workspace/agent-profiles.ts';
import { DEFAULT_AGENT_ACCOUNT_ID } from '../../workspace/agent-accounts.ts';
import type { WorkspaceConfig } from '../../workspace/config.ts';
import { openInTerminal } from '../open-in-terminal.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator, paramZodValidator, queryZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

export const providerParamSchema = z.enum(PROVIDER_IDS);

const queryValue = z.union([z.string(), z.array(z.string()).transform((v) => v[0] as string)]).optional();
const providerEnabledSchema = z.object({ enabled: z.boolean() }).strict();
const providerRetrySchema = z.object({
  authFailureId: z.string().min(1).max(128),
}).strict();
const providerConnectSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  /** Which agent account to sign in; absent means the discovered default. */
  profileId: z.string().max(64).optional(),
}).strict();

export const hostedProfileRefusal = {
  error: 'agent accounts are disabled in hosted mode; set ONNI_REMOTE_AGENT_ACCOUNTS=1 only behind an authenticated perimeter',
};

type ProviderRouteDeps = {
  providerAuth: ProviderAuthService;
  providerStatus: (options?: { refresh?: boolean }) => Promise<ProviderStatusResponse>;
  workspaceConfig: {
    mergeWrite: (mutate: (config: WorkspaceConfig) => void) => Promise<WorkspaceConfig>;
  };
  workspaceEvents: { emit: (event: 'provider-status', data: ProviderStatus) => void };
  agentAccountsEnabled: typeof agentAccountsEnabled;
  bindHost: string | undefined;
  capabilities: () => Capabilities;
  openTerminal: typeof openInTerminal;
  bootRoot: string;
  resolveWorkspaceProfile: (provider: ProviderId, profileId?: string) => Promise<{ profile: ResolvedAgentProfile } | { error: string }>;
  watchOpenedLogin: (provider: ProviderId, profile: { id: string; isDefault: boolean; path: string | null }) => void;
};

export function providersRoutes(deps: ProviderRouteDeps) {
  return new Hono<ProjectApiEnv>()
    .get(
      '/providers/status',
      queryZodValidator(z.object({ refresh: queryValue.refine((v) => v === undefined || v === '1') }), { message: 'refresh must be 1 when provided' }),
      async (c) => {
        const query = { data: c.req.valid('query') };
        return c.json(await deps.providerStatus({ refresh: query.data.refresh === '1' }));
      },
    )

    .put(
      '/providers/:provider/enabled',
      paramZodValidator(z.object({ provider: providerParamSchema }), { message: 'provider and enabled boolean are required' }),
      jsonZodValidator(providerEnabledSchema, { message: 'provider and enabled boolean are required' }),
      async (c) => {
        const provider = { data: c.req.valid('param').provider };
        const body = { data: c.req.valid('json') };
        let workspace: WorkspaceConfig;
        try {
          workspace = await deps.workspaceConfig.mergeWrite((config) => {
            const disabled = new Set(config.disabledProviders);
            if (body.data.enabled) disabled.delete(provider.data);
            else disabled.add(provider.data);
            config.disabledProviders = PROVIDER_IDS.filter((id) => disabled.has(id));
          });
        } catch {
          return c.json({ error: 'Provider preference could not be saved.' }, 500);
        }
        const result = applyProviderEnablement(
          await deps.providerAuth.status(),
          workspace.disabledProviders,
        );
        const row = result.providers.find(({ provider: id }) => id === provider.data);
        if (row) deps.workspaceEvents.emit('provider-status', row);
        return c.json(result);
      },
    )

    .post(
      '/providers/:provider/retry',
      paramZodValidator(z.object({ provider: providerParamSchema }), { message: 'provider and current authFailureId are required' }),
      jsonZodValidator(providerRetrySchema, { message: 'provider and current authFailureId are required' }),
      async (c) => {
        const provider = { data: c.req.valid('param').provider };
        const body = { data: c.req.valid('json') };
        if (!deps.providerAuth.clearRuntimeAuthFailure(provider.data, body.data.authFailureId)) {
          return c.json({ error: 'Authentication incident changed. Refresh and try again.' }, 409);
        }
        const result = await deps.providerStatus({ refresh: true });
        const row = result.providers.find(({ provider: id }) => id === provider.data);
        if (row) deps.workspaceEvents.emit('provider-status', row);
        return c.json(result);
      },
    )

    .post('/providers/connect', jsonZodValidator(providerConnectSchema, { message: 'provider must be claude, codex, opencode, cursor, pi, or copilot' }), async (c) => {
      const body = { data: c.req.valid('json') };

      const provider = body.data.provider as ProviderId;
      // A NAMED account is refused in hosted mode unless the operator opted in. This happens
      // before resolution, exactly like every sibling route in the agent-profiles family; checking
      // later would already have read `~/.onni/agent-accounts.json`, built a command carrying the
      // account's absolute path (which both the success body and the hosted 409 echo), and — for a
      // stored account — spawned a probe. It would also answer `unknown account: <id>` for a wrong
      // id, which is an enumeration oracle for the very ids the hosted listing withholds. The
      // bare-provider spelling keeps its existing behaviour: it names no host path and is how the
      // Providers card has always worked.
      if (body.data.profileId !== undefined
        && body.data.profileId !== DEFAULT_AGENT_ACCOUNT_ID
        && !deps.agentAccountsEnabled(process.env, deps.bindHost)) {
        return c.json(hostedProfileRefusal, 409);
      }
      // Resolve the account BEFORE anything else: both the command and the status probe below
      // must describe the same one, or the pane reports on the personal login while the terminal
      // signs into the work login.
      const resolved = await deps.resolveWorkspaceProfile(provider, body.data.profileId);
      if ('error' in resolved) return c.json({ error: resolved.error }, 400);
      const { profile } = resolved;
      const command = deps.providerAuth.loginCommand(provider, profile.isDefault ? null : profile.path);
      // Fail closed: a config dir that cannot be embedded safely in this platform's shell has no
      // safe degradation. Running the bare command would sign the user into a DIFFERENT account
      // than the one they clicked, and nothing in the terminal would say so.
      if (command === null) {
        return c.json({ error: `This account's folder cannot be used in a terminal command: ${profile.configDir}` }, 409);
      }
      // BOTH branches must mean "is this account signed in NOW". The default branch refreshes; the
      // account branch has to evict first, because `profileStatus` serves the per-account cache and
      // a connected answer there stands for CONNECTED_TTL_MS. Without this, Connect after a
      // `claude /logout` answers "already connected", opens nothing, and the user is stuck — and it
      // would contradict this module's own invariant that opening a login is one of the things
      // onni CAN observe and therefore invalidates explicitly rather than waiting out a window.
      if (!profile.isDefault) deps.providerAuth.forgetProfileStatus(provider, profile.id);
      const row = profile.isDefault
        ? (await deps.providerAuth.status({ refresh: true })).providers.find(
          (candidate) => candidate.provider === provider,
        )
        : await deps.providerAuth.profileStatus(provider, { id: profile.id, configDir: profile.path });
      if (!row) {
        return c.json({ error: 'Authentication could not be verified. Try again.' }, 500);
      }

      if (row.status === 'connected') {
        return c.json({ opened: false, connected: true, command });
      }
      if (row.status === 'not-installed') {
        return c.json({ error: row.hint ?? deps.providerAuth.installHint(provider), command }, 409);
      }
      // `unknown` (inconclusive output, timeout, unexpected exit) falls through to the login like
      // `disconnected`: the CLI is installed, and its own login is the one surface that can say
      // what is wrong. Refusing here left Connect a dead end that "Try again" re-probed into.
      if (!deps.capabilities().localHandoff) {
        return c.json({ error: 'Run this command on the machine hosting onni.', command }, 409);
      }
      let opened = false;
      try {
        // No `env` argument: `loginCommand` already rendered the account's config dir INTO the
        // command, because this string is also the copy-paste fallback the pane shows. Passing
        // it again here would set the variable twice.
        opened = await deps.openTerminal(deps.bootRoot, command);
      } catch {
        // Terminal handoff is best-effort; the exact command remains the safe fallback.
      }
      if (!opened) {
        return c.json({ error: 'No terminal emulator could be opened. Run this command manually.', command }, 409);
      }
      deps.watchOpenedLogin(provider, { id: profile.id, isDefault: profile.isDefault, path: profile.isDefault ? null : profile.path });
      return c.json({ opened: true, command });
    })

    // Offered next to an "X or newer is required" agent error: hands the CLI's own self-update to
    // a terminal, like Connect hands it the login.
    .post(
      '/providers/:provider/update',
      paramZodValidator(z.object({ provider: providerParamSchema }), { message: 'unknown provider' }),
      async (c) => {
        const provider = c.req.valid('param').provider as ProviderId;
        const command = deps.providerAuth.updateCommand(provider);
        if (command === null) {
          return c.json({ error: 'This agent has no update command of its own. Update it the way you installed it.' }, 409);
        }
        if (!deps.capabilities().localHandoff) {
          return c.json({ error: 'Run this command on the machine hosting onni.', command }, 409);
        }
        let opened = false;
        try {
          opened = await deps.openTerminal(deps.bootRoot, command);
        } catch {
          // Best-effort, as for Connect: the command is the fallback.
        }
        if (!opened) {
          return c.json({ error: 'No terminal emulator could be opened. Run this command manually.', command }, 409);
        }
        return c.json({ opened: true as const, command });
      },
    );
}
