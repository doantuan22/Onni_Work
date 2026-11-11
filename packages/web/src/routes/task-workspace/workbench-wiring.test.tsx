import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { resetViewMemory } from '@/lib/view-memory'
import { resetWorkspaceStateStores } from '@/lib/workspace-state'
import {
  openTaskFile,
  readTaskOpenFiles,
  resetTaskOpenFilesStores,
  updateTaskOpenFiles,
} from '@/lib/task-open-files'
import type { ApiRun, HealthResponse } from '@onni/api-client'

import { TaskWorkspaceRoute } from './task-workspace'
import { WORKBENCH_LAYOUT_PRESET } from './layout-state'

vi.mock('./terminal-drawer', () => ({
  TerminalDrawer: ({ runId, fill }: { runId: string; fill?: boolean }) => (
    <section data-testid="terminal" data-run={runId} data-fill={fill ? '' : undefined} />
  ),
}))
vi.mock('../workflow-graph/task-graph', () => ({
  TaskGraphView: ({ run }: { run: { id: string } }) => <div data-testid="graph-view" data-run={run.id} />,
}))

const RUN: ApiRun = {
  id: 'r1',
  title: 'workbench wiring test',
  titleSummary: 'Workbench test',
  workflow: 'quick-task',
  task: 'Test phase 3 workbench wiring.',
  status: 'running',
  createdAt: '2026-11-11T00:00:00.000Z',
  tokensUsed: 0,
  archived: false,
  worktreePath: '/tmp/wt/r1',
  branch: 'onni/bcca84b5',
  baseBranch: 'main',
  seenAt: '2026-11-11T00:00:00.000Z',
  steps: [],
}

const HEALTH: HealthResponse = {
  version: '0.0.0-test',
  projects: [],
  bootProject: 'default',
  repoRoot: '/repo',
  repo: { root: '/repo', branch: 'main', remote: 'git@github.com:acme/demo.git' },
  checks: [],
  defaultRunner: 'claude',
  forge: { kind: 'github', available: true },
  capabilities: {
    localHandoff: true,
    terminal: true,
    designMode: true,
    tokenMetrics: true,
    tokenUsageMetrics: true,
    costMetrics: true,
    followups: false,
    singleProject: false,
    automations: false,
    webhooks: false,
    dispatch: false,
  },
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim()
const activeCard = () =>
  text(document.querySelector('[data-slot="layout-card"][data-active]')) ??
  document.querySelector('[data-action="layouts"][data-active-layout]')?.getAttribute('data-active-layout') ??
  undefined

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/api/v1/runs/${RUN.id}/layouts`)) {
        return jsonResponse({ layouts: [], active: 'Review' })
      }
      if (url.includes(`/api/v1/runs/${RUN.id}/files`)) {
        const parsed = new URL(url, 'http://localhost')
        const pathParam = parsed.searchParams.get('path') ?? ''
        if (pathParam === '') {
          return jsonResponse({
            type: 'dir',
            path: '',
            entries: [
              { name: 'src', type: 'dir' },
              { name: 'index.ts', type: 'file' },
            ],
          })
        }
        if (pathParam === 'src') {
          return jsonResponse({
            type: 'dir',
            path: 'src',
            entries: [{ name: 'app.tsx', type: 'file' }],
          })
        }
        return jsonResponse({
          type: 'file',
          path: pathParam,
          size: 42,
          binary: false,
          tooLarge: false,
          content: `// content of ${pathParam}\nexport const ready = true;\n`,
        })
      }
      if (url.match(/\/runs($|\?)/)) {
        return jsonResponse([
          RUN,
          {
            ...RUN,
            id: 'worker-1',
            title: 'Worker task 1',
            titleSummary: 'Worker task 1',
            dispatch: { parentRunId: RUN.id },
          },
        ])
      }
      if (url.includes(`/runs/${RUN.id}`)) {
        return jsonResponse(RUN)
      }
      if (url.includes('/api/v1/health')) {
        return jsonResponse(HEALTH)
      }
      return jsonResponse({})
    }),
  )
}

function renderWorkspace(initialEntries = ['/tasks/r1']) {
  let locationPathname = ''
  function LocationWatcher() {
    locationPathname = useLocation().pathname
    return null
  }

  const result = render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>
        <LocationWatcher />
        <Routes>
          <Route path="/tasks/:id" element={<TaskWorkspaceRoute />} />
          <Route path="/tasks/:id/*" element={<TaskWorkspaceRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { ...result, getPathname: () => locationPathname }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetWorkspaceStateStores()
  resetTaskOpenFilesStores()
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(2000)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
  resetWorkspaceStateStores()
  resetTaskOpenFilesStores()
  resetViewMemory()
})

