import type { Translate } from '@/lib/i18n'

/**
 * The run transcript's lifecycle notes are written by the server in English and stored as data
 * (the engine, logs and other clients read them). They are translated here, at display time, by
 * a table of known shapes; a note that matches none is shown as written, never mangled.
 */
const RULES: ReadonlyArray<[RegExp, (t: Translate, m: RegExpExecArray) => string]> = [
  [/^run (started|resumed) — workflow "(.+)" \(runner: (.+)\)$/, (t, m) =>
    m[1] === 'started'
      ? t('run started — workflow "{workflow}" (runner: {runner})', { workflow: m[2]!, runner: m[3]! })
      : t('run resumed — workflow "{workflow}" (runner: {runner})', { workflow: m[2]!, runner: m[3]! })],
  [/^worktree on — using an isolated task worktree \((explicit request|default)\)$/, (t, m) =>
    m[1] === 'default' ? t('worktree on — using an isolated task worktree (default)') : t('worktree on — using an isolated task worktree (explicit request)')],
  [/^worktree ready — branch (\S+) \(base (.+)\)$/, (t, m) => t('worktree ready — branch {branch} (base {base})', { branch: m[1]!, base: m[2]! })],
  [/^run finished$/, (t) => t('run finished')],
  [/^run cancelled$/, (t) => t('run cancelled')],
  [/^changes ready for review — send feedback, open a draft PR, or finish$/, (t) => t('changes ready for review — send feedback, open a draft PR, or finish')],
  [/^nothing to commit$/, (t) => t('nothing to commit')],
  [/^goal achieved — session closed$/, (t) => t('goal achieved — session closed')],
  [/^review accepted — finished without a PR$/, (t) => t('review accepted — finished without a PR')],
  [/^waiting for exclusive access to the repository working tree$/, (t) => t('waiting for exclusive access to the repository working tree')],
  [/^run failed — ([\s\S]+)$/, (t, m) => t('run failed — {reason}', { reason: m[1]! })],
  [/^run stopped — ([\s\S]+)$/, (t, m) => t('run stopped — {reason}', { reason: m[1]! })],
  [/^continue failed — ([\s\S]+)$/, (t, m) => t('continue failed — {reason}', { reason: m[1]! })],
  [/^dispatch refused — ([\s\S]+)$/, (t, m) => t('dispatch refused — {reason}', { reason: m[1]! })],
  [/^merge refused — ([\s\S]+)$/, (t, m) => t('merge refused — {reason}', { reason: m[1]! })],
  [/^usage limit reached — resuming automatically at (.+)$/, (t, m) => t('usage limit reached — resuming automatically at {time}', { time: m[1]! })],
  [/^temporary provider failure — retrying automatically at (.+)$/, (t, m) => t('temporary provider failure — retrying automatically at {time}', { time: m[1]! })],
  [/^(\d+) new tree inbox messages? — delivered into the session$/, (t, m) => t('{count} new tree inbox messages — delivered into the session', { count: m[1]! })],
  [/^report received from task "(.+)" \((.+)\) — ([\s\S]+)$/, (t, m) => t('report received from task "{title}" ({id}) — {detail}', { title: m[1]!, id: m[2]!, detail: m[3]! })],
]

export function translateNote(text: string, t: Translate): string {
  for (const [pattern, render] of RULES) {
    const match = pattern.exec(text)
    if (match) return render(t, match)
  }
  return text
}
