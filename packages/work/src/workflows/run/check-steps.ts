import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ContentBlock } from '../../core/agent-runner.ts';
import { BASH_MISSING_MESSAGE, resolveBash, withBashPath } from '../../core/bash-path.ts';
import { utf8Collector } from '../../core/utf8-chunks.ts';
import { MIN_SECRET_LEN } from '../../core/secret-redaction.ts';
import { prunePrHeadRefs } from '../../automations/pr-head.ts';
import { appendHandoffHeartbeat } from '../../handoff.ts';
import { assertOnniHomeWriteIsSandboxed, onniHomeDir } from '../../paths.ts';
import { spawnTaskProcess } from '../../core/task-process-spawn.ts';
import { worktreeChangedPaths } from '../../git-worktree.ts';
import { PROJECT_ID_RE } from '../../workspace/config.ts';
import type { RunStore } from '../../runs/store.ts';
import type { Skill } from '../../skills.ts';
import type { WorkflowStepDef } from '../types.ts';
import type { CheckActiveRun, CheckContext } from './internal-types.ts';

/**
 * The environment a check step runs with: the server's own, plus the secrets the step may
 * read (spec 2026-10-10-project-secrets-vault-options) — the project's and the workspace's
 * with the `checks` audience, or exactly the step's `secrets:` bindings. Read fresh for every
 * check execution, so an edit applies to the next check, never one mid-command. The values
 * are registered as run secrets BEFORE the spawn, so the first byte of output is already
 * scrubbed; values shorter than the host-secret floor are not, or a flag like `=1` would
 * redact every `1` in the log.
 */
export async function checkStepEnv(
  context: CheckContext,
  runId: string,
  state: CheckActiveRun,
  step: WorkflowStepDef,
  emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
): Promise<NodeJS.ProcessEnv> {
  // A fork's head is untrusted code (Phase 3): like GitHub Actions withholding secrets from fork
  // PRs, its checks get the server env only — the credentials are neither read nor handed over.
  const untrusted = context.store.getRun(runId)?.untrustedHead === true;
  const resolved = untrusted
    ? { values: {} as Record<string, string>, notes: [] as string[] }
    : await context.secrets.resolve(
        context.projectId ? { projectId: context.projectId, root: context.repoRoot } : undefined,
        'checks',
        step.secrets,
      );
  // A store that exists and was not used, or a bound name that is not there, is what the user
  // cannot diagnose alone: the value is write-only, so `onni secrets list` and Settings show
  // the same list whether this run read it or ignored it. Say which, once each, on the step.
  for (const note of resolved.notes) emit({ type: 'note', stepId: step.id, message: note });
  context.store.registerRunSecrets(
    runId,
    Object.values(resolved.values).filter((value) => value.length >= MIN_SECRET_LEN),
  );
  // The run context wins last (Phase 2). Its names are first removed from what the server
  // inherited — a onni started inside another onni task carries that task's `ONNI_*` — so a
  // variable this run does not set is absent, never a stale value from somewhere else. The
  // login shell `runCheckStep` spawns sources the user's profile after this, so the guarantee
  // is about the server's environment, not about a profile that exports one of these names.
  const base: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CHECK_CONTEXT_VARS) {
    // `ONNI_PROJECT_ID` is the one context name that is ALSO a documented CLI input
    // (BACKWARD_COMPATIBILITY.md §1 — `onni task`/`onni automation` address a cockpit with it),
    // so it is replaced, never stripped. A headless `onni run` builds its manager without a
    // projectId, and deleting the operator's value there would leave `ONNI_API_URL` in place
    // while `onni task create` silently fell back to the cockpit's boot project.
    if (name === 'ONNI_PROJECT_ID' && !context.projectId) continue;
    delete base[name];
  }
  return { ...base, ...resolved.values, ...(await checkContextEnv(context, runId, state, step.id)) };
}

/**
 * What a check step knows about the run it verifies (spec 2026-10-06-agentic-e2e-checks
 * Phase 2). Onni-set outputs, not knobs: every value is a string, and a value this run does
 * not have is omitted rather than set empty, so `[ -n "$ONNI_GITHUB_NUMBER" ]` means what it
 * says. `ONNI_SHARED_CACHE_DIR` is one directory per project, shared by its tasks, so a
 * replay cache recorded in one worktree is warm in the next.
 */
