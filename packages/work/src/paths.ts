import { homedir } from 'node:os';
import { dirname, join, posix, sep, win32 } from 'node:path';
import type { AgentHomePaths } from './agent-config/catalog.ts';

/**
 * Per-user onni home. Literal `~/.onni` on every platform (no XDG, no
 * `%LOCALAPPDATA%` branch) — one rule, and it matches how the existing cache
 * path already behaves (`skills-remote.ts` hardcodes `~/.cache/onni`).
 *
 * `CEZ_HOME` overrides the base so tests (and containers) never touch a real
 * home dir. This is the first shared home-path helper in the repo; two other
 * 2026-07-16 specs (multi-project-switcher, agent-config-files) extend it —
 * first writer owns the file, later specs import it. Do not duplicate this
 * homedir logic elsewhere.
 */
export function onniHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  // `|| undefined` so an EMPTY CEZ_HOME (e.g. `CEZ_HOME= onni …`) falls back
  // to the default instead of yielding relative paths in the cwd.
  return (env.CEZ_HOME || undefined) ?? join(homedir(), '.onni');
}

/**
 * The last line of defence for the developer's own `~/.onni` while the suite
 * runs. Every workspace test pins `CEZ_HOME` to a temp dir, but the pin lives
 * in `process.env` — a single global for the whole worker. A test that ends
 * before its write does (a timeout is enough) has its `afterEach` drop the pin
 * while the write is still in flight, and the write then resolves the REAL
 * home and replaces the developer's project registry with the fixture's.
 *
 * So writers into the onni home ask here first: under vitest, a write whose
 * destination is the real `~/.onni` is always a leaked test, never intent —
 * fail it loudly instead of rewriting a file the suite does not own. Outside
 * vitest this is a no-op, and an explicitly pinned `CEZ_HOME` (the temp dir the
 * test meant to use) never matches the real home, so honest tests are unaffected.
 */
export function assertOnniHomeWriteIsSandboxed(path: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!env.VITEST) return;
  const realHome = join(homedir(), '.onni');
  if (path !== realHome && !path.startsWith(realHome + sep)) return;
  throw new Error(
    `[onni] refusing to write ${path} from a test run — CEZ_HOME is not pinned to a sandbox. ` +
      'Pin it (the vitest setup file does this by default) so the suite never touches the real onni home.',
  );
}

/**
 * The default server-install instance id. An install with no `--domain` (the
 * original single-cockpit-per-host flow) is this instance, and it keeps the
 * legacy `~/.onni/server.json` path so existing hosts upgrade in place.
 */
export const DEFAULT_SERVER_INSTANCE = 'default';

/**
 * Turn a public domain into a stable, filesystem- and systemd-safe instance
 * slug — the key that lets one host run several independent cockpits, each for
 * a different domain (nginx site `onni-<slug>`, unit `onni-<slug>.service`,
 * state file `server-instances/<slug>.json`). Lowercased; every run of
 * non-`[a-z0-9]` becomes a single `-`; leading/trailing `-` trimmed. A `.` in a
 * systemd unit name is a type separator, so dots collapse to `-` too. Returns
 * `default` for empty/degenerate input so a bad value can never escape the
 * instance namespace.
 */
export function instanceSlug(domain: string | undefined | null): string {
  const slug = String(domain ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || DEFAULT_SERVER_INSTANCE;
}

/** The directory holding per-domain (named) server-install state files. */
export function serverInstancesDir(): string {
  return join(onniHomeDir(), 'server-instances');
}

/**
 * Host-level record written by `server-install` (spec 2026-07-16-server-installer).
 * The `default` instance keeps the original `~/.onni/server.json`; a named
 * (domain-keyed) instance lives at `~/.onni/server-instances/<slug>.json`, so
 * a second install for a different domain never resumes or clobbers the first.
 * Distinct from the per-user project registry the multi-project workspace keeps
 * inside `~/.onni/config.json` (see `workspaceConfigPath`) — they coexist.
 */
export function serverStatePath(instance: string = DEFAULT_SERVER_INSTANCE): string {
  if (instance === DEFAULT_SERVER_INSTANCE) return join(onniHomeDir(), 'server.json');
  return join(serverInstancesDir(), `${instance}.json`);
}

/**
 * Per-user workspace config (spec 2026-07-20-multi-project-workspace): schema
 * version, global defaults, and the project registry — every repo onni has
 * been booted in. Lives directly under `onniHomeDir()`, so the `CEZ_HOME`
 * override applies (tests/containers never touch a real home dir).
 */
export function workspaceConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(onniHomeDir(env), 'config.json');
}

/**
 * Global GUI state — the workspace twin of the per-repo
 * `.ai/onni/ui-state.json`. Cross-project UI prefs live here; per-project
 * state (pinned runs, templates) stays in each repo's file.
 */
export function workspaceUiStatePath(): string {
  return join(onniHomeDir(), 'ui-state.json');
}

/**
 * Agent accounts — extra config dirs for a second login of the same agent CLI, plus which one
 * each project uses (spec `2026-07-29-agent-profiles.md`).
 *
 * Its OWN file rather than a key in `config.json`, and that is the whole point: a onni version
 * that has never heard of accounts does not open this file, so it cannot drop them. Living in
 * `config.json` made their survival depend on a `.passthrough()` in *another version's* source —
 * a guarantee this repo cannot make on behalf of a build the user might switch to, and one that
 * evaporates entirely the moment any version fails to parse that file and degrades to defaults
 * (the next merge-write then rewrites it without them).
 *
 * The per-project selections live here too, beside the accounts they name, so deleting an account
 * and scrubbing every reference to it stays ONE atomic write.
 */
