import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

import { reloadForStaleBuild } from './stale-build'

/** `lazy` for a route chunk: a stale shell after an update keeps its fallback up while the page
 *  reloads, instead of throwing "Importing a module script failed." at the router. */
export function lazyRoute<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return lazy(() =>
    load().catch((error: unknown) => {
      if (reloadForStaleBuild()) return new Promise<never>(() => {})
      throw error
    }),
  )
}
