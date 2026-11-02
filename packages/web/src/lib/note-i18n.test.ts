import { describe, expect, it } from 'vitest'

import { translate } from '@/lib/i18n'
import { translateNote } from '@/lib/note-i18n'

const vi = (text: string, vars?: Record<string, string | number>) => translate('vi', text, vars)
const en = (text: string, vars?: Record<string, string | number>) => translate('en', text, vars)

describe('translateNote', () => {
  it('translates the known lifecycle notes and keeps their details', () => {
    expect(translateNote('run started — workflow "quick-task" (runner: claude)', vi)).toBe('bắt đầu chạy — quy trình "quick-task" (runner: claude)')
    expect(translateNote('worktree ready — branch onni/1234abcd (base main)', vi)).toBe('worktree sẵn sàng — nhánh onni/1234abcd (base main)')
    expect(translateNote('run failed — exit code 1', vi)).toBe('chạy thất bại — exit code 1')
    expect(translateNote('2 new tree inbox messages — delivered into the session', vi)).toContain('2 tin nhắn mới')
  })

  it('leaves an unknown note exactly as the server wrote it', () => {
    expect(translateNote('private MCP: something odd', vi)).toBe('private MCP: something odd')
  })

  it('is the identity in English', () => {
    const note = 'run started — workflow "quick-task" (runner: claude)'
    expect(translateNote(note, en)).toBe(note)
  })
})