describe('Workbench Phase 3 Wiring', () => {
  it('applies WORKBENCH_LAYOUT_PRESET from the Layout menu presets', async () => {
    stubFetch()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-route="task-workspace"]')).not.toBeNull())

    const layoutBtn = screen.getByRole('button', { name: /^Layout/ })
    fireEvent.keyDown(layoutBtn, { key: 'Enter' })

    const workbenchPresetItem = await screen.findByRole('menuitem', { name: 'Workbench' })
    expect(workbenchPresetItem).toBeDefined()
    fireEvent.click(workbenchPresetItem)

    await waitFor(() => {
      expect(activeCard()).toBe('Workbench')
    })

    const columnViews = Array.from(
      document.querySelectorAll('[data-slot="workspace-layout"][data-active] [data-slot="workspace-column"]'),
    ).map((col) => col.getAttribute('data-view'))

    expect(columnViews).toContain('session')
    expect(columnViews).toContain('files-tree')
    expect(columnViews).toContain('editor')
  })

  it('renders TaskEditor and opened files from the task-open-files store', async () => {
    stubFetch()
    updateTaskOpenFiles('r1', (s) => openTaskFile(s, 'src/app.tsx'))
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-route="task-workspace"]')).not.toBeNull())

    const layoutBtn = screen.getByRole('button', { name: /^Layout/ })
    fireEvent.keyDown(layoutBtn, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Workbench' }))

    await waitFor(() => {
      expect(document.querySelector('[data-route="task-editor"]')).not.toBeNull()
    })

    const openTabs = await screen.findByRole('tablist', { name: 'Open files' })
    expect(openTabs).toBeDefined()

    const tab = screen.getByRole('tab', { name: 'app.tsx' })
    expect(tab).toBeDefined()
    expect(tab.getAttribute('aria-selected')).toBe('true')

    await waitFor(() => {
      expect(screen.getByText('// content of src/app.tsx')).toBeDefined()
    })

    const closeBtn = screen.getByRole('button', { name: 'Close app.tsx' })
    fireEvent.click(closeBtn)

    expect(readTaskOpenFiles('r1').openPaths).toEqual([])
  })

  it('renders TaskFilesTree and clicking a file opens it in the editor store', async () => {
    stubFetch()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-route="task-workspace"]')).not.toBeNull())

    const layoutBtn = screen.getByRole('button', { name: /^Layout/ })
    fireEvent.keyDown(layoutBtn, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Workbench' }))

    await waitFor(() => {
      expect(document.querySelector('[data-slot="task-files-tree"]')).not.toBeNull()
    })

    await waitFor(() => {
      expect(document.querySelector('[data-slot="files-file"][data-path="index.ts"]')).not.toBeNull()
    })

    const fileBtn = document.querySelector<HTMLButtonElement>('[data-slot="files-file"][data-path="index.ts"]')!
    fireEvent.click(fileBtn)

    await waitFor(() => {
      const state = readTaskOpenFiles('r1')
      expect(state.openPaths).toContain('index.ts')
      expect(state.activePath).toBe('index.ts')
    })
  })

  it('uses the 48px h-header token for column header strips', async () => {
    stubFetch()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-route="task-workspace"]')).not.toBeNull())

    const headers = document.querySelectorAll('[data-slot="workspace-column-header"]')
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      expect(header.className).toContain('h-header')
      expect(header.className).not.toContain('h-8')
    }
  })

  it('renders TaskTreePane in tree view and navigates on clicking a run', async () => {
    stubFetch()
    const { getPathname } = renderWorkspace(['/tasks/r1'])
    await waitFor(() => expect(document.querySelector('[data-route="task-workspace"]')).not.toBeNull())

    const splits = screen.getAllByRole('button', { name: 'Split view' })
    fireEvent.click(splits[splits.length - 1]!)

    const treeTile = await screen.findByRole('button', { name: /Task tree/ })
    fireEvent.click(treeTile)

    await waitFor(() => {
      expect(document.querySelector('[data-slot="task-tree-pane"]')).not.toBeNull()
    })

    await waitFor(() => {
      expect(document.querySelector('[data-slot="task-tree-row"][data-run-id="worker-1"]')).not.toBeNull()
    })

    const workerRow = document.querySelector<HTMLElement>('[data-slot="task-tree-row"][data-run-id="worker-1"]')!
    fireEvent.click(workerRow)

    await waitFor(() => {
      expect(getPathname()).toBe('/tasks/worker-1')
    })
  })
})
