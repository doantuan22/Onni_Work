import type { RunRecord } from '@onni/api-client'

/**
 * System notifications from the desktop shell (docs/design/unattended-safety.md §8). The shell
 * registers `tauri-plugin-notification`; the cockpit reaches it through the same
 * `__TAURI_INTERNALS__.invoke` seam the title bar uses, so the browser build carries no Tauri
 * dependency and, outside the shell, `desktopInvoke()` is simply undefined.
 */

export type DesktopInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function desktopInvoke(): DesktopInvoke | undefined {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: DesktopInvoke } }).__TAURI_INTERNALS__
  return typeof internals?.invoke === 'function' ? internals.invoke.bind(internals) : undefined
}

/** Ask for permission once if needed, then notify. Never throws; false when nothing was shown. */
export async function sendDesktopNotification(
  title: string,
  body: string,
  invoke: DesktopInvoke | undefined = desktopInvoke(),
): Promise<boolean> {
  if (!invoke) return false
  try {
    let granted = (await invoke('plugin:notification|is_permission_granted')) === true
    if (!granted) granted = (await invoke('plugin:notification|request_permission')) === 'granted'
    if (!granted) return false
    await invoke('plugin:notification|notify', { options: { title, body } })
    return true
  } catch {
    return false
  }
}

/** Runs worth a system notification: they ended, failed, hit a ceiling, or need a person. */
export function wantsDesktopNotice(run: Pick<RunRecord, 'status' | 'limitHit'>): boolean {
  return run.status === 'done' || run.status === 'failed' || run.status === 'waiting' || run.status === 'review' || run.limitHit !== undefined
}

export function describeDesktopNotice(run: Pick<RunRecord, 'status' | 'title' | 'titleSummary' | 'limitHit' | 'error' | 'waitExpiredAt'>): { title: string; body: string } {
  const title = run.titleSummary ?? run.title
  if (run.limitHit) return { title, body: `Hit a ceiling (${run.limitHit.kind}) — stopped, nothing was lost` }
  if (run.waitExpiredAt) return { title, body: 'Nobody answered in time — ended; Continue to answer' }
  if (run.status === 'done') return { title, body: 'Finished' }
  if (run.status === 'failed') return { title, body: run.error ? `Failed — ${run.error.slice(0, 140)}` : 'Failed' }
  if (run.status === 'review') return { title, body: 'Ready for review' }
  return { title, body: 'Needs your attention' }
}
