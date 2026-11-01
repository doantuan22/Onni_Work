import type { Language } from './language'
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
 * here, later files winning on an identical key.
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

/** Replace `{name}` placeholders. Unknown placeholders are left as written, never blanked. */
export function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  )
}

/** The one translation rule: English returns the text itself; Vietnamese looks it up, then falls
 *  back to English. Placeholders are substituted AFTER the lookup, so a translated entry keeps
 *  the same `{name}` tokens as its key. */
export function translate(language: Language, text: string, vars?: Record<string, string | number>): string {
  const chosen = language === 'vi' ? (viMessages[text] ?? text) : text
  return interpolate(chosen, vars)
}