async function checkContextEnv(
  context: CheckContext,
  runId: string,
  state: CheckActiveRun,
  stepId: string,
): Promise<Record<string, string>> {
  const run = context.store.getRun(runId);
  const contextVars: Record<string, string> = {
    ONNI_RUN_ID: runId,
    ONNI_WORKTREE: state.cwd,
    ONNI_STEP_ID: stepId,
    ONNI_ATTEMPT: String(run?.steps.find((step) => step.id === stepId)?.iterations ?? 1),
  };
  if (context.projectId) {
    contextVars.ONNI_PROJECT_ID = context.projectId;
    const cache = await sharedCheckCacheDir(context.projectId);
    if (cache) contextVars.ONNI_SHARED_CACHE_DIR = cache;
  }
  if (run?.branch) contextVars.ONNI_BRANCH = run.branch;
  if (run?.baseBranch) contextVars.ONNI_BASE = run.baseBranch;
  const github = run?.automation ? parseGithubItemUrl(run.automation.githubUrl) : undefined;
  if (github && run?.automation) {
    contextVars.ONNI_GITHUB_REPO = github.repo;
    contextVars.ONNI_GITHUB_NUMBER = String(github.number);
    contextVars.ONNI_GITHUB_EVENT = run.automation.event;
  }
  if (run?.prHead) {
    contextVars.ONNI_PR_HEAD_SHA = run.prHead.headSha;
    contextVars.ONNI_PR_HEAD_REF = run.prHead.headRef;
    contextVars.ONNI_PR_BASE_REF = run.prHead.baseRef;
  }
  return contextVars;
}

/**
 * Delete the `refs/onni/pr/<n>` refs no run with a live worktree still needs (Phase 3).
 * Called after every worktree-removal path; idempotent and never throws.
 */
export async function sweepPrHeadRefs(context: CheckContext): Promise<void> {
  const needed = new Set<number>();
  for (const run of context.store.listRuns()) {
    if (run.prHead && run.worktreePath && existsSync(run.worktreePath)) needed.add(run.prHead.number);
  }
  await prunePrHeadRefs(context.repoRoot, needed).catch(() => undefined);
}

export async function runCheckStep(
  context: CheckContext,
  runId: string,
  state: CheckActiveRun,
  step: WorkflowStepDef,
  emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const command = step.command as string;
  emit({ type: 'note', stepId: step.id, message: `$ ${command}` });
  const env = await checkStepEnv(context, runId, state, step, emit);
  // A cancel that landed during the read had no child to interrupt; do not spawn one now.
  if (state.cancelled) return { ok: false, output: 'cancelled', exitCode: -1 };
  const bash = resolveBash();
  if (!bash) {
    emit({ type: 'check-output', stepId: step.id, command, text: BASH_MISSING_MESSAGE, exitCode: -1 });
    return { ok: false, output: BASH_MISSING_MESSAGE, exitCode: -1 };
  }
  return new Promise((resolve) => {
    // Check steps run in the same cwd as the agent steps — the worktree.
    const child = spawnTaskProcess(bash.path, ['-lc', command], { cwd: state.cwd, env: withBashPath(env, bash) });
    state.interrupt = () => child.kill('SIGTERM');

    let output = '';
    const append = (text: string) => {
      if (output.length < context.checkOutputCap) {
        output += text;
        if (output.length >= context.checkOutputCap) output += '\n… (output truncated)';
      }
    };
    // One decoder per stream: a character split across two chunks must not become two U+FFFD.
    const stdout = utf8Collector(append);
    const stderr = utf8Collector(append);
    child.stdout.on('data', stdout.write);
    child.stderr.on('data', stderr.write);
    child.on('error', (err) => {
      state.interrupt = () => undefined;
      const message = `failed to spawn: ${err.message}`;
      emit({ type: 'check-output', stepId: step.id, command, text: message, exitCode: -1 });
      resolve({ ok: false, output: message, exitCode: -1 });
    });
    child.on('close', (code) => {
      state.interrupt = () => undefined;
      stdout.end();
      stderr.end();
      const trimmed = output.trim() || '(no output)';
      // `code` is null when a signal killed the child; -1 then, the same value an
      // unspawnable command reports, and one no `retryOn` list can name — neither
      // is a verdict on the diff, so neither buys the agent another attempt.
      const exitCode = code ?? -1;
      emit({ type: 'check-output', stepId: step.id, command, text: trimmed, exitCode });
      resolve({ ok: code === 0, output: trimmed, exitCode });
    });
  });
}

