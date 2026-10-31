import { describe, expect, it, vi } from 'vitest'
import { describeDesktopNotice, sendDesktopNotification, wantsDesktopNotice } from './desktop-notify'

describe('sendDesktopNotification', () => {
  it('notifies straight away when permission is already granted', async () => {
    const invoke = vi.fn(async (command: string) => (command.endsWith('is_permission_granted') ? true : undefined))
    expect(await sendDesktopNotification('T', 'B', invoke)).toBe(true)
    expect(invoke).toHaveBeenLastCalledWith('plugin:notification|notify', { options: { title: 'T', body: 'B' } })
  })
  it('asks once, and stays silent when refused', async () => {
    const invoke = vi.fn(async (command: string) => (command.endsWith('is_permission_granted') ? false : command.endsWith('request_permission') ? 'denied' : undefined))
    expect(await sendDesktopNotification('T', 'B', invoke)).toBe(false)
    expect(invoke).not.toHaveBeenCalledWith('plugin:notification|notify', expect.anything())
  })
  it('does nothing outside the desktop shell and never throws', async () => {
    expect(await sendDesktopNotification('T', 'B', undefined)).toBe(false)
    expect(await sendDesktopNotification('T', 'B', async () => { throw new Error('boom') })).toBe(false)
  })
})

describe('what is worth a notification', () => {
  it('covers finished, failed, waiting, review and a hit ceiling, not running or queued', () => {
    for (const status of ['done', 'failed', 'waiting', 'review'] as const) expect(wantsDesktopNotice({ status })).toBe(true)
    expect(wantsDesktopNotice({ status: 'cancelled', limitHit: { kind: 'cost', limit: 1, used: 1, scope: 'run', at: 'x' } })).toBe(true)
    expect(wantsDesktopNotice({ status: 'running' })).toBe(false)
    expect(wantsDesktopNotice({ status: 'queued' })).toBe(false)
  })
  it('says why', () => {
    expect(describeDesktopNotice({ status: 'cancelled', title: 'x', limitHit: { kind: 'tokens', limit: 1, used: 2, scope: 'run', at: 'x' } }).body).toContain('tokens')
    expect(describeDesktopNotice({ status: 'failed', title: 'x', waitExpiredAt: 'x' }).body).toContain('Nobody answered')
    expect(describeDesktopNotice({ status: 'done', title: 'x' }).body).toBe('Finished')
  })
})
