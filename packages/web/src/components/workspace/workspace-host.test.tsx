import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate as useRouterNavigate, useParams } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createWorkspaceState,
  enableSplit,
  openDraft,
  openRun,
  readWorkspaceState,
  resetWorkspaceStateStores,
  writeWorkspaceState,
} from '@/lib/workspace-state'
import type { ViewId } from '@/routes/task-workspace/layout-state'

import { WorkspaceHost } from './workspace-host'

const { toastMock, healthMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  healthMock: vi.fn((): { data: { capabilities: { terminal: boolean } } } => ({
    data: { capabilities: { terminal: false } },
  })),
}))

vi.mock('@/components/ui/toaster', () => ({ toast: toastMock }))
vi.mock('@/api/queries', () => ({ useHealth: healthMock, useRuns: () => ({ data: [] }) }))
vi.mock('@/routes/new-task-surface', () => ({
  NewTaskSurface: ({
    draftId,
    onScheduled,
    onStarted,
  }: {
    draftId: string
    onScheduled: () => void
    onStarted: (created: { id: string }) => void
  }) => (
    <div data-testid="new-task-surface">
      <span>{draftId}</span>
      <button onClick={() => onStarted({ id: 'created-run' })}>Start task</button>
      <button onClick={onScheduled}>Schedule task</button>
    </div>
  ),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  resetWorkspaceStateStores()
  toastMock.mockReset()
  healthMock.mockReturnValue({ data: { capabilities: { terminal: false } } })
  vi.unstubAllGlobals()
})

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function HistoryControls() {
  const navigate = useRouterNavigate()
  return (
    <div>
      <button type="button" onClick={() => void navigate(-1)}>
        History Back
      </button>
      <button type="button" onClick={() => void navigate(1)}>
        History Forward
      </button>
    </div>
  )
}

function ParamReadingWorkspace({ view, runId }: { view?: ViewId; runId?: string }) {
  const { id } = useParams<{ id: string }>()
  return (
    <div data-testid="task-workspace" data-param-id={id}>
      {(runId ?? id)}:{view ?? 'default'}
    </div>
  )
}

function RunHost({ view }: { view?: ViewId }) {
  const { projectId = '', id = '' } = useParams()
  return (
    <WorkspaceHost
      projectId={projectId}
      target={{ kind: 'run', runId: id, ...(view === undefined ? {} : { view }) }}
      renderRun={(activeView, runId) => <ParamReadingWorkspace view={activeView} runId={runId} />}
    />
  )
}

function RunHostWithView() {
  const { view } = useParams<{ view: ViewId }>()
  return <RunHost view={view} />
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/p/:projectId/new"
          element={
            <WorkspaceHost
              projectId="shop"
              target={{ kind: 'draft' }}
              renderRun={(activeView, runId) => <ParamReadingWorkspace view={activeView} runId={runId} />}
            />
          }
        />
        <Route path="/p/:projectId/tasks/:id" element={<RunHost />} />
        <Route path="/p/:projectId/tasks/:id/:view" element={<RunHostWithView />} />
      </Routes>
      <LocationProbe />
      <HistoryControls />
    </MemoryRouter>,
  )
}