export function agentAccountsPath(): string {
  return join(onniHomeDir(), 'agent-accounts.json');
}

/**
 * Expand a leading `~` to the user's home. Lives here with the other homedir
 * logic (see the module note above — one place owns `homedir()`): the
 * workspace browse/checkout roots are stored as the user wrote them (a literal `~`), so
 * every consumer that must touch the REAL directory — the writability probe on
 * `PUT /api/workspace/config`, the browse root in
 * `src/server/fs-browse.ts` — expands it through this one helper.
 */
export function expandTilde(path: string): string {
  if (path === '~') return homedir();
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

/**
 * Is `path` absolute on `platform`? The ONE absolute-path rule for every
 * filesystem path onni accepts or persists — project roots, browse/checkout
 * roots, account dirs. Never a leading-`/` test: that refuses every native
 * Windows path (`C:\projects\app`, `\\server\share\repo`), and because the
 * project registry salvages per entry, a refused root does not error — the
 * project silently vanishes on the next read while `registerProject`, which
 * writes the platform's own `realpath()`, keeps putting it back.
 *
 * `platform` is a parameter so both answers stay testable from either OS.
 */
export function isAbsolutePath(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return (platform === 'win32' ? win32 : posix).isAbsolute(path);
}

/**
 * Single-writer lock the installer/uninstaller hold for a whole run. Per
 * instance, so installing/uninstalling one cockpit never blocks work on another
 * on the same host. The host-level installer is not concurrency-safe with
 * itself *for the same instance*.
 */
export function serverLockPath(instance: string = DEFAULT_SERVER_INSTANCE): string {
  if (instance === DEFAULT_SERVER_INSTANCE) return join(onniHomeDir(), 'server.install.lock');
  return join(serverInstancesDir(), `${instance}.install.lock`);
}

/**
 * Where each coding agent keeps its per-user config, honouring the env vars the
 * vendors document: `$CLAUDE_CONFIG_DIR` relocates Claude Code's home;
 * `$CODEX_HOME` relocates Codex's; `$CURSOR_CONFIG_DIR` relocates Cursor Agent's
 * home (default `~/.cursor`); `$XDG_CONFIG_HOME` relocates OpenCode's config
 * dir (falling back to `~/.config`). Read per call so tests and ops can set env live.
 *
 * These are the DEFAULT profile's dirs. A second login of the same CLI is an
 * agent profile (`src/core/agent-profiles.ts`) and resolves through
 * `agentHomePathsForProfiles` instead — what this function answers is what the
 * host is configured for when nothing overrides it.
 */
export function agentHomePaths(env: NodeJS.ProcessEnv = process.env): AgentHomePaths {
  const home = env.HOME || env.USERPROFILE || homedir();
  const xdgConfig = env.XDG_CONFIG_HOME?.trim() || join(home, '.config');
  return {
    claude: env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'),
    codex: env.CODEX_HOME?.trim() || join(home, '.codex'),
    opencodeConfig: join(xdgConfig, 'opencode'),
    cursor: env.CURSOR_CONFIG_DIR?.trim() || join(home, '.cursor'),
    copilot: env.COPILOT_HOME?.trim() || join(home, '.copilot'),
    junie: join(home, '.junie'),
  };
}

/**
 * Where Claude Code keeps `.claude.json` — its MCP/state file — for a given config dir. The
 * location is NOT uniform: by default the file is a SIBLING of `~/.claude`, but under a
 * `CLAUDE_CONFIG_DIR` override it moves INSIDE the overridden dir (verified against the shipped CLI
 * 2026-07-29, and against a real second-account dir on disk). Reading it from `dirname(configDir)`
 * unconditionally — as this repo did — lands on `~/.claude.json` for a `~/.claude-klaudiusz`
 * profile, i.e. the wrong account's file.
 *
 * The condition below reads like two heuristics OR-ed together; it is one exact rule. The file sits
 * inside precisely when the CLI will SEE `CLAUDE_CONFIG_DIR` for this dir, and onni knows when
 * that is:
 *
 *   - a stored account is always spawned with it (`profileEnv`), and its dir is by construction not
 *     `~/.claude` — the route refuses a dir that is already the discovered account's;
 *   - the DISCOVERED account is spawned with nothing added, so it sees the variable only when the
 *     onni process itself carries one — and it does reach the child, because `CLAUDE_` is in
 *     `BACKEND_ALLOW_PREFIXES`.
 *
 * One case is worth naming because it looks like a bug and is not. Start onni with
 * `CLAUDE_CONFIG_DIR=/opt/work` and add `~/.claude` as a NAMED account (legal — the discovered
 * account is `/opt/work`, so `~/.claude` is not a duplicate). This answers `~/.claude/.claude.json`,
 * not the sibling `~/.claude.json`, and "Show details" can therefore say "not signed in" for a
 * folder a bare `claude` would treat as signed in. That is correct rather than unfortunate: onni
 * will run that account as `CLAUDE_CONFIG_DIR=~/.claude claude`, and under that invocation the
 * state file the CLI reads and writes IS the one inside. Reporting the sibling would describe a
 * login this account will never use.
 */
export function claudeStateFilePath(claudeHome: string, env: NodeJS.ProcessEnv = process.env): string {
  const seesOverride = (env.CLAUDE_CONFIG_DIR?.trim() || '') !== ''
    || claudeHome !== join(env.HOME || env.USERPROFILE || homedir(), '.claude');
  return seesOverride ? join(claudeHome, '.claude.json') : join(dirname(claudeHome), '.claude.json');
}
