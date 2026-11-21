// React's view of the store: narrow selectors over useSyncExternalStore.
import { useSyncExternalStore } from 'react'
import { pageStore } from './store.ts'
import { pageWorkspaces } from './workspaces.ts'
import type { ListView, WorkspaceStore, WorkspaceView } from './workspaces.ts'
import type { Connection, RunState } from './types.ts'

/**
 * Reads one slice of the run. The selector must return a value that is stable between calls while the
 * state is unchanged: pick a field or an array the store holds, never build a new object or array in it.
 */
export function useRun<T>(select: (s: RunState | null) => T): T {
  const store = pageStore()
  return useSyncExternalStore(store.subscribe, () => select(store.getState()))
}

/** The link to the run: connecting, live or reconnecting. */
export function useConnection(): Connection {
  const store = pageStore()
  return useSyncExternalStore(store.subscribe, store.getConnection)
}

/** The selected workspace (id, state or loading) and the list: views read these, never the un-scoped store. */
export function useWorkspaceView(): WorkspaceView {
  const store = pageWorkspaces()
  return useSyncExternalStore(store.subscribe, () => cachedView(store))
}

export function useWorkspaceList(): ListView {
  const store = pageWorkspaces()
  return useSyncExternalStore(store.subscribe, store.getList)
}

let lastView: WorkspaceView | null = null
// getView builds a new object each call; useSyncExternalStore needs a stable one while nothing changed.
function cachedView(store: WorkspaceStore): WorkspaceView {
  const v = store.getView()
  if (lastView !== null && lastView.id === v.id && lastView.state === v.state && lastView.loading === v.loading) return lastView
  lastView = v
  return v
}
