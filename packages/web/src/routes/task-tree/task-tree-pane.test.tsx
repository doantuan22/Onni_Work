import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApiRun } from '@onni/api-client'
import { createQueryClient } from '@/api/query-client'
import type { SubagentSummary } from '@/routes/task-thread/subagent-dock'

import { TaskTreePane } from './task-tree-pane'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubFetch(runs?: ApiRun[], fail = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (fail) {
        return new Response(JSON.stringify({ error: 'task service unavailable' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/runs')) {
        return new Response(JSON.stringify(runs ?? []), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function makeRun(id: string, overrides: Partial<ApiRun> = {}): ApiRun {
  return {
    id,
    projectId: 'p1',
    title: `Task ${id}`,
    status: 'running',
    workflow: 'default',
    createdAt: '2026-11-11T00:00:00Z',
    archived: false,
    lastActivityAt: '2026-11-11T00:00:00Z',
    ...overrides,
  } as ApiRun
}

function renderTree(props: Partial<React.ComponentProps<typeof TaskTreePane>> = {}) {
  const onOpenRun = vi.fn()
  const onOpenSubagent = vi.fn()
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <TaskTreePane
        runId="manager-1"
        onOpenRun={onOpenRun}
        onOpenSubagent={onOpenSubagent}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { ...view, onOpenRun, onOpenSubagent }
}

describe('TaskTreePane', () => {
  it('shows the empty prompt when no dispatched tasks or runner subagents exist', () => {
    stubFetch([])
    renderTree({ runs: [makeRun('manager-1')] })

    expect(screen.getByText('No subtasks or runner subagents')).toBeTruthy()
    expect(document.querySelector('[data-slot="tree-empty"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="centered-state"]')?.getAttribute('data-tone')).toBe('neutral')
    expect(document.querySelector('[data-slot="task-tree-content"]')).toBeNull()
  })

  it('shows distinct error state when runs query fails', async () => {
    stubFetch(undefined, true)
    renderTree()

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Could not load task tree' })).toBeTruthy(),
    )
    expect(screen.queryByText('No subtasks or runner subagents')).toBeNull()
    expect(document.querySelector('[data-slot="tree-error"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="centered-state"]')?.getAttribute('data-tone')).toBe('danger')
  })

  it('renders the manager->worker tree of persistent dispatched child runs with full row attributes', () => {
    stubFetch()
    const runs: ApiRun[] = [
      makeRun('manager-1', {
        title: 'Manager Root Task',
        runner: 'claude',
        model: 'opus-4',
        roster: [{ name: 'worker-1', runner: 'codex' }] as unknown as ApiRun['roster'],
        dispatch: { rootRunId: 'manager-1' },
      }),
      makeRun('worker-1', {
        title: 'Worker Implement Feature',
        runner: 'codex',
        model: 'gpt-5',
        branch: 'onni/feat-worker-1',
        status: 'done',
        diffStat: { adds: 42, dels: 10, files: 5 },
        dispatch: {
          rootRunId: 'manager-1',
          parentRunId: 'manager-1',
          report: {
            status: 'done',
            result: 'Completed implementation\nDetailed evidence follows',
            evidence: ['test passed'],
            checks: [],
            errors: [],
            side_effects: [],
            suggestions: [],
          },
        },
      }),
      makeRun('worker-2', {
        title: 'Worker Nested Review',
        runner: 'antigravity',
        status: 'failed',
        diffStat: { adds: 2, dels: 0, files: 1 },
        dispatch: {
          rootRunId: 'manager-1',
          parentRunId: 'worker-1',
          report: {
            status: 'failed',
            result: 'Tests failed on edge case',
            evidence: [],
            checks: [],
            errors: ['SyntaxError'],
            side_effects: [],
            suggestions: [],
          },
        },
      }),
    ]

    const { onOpenRun } = renderTree({ runs, runId: 'worker-1' })

    const rows = document.querySelectorAll('[data-slot="task-tree-row"]')
    expect(rows.length).toBe(3)

    // Check manager root row (depth 0)
    expect(rows[0]?.getAttribute('data-depth')).toBe('0')
    expect(rows[0]?.getAttribute('data-run-id')).toBe('manager-1')
    expect(rows[0]?.textContent).toContain('Manager Root Task')
    expect(rows[0]?.querySelector('[data-slot="backend-chip"]')?.textContent).toContain('claude')

    // Check worker-1 row (depth 1)
    expect(rows[1]?.getAttribute('data-depth')).toBe('1')
    expect(rows[1]?.getAttribute('data-run-id')).toBe('worker-1')
    expect(rows[1]?.getAttribute('data-current')).toBe('true')
    expect(rows[1]?.textContent).toContain('Worker Implement Feature')
    expect(rows[1]?.querySelector('[data-slot="backend-chip"]')?.textContent).toContain('codex')
    expect(rows[1]?.querySelector('[data-slot="branch-chip"]')?.textContent).toContain('onni/feat-worker-1')
    expect(rows[1]?.querySelector('[data-slot="report-summary"]')?.textContent).toBe('Completed implementation')
    expect(rows[1]?.querySelector('[data-slot="changed-files-count"]')?.textContent).toBe('5 files')
    expect(rows[1]?.querySelector('[data-slot="status-dot"]')).not.toBeNull()

    // Check worker-2 row (depth 2)
    expect(rows[2]?.getAttribute('data-depth')).toBe('2')
    expect(rows[2]?.getAttribute('data-run-id')).toBe('worker-2')
    expect(rows[2]?.textContent).toContain('Worker Nested Review')
    expect(rows[2]?.querySelector('[data-slot="backend-chip"]')?.textContent).toContain('antigravity')
    expect(rows[2]?.querySelector('[data-slot="report-summary"]')?.textContent).toBe('Tests failed on edge case')
    expect(rows[2]?.querySelector('[data-slot="changed-files-count"]')?.textContent).toBe('1 file')

    // Test click on run row
    fireEvent.click(rows[1]!)
    expect(onOpenRun).toHaveBeenCalledWith('worker-1')

    // Test keyboard activation on run row
    fireEvent.keyDown(rows[2]!, { key: 'Enter' })
    expect(onOpenRun).toHaveBeenCalledWith('worker-2')
  })

  it('renders runner subagents in a separate section from subagent-dock data', () => {
    stubFetch()
    const runs: ApiRun[] = [
      makeRun('manager-1', {
        title: 'Manager Root Task',
        dispatch: { rootRunId: 'manager-1' },
      }),
      makeRun('worker-1', {
        title: 'Dispatched Worker',
        dispatch: { rootRunId: 'manager-1', parentRunId: 'manager-1' },
      }),
    ]

    const subagents: SubagentSummary[] = [
      {
        id: 'subagent-task-1',
        title: 'Investigate failing tests',
        agentType: 'code-reviewer',
        status: 'completed',
        toolCalls: 4,
        activity: 'Ran vitest test suite',
      },
      {
        id: 'subagent-task-2',
        title: 'Refactor store',
        status: 'running',
        toolCalls: 2,
        activity: 'Writing unit test',
      },
    ]

    const { onOpenSubagent } = renderTree({ runs, subagents })

    const subagentSection = document.querySelector('[data-slot="runner-subagents-section"]')
    expect(subagentSection).not.toBeNull()

    const subagentRows = document.querySelectorAll('[data-slot="runner-subagent-row"]')
    expect(subagentRows.length).toBe(2)

    // First subagent row
    expect(subagentRows[0]?.getAttribute('data-subagent-id')).toBe('subagent-task-1')
    expect(subagentRows[0]?.querySelector('[data-slot="subagent-title"]')?.textContent).toBe('Investigate failing tests')
    expect(subagentRows[0]?.querySelector('[data-slot="subagent-type"]')?.textContent).toBe('code-reviewer')
    expect(subagentRows[0]?.querySelector('[data-slot="subagent-activity"]')?.textContent).toBe('Ran vitest test suite')
    expect(subagentRows[0]?.querySelector('[data-slot="subagent-tool-calls"]')?.textContent).toBe('4 tools')

    // Second subagent row
    expect(subagentRows[1]?.getAttribute('data-subagent-id')).toBe('subagent-task-2')
    expect(subagentRows[1]?.querySelector('[data-slot="subagent-title"]')?.textContent).toBe('Refactor store')
    expect(subagentRows[1]?.querySelector('[data-slot="subagent-type"]')).toBeNull()
    expect(subagentRows[1]?.querySelector('[data-slot="subagent-activity"]')?.textContent).toBe('Writing unit test')
    expect(subagentRows[1]?.querySelector('[data-slot="subagent-tool-calls"]')?.textContent).toBe('2 tools')

    // Click subagent row
    fireEvent.click(subagentRows[0]!)
    expect(onOpenSubagent).toHaveBeenCalledWith('subagent-task-1')
  })

  it('never merges the counts between dispatched child runs and runner subagents', () => {
    stubFetch()
    const runs: ApiRun[] = [
      makeRun('manager-1', {
        title: 'Manager Root',
        dispatch: { rootRunId: 'manager-1' },
      }),
      makeRun('worker-1', {
        title: 'Child 1',
        dispatch: { rootRunId: 'manager-1', parentRunId: 'manager-1' },
      }),
      makeRun('worker-2', {
        title: 'Child 2',
        dispatch: { rootRunId: 'manager-1', parentRunId: 'manager-1' },
      }),
      makeRun('worker-3', {
        title: 'Child 3',
        dispatch: { rootRunId: 'manager-1', parentRunId: 'manager-1' },
      }),
    ]

    const subagents: SubagentSummary[] = [
      {
        id: 'agent-1',
        title: 'Single Runner Subagent',
        status: 'running',
        toolCalls: 1,
      },
    ]

    renderTree({ runs, subagents })

    const dispatchedCountEl = document.querySelector('[data-slot="dispatched-count"]')
    const subagentCountEl = document.querySelector('[data-slot="runner-subagents-count"]')

    expect(dispatchedCountEl).not.toBeNull()
    expect(subagentCountEl).not.toBeNull()

    // Dispatched child runs count is 3 (worker-1, worker-2, worker-3)
    expect(dispatchedCountEl?.textContent?.trim()).toBe('3')

    // Runner subagents count is 1 (agent-1)
    expect(subagentCountEl?.textContent?.trim()).toBe('1')

    // Verify there is no merged "4" anywhere in section count slots
    expect(document.querySelector('[data-slot="dispatched-count"]')?.textContent).not.toBe('4')
    expect(document.querySelector('[data-slot="runner-subagents-count"]')?.textContent).not.toBe('4')
  })

  it('uses uniform h-header token and single-line truncating classes', () => {
    stubFetch()
    const runs: ApiRun[] = [
      makeRun('manager-1', {
        title: 'Manager',
        dispatch: { rootRunId: 'manager-1' },
      }),
      makeRun('worker-1', {
        title: 'Worker',
        branch: 'onni/test-branch',
        dispatch: { rootRunId: 'manager-1', parentRunId: 'manager-1' },
      }),
    ]

    renderTree({ runs })

    const header = document.querySelector('header')
    expect(header?.className).toContain('h-header')
    expect(header?.className).toContain('min-h-header')

    const rows = document.querySelectorAll('[data-slot="task-tree-row"]')
    expect(rows[0]?.className).toContain('min-w-0')
    expect(rows[0]?.querySelector('[data-slot="task-title"]')?.className).toContain('truncate')
    expect(rows[1]?.querySelector('[data-slot="branch-chip"]')?.className).toContain('truncate')
  })
})
