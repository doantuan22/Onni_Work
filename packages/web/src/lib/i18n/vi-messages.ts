import { viContent } from './vi-content'
import { viAutomations } from './vi-automations'
import { viGit } from './vi-git'
import { viGithub } from './vi-github'
import { viNewTask } from './vi-new-task'
import { viSettings } from './vi-settings'
import { viPolish } from './vi-polish'
import { viShell } from './vi-shell'
import { viTasks } from './vi-tasks'

/**
 * The cockpit's Vietnamese layer.
 *
 * ENGLISH TEXT IS THE KEY. `t('Run {n} tasks', { n })` returns the string unchanged in English
 * (after interpolation) and looks itself up here in Vietnamese. Two consequences worth keeping:
 *  - English mode is byte-identical to the pre-i18n UI, so tests, docs and screenshots stay valid;
 *  - a missing entry falls back to English instead of showing a key, so coverage can grow per
 *    surface without ever shipping "settings.save.tooltip".
 *
 * The dictionaries are split per area only so parallel work never shares a file; they are merged
 * here, later files winning on an identical key. This module is reached only through the dynamic
 * import in `messages.ts`, so an English cockpit never downloads it.
 *
 * GLOSSARY (keep every area consistent):
 *   task → nhiệm vụ · run → lượt chạy · project → dự án · workspace → workspace
 *   workflow → quy trình · skill → skill · agent → agent · backend → backend
 *   manager → quản lý · worker → worker · worktree → worktree · diff → diff
 *   review → đánh giá · dispatch → giao việc · inbox → hộp thư · settings → cài đặt
 *   PR / issue / branch / commit / merge / token / prompt / CLI stay English.
 */
export const viMessages: Readonly<Record<string, string>> = {
  ...viShell,
  ...viNewTask,
  ...viTasks,
  ...viSettings,
  ...viAutomations,
  ...viGithub,
  ...viGit,
  ...viContent,
  ...viPolish,
}