export function finishStep(
  context: CheckContext,
  runId: string,
  stepId: string,
  status: 'done' | 'failed',
  error: string | undefined,
  emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
): void {
  context.store.updateStep(runId, stepId, {
    status,
    error,
    finishedAt: new Date().toISOString(),
  });
  emit({ type: 'step-end', stepId, status, ...(error ? { error } : {}) });
  appendHandoffHeartbeat(context.dataDir, runId, `step "${stepId}" complete — status=${status}`);
}

/**
 * Every variable a check step's run context may set (spec 2026-10-06-agentic-e2e-checks
 * Phase 2) — also the list stripped from the inherited env, so an unset one is truly absent.
 * Documented in `docs/reference.md` and `.env.example`; keep the three in step.
 */
export const CHECK_CONTEXT_VARS = [
  'ONNI_RUN_ID',
  'ONNI_PROJECT_ID',
  'ONNI_WORKTREE',
  'ONNI_BRANCH',
  'ONNI_BASE',
  'ONNI_STEP_ID',
  'ONNI_ATTEMPT',
  'ONNI_SHARED_CACHE_DIR',
  'ONNI_GITHUB_REPO',
  'ONNI_GITHUB_NUMBER',
  'ONNI_GITHUB_EVENT',
  'ONNI_PR_HEAD_SHA',
  'ONNI_PR_HEAD_REF',
  'ONNI_PR_BASE_REF',
] as const;

