import { CompassIcon } from 'lucide-react'
import { CenteredState } from '@/components/centered-state'
import { useI18n } from '@/lib/i18n'
import { Link } from '@/lib/project-router'
import { Button } from '@/components/ui/button'

/** The 404. Neutral, not danger — a mistyped URL is a dead end, not a failure of ours —
 *  and the one action is the way home (spec, "Routing": unknown routes → CenteredState 404
 *  with a "Back to tasks" action). */
export function NotFoundRoute() {
  const { t } = useI18n()
  return (
    <div data-route="not-found" className="flex min-h-full flex-col">
      <CenteredState
        icon={<CompassIcon />}
        tone="neutral"
        title={t('Page not found')}
        subtitle={t(
          'Nothing lives at this address. The link may be mistyped, or it points at something that is gone.',
        )}
        actions={
          <Button asChild variant="outline">
            <Link to="/">{t('Back to tasks')}</Link>
          </Button>
        }
      />
    </div>
  )
}