describe('WorkspaceHost', () => {
  it('opens the URL run as the selected active pane', async () => {
    renderAt('/p/shop/tasks/run-1')

    await waitFor(() => expect(screen.getByTestId('task-workspace').textContent).toBe('run-1:default'))
    const pane = document.querySelector('[data-slot="workspace-pane"]')!
    expect(pane.getAttribute('data-pane-id')).toBe('run:shop:run-1')
    expect(pane.getAttribute('aria-selected')).toBe('true')
    expect(pane.getAttribute('data-active')).toBe('true')

    fireEvent.pointerDown(pane)
    expect(readWorkspaceState('shop')).toMatchObject({ active: 'run:shop:run-1' })
  })

  it('promotes the draft pane and pushes the created run URL', async () => {
    renderAt('/p/shop/new')

    await screen.findByTestId('new-task-surface')
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/p/shop/tasks/created-run'))
    expect(readWorkspaceState('shop')).toMatchObject({
      active: 'draft:shop',
      threads: [{ kind: 'run', paneId: 'draft:shop', projectId: 'shop', runId: 'created-run' }],
    })
  })

  it('closes a scheduled draft, leaves /new in place, and reports the scheduling result', async () => {
    renderAt('/p/shop/new')

    await screen.findByTestId('new-task-surface')
    fireEvent.click(screen.getByRole('button', { name: 'Schedule task' }))

    await waitFor(() => expect(readWorkspaceState('shop').threads).toEqual([]))
    expect(screen.getByTestId('location').textContent).toBe('/p/shop/new')
    expect(toastMock).toHaveBeenCalledWith('Task scheduled.')
  })

  it('renders two conversation panes side by side with a labelled split tab strip when split is on', async () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    const run3 = { kind: 'run' as const, paneId: 'run:shop:run-3', projectId: 'shop', runId: 'run-3' }
    const initial = enableSplit(openRun(openRun(openRun(createWorkspaceState(), run1), run2), run3), run1.paneId, run2.paneId)
    writeWorkspaceState('shop', initial)

    renderAt('/p/shop/tasks/run-1')

    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(2))
    const panes = screen.getAllByTestId('task-workspace')
    expect(panes[0]!.textContent).toBe('run-1:default')
    expect(panes[1]!.textContent).toBe('run-2:default')

    // Exactly 2 panes visible, run3 is hidden and renders nothing
    const sectionPanes = document.querySelectorAll('[data-slot="workspace-pane"]')
    expect(sectionPanes).toHaveLength(2)
    expect(sectionPanes[0]!.getAttribute('data-pane-id')).toBe('run:shop:run-1')
    expect(sectionPanes[0]!.getAttribute('data-active')).toBe('true')
    expect(sectionPanes[0]!.getAttribute('aria-selected')).toBe('true')
    expect(sectionPanes[1]!.getAttribute('data-pane-id')).toBe('run:shop:run-2')
    expect(sectionPanes[1]!.getAttribute('data-active')).toBeNull()
    expect(sectionPanes[1]!.getAttribute('aria-selected')).toBe('false')

    // Split tab strip exists and labels both panes
    const tabStrip = document.querySelector('[data-slot="split-tab-strip"]')!
    expect(tabStrip).not.toBeNull()
    expect(tabStrip.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Split conversation panes')
    const tabs = tabStrip.querySelectorAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]!.textContent).toContain('run-1')
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]!.textContent).toContain('run-2')
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('false')
  })

  it('switches active pane via pointerdown on pane or tab click', async () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    const initial = enableSplit(openRun(openRun(createWorkspaceState(), run1), run2), run1.paneId, run2.paneId)
    writeWorkspaceState('shop', initial)

    renderAt('/p/shop/tasks/run-1')

    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(2))
    const tabStrip = document.querySelector('[data-slot="split-tab-strip"]')!
    const tabs = tabStrip.querySelectorAll('[role="tab"]')
    const sectionPanes = document.querySelectorAll('[data-slot="workspace-pane"]')

    // Click Tab B to activate pane 2
    fireEvent.click(tabs[1]!)

    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false')
    expect(sectionPanes[1]!.getAttribute('data-active')).toBe('true')
    expect(sectionPanes[1]!.getAttribute('aria-selected')).toBe('true')
    expect(sectionPanes[0]!.getAttribute('data-active')).toBeNull()
    expect(sectionPanes[0]!.getAttribute('aria-selected')).toBe('false')
    expect(readWorkspaceState('shop').active).toBe('run:shop:run-2')
    expect(screen.getByTestId('location').textContent).toBe('/p/shop/tasks/run-2')

    // PointerDown on pane 1 activates pane 1
    fireEvent.pointerDown(sectionPanes[0]!)
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(sectionPanes[0]!.getAttribute('data-active')).toBe('true')
    expect(readWorkspaceState('shop').active).toBe('run:shop:run-1')
    expect(screen.getByTestId('location').textContent).toBe('/p/shop/tasks/run-1')
  })

  it('converges split panes, active pane, and URL across pane switches and browser Back/Forward', async () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    const initial = enableSplit(openRun(openRun(createWorkspaceState(), run1), run2), run1.paneId, run2.paneId)
    writeWorkspaceState('shop', initial)

    renderAt('/p/shop/tasks/run-1')

    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(2))
    const initialPanes = screen.getAllByTestId('task-workspace')
    // Each pane renders its own runId both via renderRun(view, runId) and via scoped useParams().id
    expect(initialPanes[0]!.textContent).toBe('run-1:default')
    expect(initialPanes[0]!.getAttribute('data-param-id')).toBe('run-1')
    expect(initialPanes[1]!.textContent).toBe('run-2:default')
    expect(initialPanes[1]!.getAttribute('data-param-id')).toBe('run-2')
    expect(screen.getByTestId('location').textContent).toBe('/p/shop/tasks/run-1')

    const tabStrip = document.querySelector('[data-slot="split-tab-strip"]')!
    const tabs = tabStrip.querySelectorAll('[role="tab"]')

    // Switch active pane from run-1 to run-2: URL pushes /p/shop/tasks/run-2 and split stays intact
    fireEvent.click(tabs[1]!)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/p/shop/tasks/run-2'))
    expect(readWorkspaceState('shop').active).toBe('run:shop:run-2')
    expect(readWorkspaceState('shop').split).toEqual({ a: 'run:shop:run-1', b: 'run:shop:run-2' })
    const afterSwitchPanes = screen.getAllByTestId('task-workspace')
    expect(afterSwitchPanes[0]!.textContent).toBe('run-1:default')
    expect(afterSwitchPanes[0]!.getAttribute('data-param-id')).toBe('run-1')
    expect(afterSwitchPanes[1]!.textContent).toBe('run-2:default')
    expect(afterSwitchPanes[1]!.getAttribute('data-param-id')).toBe('run-2')

    // Browser Back: URL returns to /p/shop/tasks/run-1 and active pane converges to run-1
    fireEvent.click(screen.getByRole('button', { name: 'History Back' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/p/shop/tasks/run-1'))
    await waitFor(() => expect(readWorkspaceState('shop').active).toBe('run:shop:run-1'))
    expect(readWorkspaceState('shop').split).toEqual({ a: 'run:shop:run-1', b: 'run:shop:run-2' })
    const sectionPanesAfterBack = document.querySelectorAll('[data-slot="workspace-pane"]')
    expect(sectionPanesAfterBack[0]!.getAttribute('data-active')).toBe('true')
    expect(sectionPanesAfterBack[1]!.getAttribute('data-active')).toBeNull()

    // Browser Forward: URL advances to /p/shop/tasks/run-2 and active pane converges to run-2
    fireEvent.click(screen.getByRole('button', { name: 'History Forward' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/p/shop/tasks/run-2'))
    await waitFor(() => expect(readWorkspaceState('shop').active).toBe('run:shop:run-2'))
    expect(readWorkspaceState('shop').split).toEqual({ a: 'run:shop:run-1', b: 'run:shop:run-2' })
    const sectionPanesAfterForward = document.querySelectorAll('[data-slot="workspace-pane"]')
    expect(sectionPanesAfterForward[0]!.getAttribute('data-active')).toBeNull()
    expect(sectionPanesAfterForward[1]!.getAttribute('data-active')).toBe('true')
  })

  it('shows NO tab strip when split is not enabled (1-up mode)', async () => {
    renderAt('/p/shop/tasks/run-1')

    await waitFor(() => expect(screen.getByTestId('task-workspace')).toBeDefined())
    expect(document.querySelector('[data-slot="split-tab-strip"]')).toBeNull()
    expect(document.querySelectorAll('[data-slot="workspace-pane"]')).toHaveLength(1)
  })

  it('unsplit button disables split and returns to 1-up mode', async () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    const initial = enableSplit(openRun(openRun(createWorkspaceState(), run1), run2), run1.paneId, run2.paneId)
    writeWorkspaceState('shop', initial)

    renderAt('/p/shop/tasks/run-1')

    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(2))
    const unsplitBtn = screen.getByRole('button', { name: 'Unsplit' })
    fireEvent.click(unsplitBtn)

    await waitFor(() => expect(document.querySelector('[data-slot="split-tab-strip"]')).toBeNull())
    expect(document.querySelectorAll('[data-slot="workspace-pane"]')).toHaveLength(1)
    expect(readWorkspaceState('shop').split).toBe('none')
  })

  it('closing a tab in split mode returns to 1-up mode with the remaining tab', async () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    const initial = enableSplit(openRun(openRun(createWorkspaceState(), run1), run2), run1.paneId, run2.paneId)
    writeWorkspaceState('shop', initial)

    renderAt('/p/shop/tasks/run-1')

    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(2))
    const closeTab1 = screen.getByRole('button', { name: /close run-1/i })
    fireEvent.click(closeTab1)

    await waitFor(() => expect(document.querySelector('[data-slot="split-tab-strip"]')).toBeNull())
    const remainingPanes = document.querySelectorAll('[data-slot="workspace-pane"]')
    expect(remainingPanes).toHaveLength(1)
    expect(remainingPanes[0]!.getAttribute('data-pane-id')).toBe('run:shop:run-2')
    expect(readWorkspaceState('shop').split).toBe('none')
    expect(readWorkspaceState('shop').active).toBe('run:shop:run-2')
  })

  it('context area follows the active pane only', async () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    const initial = enableSplit(openRun(openRun(createWorkspaceState(), run1), run2), run1.paneId, run2.paneId)
    writeWorkspaceState('shop', initial)

    renderAt('/p/shop/tasks/run-1/changes')

    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(2))
    const panes = screen.getAllByTestId('task-workspace')
    // Active pane (run-1) receives 'changes', inactive pane (run-2) receives 'default'
    expect(panes[0]!.textContent).toBe('run-1:changes')
    expect(panes[1]!.textContent).toBe('run-2:default')
  })

  it('tracks per-pane scroll position and restores on re-mount', async () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    const initial = enableSplit(openRun(openRun(createWorkspaceState(), run1), run2), run1.paneId, run2.paneId)
    writeWorkspaceState('shop', initial)

    renderAt('/p/shop/tasks/run-1')

    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(2))
    const sectionPanes = document.querySelectorAll('[data-slot="workspace-pane"]')
    fireEvent.scroll(sectionPanes[0]!, { target: { scrollTop: 150 } })

    expect(sectionPanes[0]!.getAttribute('data-scroll-anchor')).toBe('150')
  })

  it('picks another open thread from the header button to switch it into split', async () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    const run3 = { kind: 'run' as const, paneId: 'run:shop:run-3', projectId: 'shop', runId: 'run-3' }
    const initial = enableSplit(openRun(openRun(openRun(createWorkspaceState(), run1), run2), run3), run1.paneId, run2.paneId)
    writeWorkspaceState('shop', initial)

    renderAt('/p/shop/tasks/run-1')

    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(2))
    const pickBtn = screen.getByRole('button', { name: /pick another open thread/i })
    fireEvent.pointerDown(pickBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' })

    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'run-3' })).toBeDefined())
    fireEvent.click(screen.getByRole('menuitem', { name: 'run-3' }))

    await waitFor(() => {
      expect(readWorkspaceState('shop').split).toEqual({ a: run1.paneId, b: run3.paneId })
    })
    expect(readWorkspaceState('shop').active).toBe(run3.paneId)
    expect(screen.getByTestId('location').textContent).toBe('/p/shop/tasks/run-3')
    const panes = screen.getAllByTestId('task-workspace')
    expect(panes[0]!.textContent).toBe('run-1:default')
    expect(panes[1]!.textContent).toBe('run-3:default')
  })

  it('does not offer a draft pane in the picker as if it were a run', async () => {
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    const state = enableSplit(
      openDraft(openRun(openRun(createWorkspaceState(), run1), run2), {
        kind: 'draft', paneId: 'draft:shop', projectId: 'shop', draftId: 'default',
      }),
      run1.paneId,
      run2.paneId,
    )
    writeWorkspaceState('shop', state)

    renderAt('/p/shop/tasks/run-1')
    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(2))
    fireEvent.pointerDown(screen.getByRole('button', { name: /pick another open thread/i }), {
      button: 0, ctrlKey: false, pointerType: 'mouse',
    })
    await waitFor(() => expect(screen.getByRole('menu')).toBeDefined())

    expect(screen.getByRole('menuitem', { name: 'No other open threads' })).toBeDefined()
    expect(screen.queryByRole('menuitem', { name: /new task/i })).toBeNull()
    expect(readWorkspaceState('shop').threads).toEqual(state.threads)
    expect(readWorkspaceState('shop').split).toEqual({ a: run1.paneId, b: run2.paneId })
  })

  it('below 1024px shows ONE conversation pane at a time even if split is set, with tabs to switch', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))

    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    const initial = enableSplit(openRun(openRun(createWorkspaceState(), run1), run2), run1.paneId, run2.paneId)
    writeWorkspaceState('shop', initial)

    renderAt('/p/shop/tasks/run-1')

    // Exactly 1 pane rendered below 1024px, no horizontal split overflow
    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(1))
    expect(screen.getByTestId('task-workspace').textContent).toBe('run-1:default')

    const sectionPanes = document.querySelectorAll('[data-slot="workspace-pane"]')
    expect(sectionPanes).toHaveLength(1)
    expect(sectionPanes[0]!.getAttribute('data-pane-id')).toBe('run:shop:run-1')

    // Tab strip is present as simple tabs in conversation header
    const tabStrip = document.querySelector('[data-slot="split-tab-strip"]')!
    expect(tabStrip).not.toBeNull()
    const tabs = tabStrip.querySelectorAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls')!)
      expect(panel?.getAttribute('role')).toBe('tabpanel')
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id)
    }

    // Keyboard navigation keeps one tab in the tab order and activates the matching pane.
    expect(tabs[0]!.getAttribute('tabindex')).toBe('0')
    expect(tabs[1]!.getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' })
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]!.getAttribute('tabindex')).toBe('0')

    await waitFor(() => expect(screen.getByTestId('task-workspace').textContent).toBe('run-2:default'))
    fireEvent.keyDown(tabs[1]!, { key: 'Home' })
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabs[0]!, { key: 'End' })
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    const nextPanes = document.querySelectorAll('[data-slot="workspace-pane"]')
    expect(nextPanes).toHaveLength(1)
    expect(nextPanes[0]!.getAttribute('data-pane-id')).toBe('run:shop:run-2')
  })

  it('below 1024px opens the Context Sheet from the button in the conversation header', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))

    renderAt('/p/shop/tasks/run-1')

    await waitFor(() => expect(screen.getByTestId('task-workspace')).toBeDefined())

    // Header exists and contains the Context button
    const header = document.querySelector('[data-slot="conversation-header"]')!
    expect(header).not.toBeNull()

    const contextButton = screen.getByRole('button', { name: /context views/i })
    expect(contextButton).toBeDefined()

    // Sheet is initially closed
    expect(document.querySelector('[data-slot="context-sheet"]')).toBeNull()

    // Click to open context sheet
    fireEvent.click(contextButton)

    await waitFor(() => expect(document.querySelector('[data-slot="context-sheet"]')).not.toBeNull())

    const contextTabs = within(document.querySelector('[data-slot="context-sheet"]')!).getAllByRole('tab')
    expect(contextTabs.map((tab) => tab.getAttribute('data-view'))).toContain('files-tree')
    expect(contextTabs.map((tab) => tab.getAttribute('data-view'))).toContain('editor')
    expect(contextTabs.map((tab) => tab.getAttribute('data-view'))).not.toContain('terminal')

    // Context sheet renders tabs and content
    const sheetTabs = document.querySelector('[data-slot="context-sheet-tabs"]')!
    expect(sheetTabs).not.toBeNull()

    // Default view is 'changes' (or active target view)
    const activeWorkspacePanes = screen.getAllByTestId('task-workspace')
    expect(activeWorkspacePanes.some((el) => el.textContent === 'run-1:changes')).toBe(true)

    // Click 'Files' tab in context sheet
    const filesTab = within(document.querySelector('[data-slot="context-sheet"]')!).getByRole('tab', { name: 'Files' })
    fireEvent.click(filesTab)

    await waitFor(() => {
      const panes = screen.getAllByTestId('task-workspace')
      expect(panes.some((el) => el.textContent === 'run-1:files')).toBe(true)
    })

    // Close the sheet
    const closeBtn = screen.getByRole('button', { name: /close/i })
    fireEvent.click(closeBtn)

    await waitFor(() => expect(document.querySelector('[data-slot="context-sheet"]')).toBeNull())
  })

  it('passes supported ContextSheet views in mobile split mode and includes Terminal when allowed', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    healthMock.mockReturnValue({ data: { capabilities: { terminal: true } } })
    const run1 = { kind: 'run' as const, paneId: 'run:shop:run-1', projectId: 'shop', runId: 'run-1' }
    const run2 = { kind: 'run' as const, paneId: 'run:shop:run-2', projectId: 'shop', runId: 'run-2' }
    writeWorkspaceState('shop', enableSplit(openRun(openRun(createWorkspaceState(), run1), run2), run1.paneId, run2.paneId))

    renderAt('/p/shop/tasks/run-1')
    await waitFor(() => expect(screen.getAllByTestId('task-workspace')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: /context views/i }))
    await waitFor(() => expect(document.querySelector('[data-slot="context-sheet"]')).not.toBeNull())

    const tabs = within(document.querySelector('[data-slot="context-sheet"]')!).getAllByRole('tab')
    const views = tabs.map((tab) => tab.getAttribute('data-view'))
    expect(views).toContain('files-tree')
    expect(views).toContain('editor')
    expect(views).toContain('terminal')
  })
})
