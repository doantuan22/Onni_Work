import { useNavigate } from '@/lib/project-router'

import { useProjectScope } from '@/api/project-scope-context'
import { clearStartedDraft } from './new-task-draft'
import { startedRunPath } from './new-task-form'
import { NewTaskSurface } from './new-task-surface'

/** Route adapter for the default draft pane. Pane hosts supply their own completion actions. */
export function NewTaskRoute() {
  const navigate = useNavigate()
  const draftProjectId = useProjectScope().projectId

  return (
    <NewTaskSurface
      projectId={draftProjectId}
      draftId="default"
      onStarted={(created) => {
        clearStartedDraft(draftProjectId, 'default')
        void navigate(startedRunPath(created))
      }}
      onScheduled={() => {}}
      onProjectSwitch={(next) => {
        void navigate(`/p/${encodeURIComponent(next)}/new`, { replace: true })
      }}
    />
  )
}
