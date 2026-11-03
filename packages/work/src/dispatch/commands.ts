/**
 * The `onni task` command table — the ONE source for CLI help and for the briefs a manager or a
 * worker reads (plan v2 §5 H5). A command an agent is never told about does not exist for it, so
 * adding, removing or renaming one is a single edit here. Deliberately no feature flag: removing
 * the line from the table is the off switch.
 */
import { RUNNER_IDS } from '../core/agent-runner.ts';
import { MANAGER_COMMANDS_MAX_CHARS } from './prompt-budget.ts';

export interface TaskCommand {
  name: string;
  role: 'manager' | 'worker';
  /** CLI help text; continuation lines keep their own alignment. */
  usage: string;
  /** The shorter form shown in the brief of the role that may use it. */
  brief?: string;
  /** One-line description for the brief when `brief` is not a full usage line. */
  oneLine: string;
}

const CREATE_USAGE = `onni task create "<objective>" [--title "…"] [--kind implement|review] [--review-of <branch|run>]
                  [--scope "…"] [--budget <usd>] [--success "…"] [--evidence "…"] [--tools A,B]
                  [--backend ${RUNNER_IDS.join('|')}] [--model <model>] [--retry-limit <0-3>] [--after "<title or id of an earlier order>" …]`;

const REPORT_USAGE = `onni task report --status done|partial|failed|blocked --result "…" [--evidence "…"]…
                  [--check "<command>=<exit code>"]… [--verdict approve|changes|reject]
                  [--suggestions "…"]… [--confidence <0-1>]
                  [--side-effect "…"]… [--error "…"]… [--next "…"]`;

export const TASK_COMMANDS: readonly TaskCommand[] = [
  {
    name: 'create',
    role: 'manager',
    usage: CREATE_USAGE,
    brief: 'onni task create "<objective>" --backend <worker backend> [--model <model>] [--after "<earlier order title>"] --scope "<files or dirs it may touch>" --success "<how it knows it is done>" [--title "…"] [--budget <usd>] [--evidence "<what it must show>"] [--kind implement|review] [--review-of <branch or run id>]',
    oneLine: 'hand one independent part to a worker',
  },
  {
    name: 'report',
    role: 'worker',
    usage: REPORT_USAGE,
    brief: 'onni task report --status done|partial|failed|blocked --result "<what you did and the state now>" [--evidence "…" …] [--check "npm test=0" …] [--suggestions "…" …] [--confidence 0.8]',
    oneLine: 'report your outcome before you finish',
  },
  {
    name: 'merge',
    role: 'manager',
    usage: `onni task merge <run id|branch>      (manager, needs "Full quyền manager") merge a worker's branch into yours
  onni task merge --to-base            (manager) bring base into your branch, then fast-forward the local base
  onni task merge --abort              abandon a merge left in progress`,
    brief: 'onni task merge <run id or branch>   merge one worker branch into yours (needs "Full quyền manager")',
    oneLine: 'merge a worker branch, or the base branch, into your own',
  },
  {
    name: 'list',
    role: 'manager',
    usage: 'onni task list                       the tree this task belongs to, with status and cost',
    brief: 'onni task list   the tree this task belongs to, with status and cost',
    oneLine: 'see the tree this task belongs to, with status and cost',
  },
  {
    name: 'budget',
    role: 'manager',
    usage: "onni task budget                     what is left of this tree's cost, token, time, step and worker ceilings",
    brief: "onni task budget   what is left of this tree's ceilings — ask before a large or late dispatch",
    oneLine: "see what is left of this tree's ceilings",
  },
  {
    name: 'peek',
    role: 'manager',
    usage: 'onni task peek [<worker id>] [--all] [--tail <1-30>]   a worker\'s state, changed files and recent lines (read-only)',
    brief: 'onni task peek [<worker id>] [--tail N]   a worker\'s state, changed files and recent lines; --all for a compact list. Peek when one has been silent a while or before you change course — do NOT poll, its report arrives by itself',
    oneLine: "see where a worker is, what it changed and how long it has been quiet",
  },
  {
    name: 'memory',
    role: 'manager',
    usage: 'onni task memory add "<lesson>"   remember one lesson for later tasks in this repository',
    brief: 'onni task memory add "<lesson>"   save a durable lesson (build order, a trap, a convention) for later tasks in this repository; one line',
    oneLine: 'save a lesson for later tasks in this repository',
  },
  {
    name: 'tree',
    role: 'manager',
    usage: 'onni task tree <run id>              the tree rooted at (or containing) another run',
    brief: 'onni task tree <run id>   the tree rooted at (or containing) another run',
    oneLine: 'see the tree rooted at (or containing) another run',
  },
];

export function taskCommand(name: string): TaskCommand | undefined {
  return TASK_COMMANDS.find((command) => command.name === name);
}

/** The CLI's help block. */
export function taskUsage(commands: readonly TaskCommand[] = TASK_COMMANDS): string {
  return commands.map((command) => `  ${command.usage}`).join('\n');
}

/** Brief lines for one role, in table order. */
export function briefCommands(role: TaskCommand['role'], commands: readonly TaskCommand[] = TASK_COMMANDS): string {
  return commands
    .filter((command) => command.role === role && command.brief)
    .map((command) => `  ${command.brief}`)
    .join('\n');
}

/**
 * Cut a prompt block at a LINE boundary: a block that outgrows its budget loses whole tail lines,
 * never half a line, and the blocks around it are untouched (plan v2 §3).
 */
export function clampLines(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const kept: string[] = [];
  let used = 0;
  for (const line of text.split('\n')) {
    const cost = line.length + 1;
    if (used + cost > maxChars) break;
    kept.push(line);
    used += cost;
  }
  return kept.join('\n');
}

/** The manager's command block, capped by its own budget (§3). */
export function managerCommandsBlock(): string {
  return clampLines(briefCommands('manager'), MANAGER_COMMANDS_MAX_CHARS);
}

/** The worker's command block, capped by its own budget (§3). */
export function workerCommandsBlock(): string {
  return clampLines(briefCommands('worker'), MANAGER_COMMANDS_MAX_CHARS);
}
