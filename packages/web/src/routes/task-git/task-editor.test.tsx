import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'

import { TaskEditor } from './task-editor'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const FILES: Record<string, unknown> = {
  'src%2Fhello.ts': {
    type: 'file', path: 'src/hello.ts', size: 34, binary: false, tooLarge: false,
    content: "export const greeting = 'hello'\nconsole.log(greeting)",
  },
  'src%2Fother.ts': {
    type: 'file', path: 'src/other.ts', size: 12, binary: false, tooLarge: false, content: 'export {}',
  },
}

function stubFetch(failPath?: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (failPath && url.includes(`path=${encodeURIComponent(failPath)}`)) {
      return new Response(JSON.stringify({ error: 'file service unavailable' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
    const key = new URL(url, 'http://localhost').searchParams.get('path')?.replaceAll('/', '%2F') ?? ''
    const file = FILES[key]
    return new Response(JSON.stringify(file ?? { error: `missing: ${key}` }), {
      status: file ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    })
  }))
}

function renderEditor(props: Partial<React.ComponentProps<typeof TaskEditor>> = {}) {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TaskEditor
        runId="r1"
        openPaths={[]}
        activePath={null}
        onSelect={onSelect}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onSelect, onClose }
}

describe('TaskEditor', () => {
  it('shows the empty prompt when no file is open', () => {
    stubFetch()
    renderEditor()

    expect(screen.getByText('Open a file from the tree')).toBeTruthy()
    expect(document.querySelector('[data-slot="editor-content"]')).toBeNull()
  })

  it('renders open file tabs and delegates selection and close actions', async () => {
    stubFetch()
    const { onSelect, onClose } = renderEditor({
      openPaths: ['src/hello.ts', 'src/other.ts'],
      activePath: 'src/hello.ts',
    })

    expect(screen.getByRole('tab', { name: 'hello.ts' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'other.ts' }).getAttribute('aria-selected')).toBe('false')
    fireEvent.click(screen.getByRole('tab', { name: 'other.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close hello.ts' }))
    expect(onSelect).toHaveBeenCalledWith('src/other.ts')
    expect(onClose).toHaveBeenCalledWith('src/hello.ts')

    await waitFor(() => expect(document.querySelector('[data-slot="file-preview-code"]')).not.toBeNull())
  })

  it('shows the active path breadcrumb and read-only line-numbered highlighted content', async () => {
    stubFetch()
    renderEditor({ openPaths: ['src/hello.ts'], activePath: 'src/hello.ts' })

    await waitFor(() => expect(document.querySelector('[data-slot="file-preview-code"]')).not.toBeNull())
    expect(screen.getByRole('navigation', { name: 'File path' }).textContent).toContain('src')
    expect(screen.getByRole('navigation', { name: 'File path' }).textContent).toContain('hello.ts')
    const code = document.querySelector('[data-slot="file-preview-code"]') as HTMLElement
    expect(code.textContent).toContain('1export const greeting')
    expect(code.textContent).toContain('2console.log(greeting)')
    expect(code.dataset.lang).toBe('typescript')
    expect(document.querySelector('[data-slot="editor-content"]')?.getAttribute('contenteditable')).toBeNull()
    expect(document.querySelector('[data-slot="editor-content"] textarea, [data-slot="editor-content"] input')).toBeNull()
    expect(document.querySelector('[data-slot="editor-tabs"]')?.className).toContain('overflow-x-auto')
    expect(document.querySelector('[data-slot="editor-content"]')?.className).toContain('overflow-auto')
    expect(document.querySelector('header')?.className).toContain('h-header')
  })

  it('shows FilePreview errors separately from the no-file empty state', async () => {
    stubFetch('src/hello.ts')
    renderEditor({ openPaths: ['src/hello.ts'], activePath: 'src/hello.ts' })

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Could not load this file' })).toBeTruthy(),
    )
    expect(screen.queryByText('Open a file from the tree')).toBeNull()
    expect(document.querySelector('[data-slot="centered-state"]')?.getAttribute('data-tone')).toBe('danger')
  })
})
