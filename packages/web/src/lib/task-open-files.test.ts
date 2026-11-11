import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  activateTaskFile,
  closeTaskFile,
  createTaskOpenFilesState,
  openTaskFile,
  readTaskOpenFiles,
  resetTaskOpenFilesStores,
  taskOpenFilesStorageKey,
  useTaskOpenFiles,
} from './task-open-files'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  resetTaskOpenFilesStores()
  vi.restoreAllMocks()
})

describe('task open-file reducers', () => {
  it('opens paths once, activates them, and chooses a neighbouring tab when one closes', () => {
    const first = openTaskFile(createTaskOpenFilesState(), 'src/a.ts')
    const second = openTaskFile(first, 'src/b.ts')

    expect(openTaskFile(second, 'src/b.ts')).toEqual({ openPaths: ['src/a.ts', 'src/b.ts'], activePath: 'src/b.ts' })
    expect(activateTaskFile(second, 'src/a.ts')).toEqual({ openPaths: ['src/a.ts', 'src/b.ts'], activePath: 'src/a.ts' })
    expect(closeTaskFile(second, 'src/b.ts')).toEqual({ openPaths: ['src/a.ts'], activePath: 'src/a.ts' })
    expect(activateTaskFile(first, 'missing.ts')).toBe(first)
  })
})

describe('useTaskOpenFiles', () => {
  it('shares each run state across panes and restores it from session storage', () => {
    const first = renderHook(() => useTaskOpenFiles('run-a'))
    const second = renderHook(() => useTaskOpenFiles('run-a'))

    act(() => first.result.current.open('src/a.ts'))
    act(() => second.result.current.open('src/b.ts'))
    act(() => second.result.current.activate('src/a.ts'))

    expect(first.result.current).toMatchObject({
      openPaths: ['src/a.ts', 'src/b.ts'],
      activePath: 'src/a.ts',
    })
    expect(sessionStorage.getItem(taskOpenFilesStorageKey('run-a'))).toBe(
      JSON.stringify({ openPaths: ['src/a.ts', 'src/b.ts'], activePath: 'src/a.ts' }),
    )

    resetTaskOpenFilesStores()
    expect(readTaskOpenFiles('run-a')).toEqual({ openPaths: ['src/a.ts', 'src/b.ts'], activePath: 'src/a.ts' })
  })

  it('keeps working when session storage is inaccessible or corrupt', () => {
    sessionStorage.setItem(taskOpenFilesStorageKey('run-a'), '{ invalid')
    expect(readTaskOpenFiles('run-a')).toEqual(createTaskOpenFilesState())

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const files = renderHook(() => useTaskOpenFiles('run-b'))
    act(() => files.result.current.open('src/a.ts'))

    expect(files.result.current).toMatchObject({ openPaths: ['src/a.ts'], activePath: 'src/a.ts' })
  })
})
