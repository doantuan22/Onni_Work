import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'

import { TaskFilesTree } from './task-files-tree'

afterEach(() => {
  vi.unstubAllGlobals()
})

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

function renderTree(selectedPath: string | null = null, onOpenFile = vi.fn()) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TaskFilesTree runId="run-1" selectedPath={selectedPath} onOpenFile={onOpenFile} />
    </QueryClientProvider>,
  )
  return onOpenFile
}

describe('TaskFilesTree', () => {
  it('renders the Files header and hands a selected worktree file to its editor owner', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/v1/runs/run-1/files?path=') {
        return jsonResponse({ type: 'dir', path: '', entries: [{ name: 'src', type: 'dir' }, { name: 'README.md', type: 'file' }] })
      }
      if (path === '/api/v1/runs/run-1/files?path=src') {
        return jsonResponse({ type: 'dir', path: 'src', entries: [{ name: 'app.ts', type: 'file' }] })
      }
      return jsonResponse({ error: `unstubbed: ${path}` })
    }))
    const onOpenFile = renderTree('README.md')

    expect(screen.getByRole('heading', { name: 'Files' })).toBeTruthy()
    await waitFor(() => expect(document.querySelector('[data-slot="files-file"][data-path="README.md"]')).not.toBeNull())
    expect(document.querySelector('[data-path="README.md"]')?.getAttribute('aria-current')).toBe('true')

    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-slot="files-dir"][data-path="src"]')!)
    await waitFor(() => expect(document.querySelector('[data-slot="files-file"][data-path="src/app.ts"]')).not.toBeNull())
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-slot="files-file"][data-path="src/app.ts"]')!)

    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts')
  })
})
