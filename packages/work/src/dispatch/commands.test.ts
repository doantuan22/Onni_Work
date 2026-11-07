import { describe, expect, it } from 'vitest';
import {
  TASK_COMMANDS,
  briefCommands,
  clampLines,
  managerCommandsBlock,
  taskCommand,
  taskUsage,
  workerCommandsBlock,
} from './commands.ts';
import { MANAGER_COMMANDS_MAX_CHARS } from './prompt-budget.ts';

/** The subcommands `runTaskCommand` actually answers; a command missing from the table is invisible
 *  to both help and the briefs (plan v2 §5 H5). */
const CLI_COMMANDS = ['create', 'ask', 'report', 'merge', 'list', 'budget', 'peek', 'message', 'cancel', 'verify', 'conflicts', 'memory', 'plan', 'tree'];

describe('the command table is the one source of help and briefs', () => {
  it('holds every command the CLI answers, with a usage line and a one-line description', () => {
    expect(TASK_COMMANDS.map((command) => command.name)).toEqual(CLI_COMMANDS);
    for (const command of TASK_COMMANDS) {
      expect(command.usage).toContain(`onni task ${command.name}`);
      expect(command.oneLine.trim()).not.toBe('');
      expect(taskUsage()).toContain(command.usage);
    }
  });

  it('shows a command in the brief of the role that may use it, and not the other role’s', () => {
    expect(managerCommandsBlock()).toContain('onni task create');
    expect(managerCommandsBlock()).toContain('onni task ask');
    expect(managerCommandsBlock()).toContain('onni task merge');
    expect(managerCommandsBlock()).toContain('onni task peek');
    expect(managerCommandsBlock()).toContain('onni task message');
    expect(managerCommandsBlock()).toContain('onni task cancel');
    expect(managerCommandsBlock()).toContain('onni task verify');
    expect(managerCommandsBlock()).toContain('onni task conflicts');
    expect(managerCommandsBlock()).toContain('onni task memory add');
    expect(managerCommandsBlock()).toContain('do NOT poll');
    expect(managerCommandsBlock()).not.toContain('onni task report');
    expect(workerCommandsBlock()).toContain('onni task report');
    expect(workerCommandsBlock()).not.toContain('onni task create');
    for (const command of TASK_COMMANDS.filter((c) => c.brief)) {
      expect(briefCommands(command.role)).toContain(command.brief!);
    }
  });

  it('keeps every brief block inside its own budget', () => {
    expect(managerCommandsBlock().length).toBeLessThanOrEqual(MANAGER_COMMANDS_MAX_CHARS);
    expect(workerCommandsBlock().length).toBeLessThanOrEqual(MANAGER_COMMANDS_MAX_CHARS);
    // The block clamps tail lines, so a new command must not silently cost the manager one that was there.
    expect(managerCommandsBlock()).toContain('onni task tree');
  });

  it('looks a command up by name', () => {
    expect(taskCommand('merge')?.role).toBe('manager');
    expect(taskCommand('nope')).toBeUndefined();
  });
});

describe('clampLines', () => {
  it('keeps a block that fits exactly as it was', () => {
    expect(clampLines('a\nb', 10)).toBe('a\nb');
  });

  it('drops whole tail lines, never half a line', () => {
    expect(clampLines('aaaa\nbbbb\ncccc', 10)).toBe('aaaa\nbbbb');
    expect(clampLines('aaaa\nbbbb\ncccc', 9)).toBe('aaaa');
  });

  it('does not affect the sibling blocks — each one clamps on its own', () => {
    const long = `${'x'.repeat(50)}\nkept`;
    expect(clampLines(long, 54)).toBe('x'.repeat(50));
    expect(clampLines('short', 54)).toBe('short');
  });
});