/** `https://<github host>/<owner>/<repo>/(pull|issues)/<n>` → its repo and number (any host: GitHub Enterprise). */
export function parseGithubItemUrl(url: string): { repo: string; number: number } | undefined {
  const match = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(?:pull|issues)\/([1-9][0-9]*)(?:[/?#].*)?$/.exec(url);
  return match ? { repo: match[1]!, number: Number(match[2]) } : undefined;
}

/**
 * `~/.onni/cache/<projectId>`, created `0700` on first use — the shared replay cache of a
 * project's check steps. `undefined` when the home cannot hold it: the check then runs with a
 * cold cache, exactly as before this variable existed. Nothing prunes it — `removeProject` is
 * unregister-only — so `docs/e2e-verification.md` says how to reclaim the space.
 *
 * `projectId` is re-validated here even though every caller's id is already slug-shaped, for the
 * same reason `workspace/secrets.ts` re-validates before building
 * `~/.onni/secrets/<projectId>.json`: this is where the value becomes a path, and a
 * `recursive` mkdir is the wrong place to find out the guard moved upstream.
 */
async function sharedCheckCacheDir(projectId: string): Promise<string | undefined> {
  if (!PROJECT_ID_RE.test(projectId)) return undefined;
  try {
    // Inside the `try` with the write: resolving the home is part of "the home cannot hold it".
    const dir = join(onniHomeDir(), 'cache', projectId);
    assertOnniHomeWriteIsSandboxed(dir);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return dir;
  } catch {
    return undefined;
  }
}

function fileSnapshot(dir: string, path: string): string {
  try {
    return createHash('sha256').update(readFileSync(join(dir, path))).digest('hex');
  } catch {
    return 'missing-or-unreadable';
  }
}

export async function currentCheckExclusions(dir: string, owned: Map<string, string>): Promise<string[]> {
  const exclusions: string[] = [];
  for (const [path, snapshot] of owned) {
    if (fileSnapshot(dir, path) === snapshot) exclusions.push(path);
    else owned.delete(path); // later agent edits reclaim ownership of this path
  }
  return exclusions;
}

export async function captureCheckArtifacts(dir: string, owned: Map<string, string>): Promise<void> {
  for (const path of await worktreeChangedPaths(dir)) owned.set(path, fileSnapshot(dir, path));
}

export function applyTemplate(template: string, task: string): string {
  return template.replaceAll('{{task}}', task);
}

/**
 * Skill identity is context, while the Markdown body remains instructions.
 *
 * For an on-disk skill we also hand the agent the ABSOLUTE directory of the
 * installed copy. A run executes in an isolated worktree that has no local
 * `.agents/skills` (gitignored, absent in a fresh checkout), so without this
 * the agent cannot read the skill's companion files (`references/*.md`) — or,
 * worse, reads a stale copy materialized from the team-repo cache. The path
 * resolves against the MAIN project root (`discoverSkills(repoRoot)`), i.e. the
 * current `npx skills`-installed copy, so a worktree agent and the main
 * checkout read the exact same, up-to-date files. Team skills are omitted here:
 * they are materialized into the worktree separately (see the call site).
 */
export function skillSystemPrompt(
  skill: Pick<Skill, 'name' | 'description' | 'body'> & Partial<Pick<Skill, 'path' | 'source'>>,
): string {
  const lines = [
    `Selected skill: /${skill.name}`,
    ...(skill.description ? [`Description: ${skill.description}`] : []),
  ];
  if (skill.source && skill.source !== 'team' && skill.path) {
    const dir = dirname(skill.path);
    lines.push(
      '',
      `Skill files are installed on disk at: ${dir}`,
      `Read any file this skill references (for example references/*.md) from that absolute directory. ` +
        `It is the current installed copy — use it even though your working directory is a separate worktree that does not contain the skill.`,
    );
  }
  lines.push('', 'Skill instructions:', skill.body.trim());
  return lines.join('\n');
}

/** Bound on waiting for the first team-skill load before installing a task's skills. */
export const TEAM_SKILLS_WAIT_MS = 10_000;

/** The `name` of a prompt's leading `/name` slash command, else undefined. */
export function leadingSlashSkillName(text: string): string | undefined {
  return /^\/([A-Za-z0-9][A-Za-z0-9._-]*)(?=\s|$)/.exec(text)?.[1];
}

/**
 * Expand a registry-backed slash skill in one prompt string before it reaches a
 * backend. Claude otherwise intercepts an unknown leading slash command, and
 * Codex/OpenCode have no native slash-skill lookup at all (#676).
 *
 * Only a match at character zero counts, and unknown commands pass through
 * byte-for-byte — a backend's OWN slash commands must keep working. The caller
 * persists the original user text before applying this delivery-only rewrite.
 *
 * Both delivery seams route through here: live-session messages via
 * `expandRegistrySlashSkill`, and a continuation's opening prompt, which becomes
 * the session's `userPrompt` and never passes through `deliverMessage` at all
 * (#811).
 */
export function expandRegistrySlashSkillText(text: string, skills: readonly Skill[]): string {
  const name = leadingSlashSkillName(text);
  if (!name) return text;
  const skill = skills.find((candidate) => candidate.name === name);
  if (!skill) return text;

  const request = text.slice(name.length + 1).trim();
  return request ? `${skillSystemPrompt(skill)}\n\nUser request:\n${request}` : skillSystemPrompt(skill);
}

/**
 * `expandRegistrySlashSkillText` over a live chat message: only the first text
 * block is eligible, and an unchanged block returns the caller's array
 * identity untouched.
 */
export function expandRegistrySlashSkill(
  content: ContentBlock[],
  skills: readonly Skill[],
): ContentBlock[] {
  const textIndex = content.findIndex((block) => block.type === 'text');
  if (textIndex < 0) return content;
  const block = content[textIndex];
  if (!block || block.type !== 'text') return content;
  const text = expandRegistrySlashSkillText(block.text, skills);
  if (text === block.text) return content;

  const expanded = [...content];
  expanded[textIndex] = { type: 'text', text };
  return expanded;
}
