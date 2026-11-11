import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readWorkspaceState, resetWorkspaceStateStores } from '@/lib/workspace-state'
import type { ViewId } from '@/routes/task-workspace/layout-state'

import { WorkspaceHost } from './workspace-host'

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }))

vi.mock('@/components/ui/toaster', () => ({ toast: toastMock }))
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
})

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function RunHost({ view }: { view?: ViewId }) {
  const { projectId = '', id = '' } = useParams()
  return (
    <WorkspaceHost
      projectId={projectId}
      target={{ kind: 'run', runId: id, ...(view === undefined ? {} : { view }) }}
      renderRun={(activeView) => <div data-testid="task-workspace">{id}:{activeView ?? 'default'}</div>}
    />
  )
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/p/:projectId/new"
          element={<WorkspaceHost projectId="shop" target={{ kind: 'draft' }} renderRun={() => null} />}
        />
        <Route path="/p/:projectId/tasks/:id" element={<RunHost />} />
      </Routes>
      <LocationProbe />
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
})
