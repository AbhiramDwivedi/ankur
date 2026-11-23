// The page's workspace store: the workspace list, the one selected workspace's stream and the last
// snapshot of each workspace seen. One stream at a time: select() closes the old stream and opens
// /api/workspaces/<id>/events. A workspace shows only its own state, or null while loading (never another's).
import { cloneWorkspace, getWorkspaces, openWorkspace, stopWorkspace } from './api.ts'
import { createStore } from './store.ts'
import type { Store, StoreDeps } from './store.ts'
import type { Connection, ListResult, OpenResult, RunState, StopResult, WorkspaceItem } from './types.ts'

/** The page refreshes the list this often. */
export const LIST_POLL_MS = 2000

/** The id of the one repository of a single-repo server (it answers 404 to /api/workspaces): its routes are the un-scoped ones. */
export const SINGLE_ID = ''

export interface WorkspaceView {
  id: string | null
  /** The selected workspace's own state: null until its first snapshot (unless seen before). */
  state: RunState | null
  loading: boolean
}

export interface ListView {
  items: WorkspaceItem[] | null
  /** The last list request failed (not 401 or 403). */
  error: boolean
  /** 401 or 403: the page link is gone. The poll has stopped and does not retry. */
  expired: boolean
  /** Set (only) when the server answered 404: it is the single-repo form, so there is no list and no rail. */
  single?: true
}

export interface WorkspaceDeps extends StoreDeps {
  fetchList?: () => Promise<ListResult>
  openDir?: (path: string) => Promise<OpenResult>
  cloneDir?: (url: string, parent: string) => Promise<OpenResult>
  stopWorkspace?: (id: string) => Promise<StopResult>
}

export interface WorkspaceStore {
  select(id: string | null): void
  getView(): WorkspaceView
  getConnection(): Connection
  getLastMessageAt(): number | null
  getList(): ListView
  /** Starts the 2 s list poll (and one request now). Stops on 401 or 403. */
  startList(): void
  /** One list request now; a retry after an error. Does nothing once expired. */
  refreshList(): Promise<void>
  /** Opens a directory (15 s abort). On success the list holds the workspace. */
  openDirectory(path: string): Promise<OpenResult>
  /** Clones a repository into <parent>/<name> and opens it. On success the list holds the workspace. */
  cloneRepository(url: string, parent: string): Promise<OpenResult>
  /** Stops a workspace's session and puts the answer's item in the list. */
  stopSession(id: string): Promise<StopResult>
  subscribe(fn: () => void): () => void
  stop(): void
}

export function createWorkspaceStore(deps: WorkspaceDeps): WorkspaceStore {
  const subscribers = new Set<() => void>()
  const snapshots = new Map<string, RunState>()
  let id: string | null = null
  let inner: Store | null = null
  let unsubInner: (() => void) | null = null
  let list: ListView = { items: null, error: false, expired: false }
  let poll: unknown = null
  let polling = false
  const fetchList = deps.fetchList ?? getWorkspaces
  const doOpen = deps.openDir ?? openWorkspace
  const doClone = deps.cloneDir ?? cloneWorkspace
  const doStop = deps.stopWorkspace ?? stopWorkspace
  const usingDefaultTimer = deps.setTimer === undefined
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))

  function notify(): void {
    for (const fn of [...subscribers]) fn()
  }

  function currentState(): RunState | null {
    if (id === null) return null
    return inner?.getState() ?? snapshots.get(id) ?? null
  }

  function closeInner(): void {
    unsubInner?.()
    unsubInner = null
    inner?.stop()
    inner = null
  }

  function setList(items: WorkspaceItem[]): void {
    list = { items, error: false, expired: false }
  }

  function putItem(item: WorkspaceItem): void {
    const items = list.items ?? []
    const at = items.findIndex((w) => w.id === item.id)
    setList(at < 0 ? [...items, item] : items.map((w, i) => (i === at ? item : w)))
  }

  async function refreshList(): Promise<void> {
    if (list.expired) return
    const r = await fetchList()
    if (list.expired) return
    if (r.ok) setList(r.workspaces)
    else if (r.status === 404) {
      // The single-repo server has no /api/workspaces: the page is the one repository on the un-scoped routes, and the list is never asked again.
      list = { items: null, error: false, expired: false, single: true }
      polling = false
      api.select(SINGLE_ID)
    } else list = { items: list.items, error: !r.expired, expired: r.expired }
    notify()
  }

  function schedule(): void {
    if (!polling || list.expired) return
    poll = setTimer(() => {
      void refreshList().then(schedule)
    }, LIST_POLL_MS)
  }

  const api: WorkspaceStore = {
    select(next) {
      if (next === id) return
      closeInner()
      id = next
      if (next !== null) {
        const mine = next
        // The inner store's own state is per stream: a new store per selection cannot carry a stale one over.
        const s = createStore({ ...deps, eventsUrl: mine === SINGLE_ID ? '/api/events' : `/api/workspaces/${mine}/events` })
        inner = s
        unsubInner = s.subscribe(() => {
          const st = s.getState()
          if (st !== null) snapshots.set(mine, st)
          notify()
        })
        s.start()
      }
      notify()
    },
    getView() {
      if (id === null) return { id: null, state: null, loading: false }
      const state = currentState()
      return { id, state, loading: state === null }
    },
    getConnection() {
      return inner?.getConnection() ?? 'connecting'
    },
    getLastMessageAt() {
      return inner?.getLastMessageAt() ?? null
    },
    getList() {
      return list
    },
    startList() {
      if (polling) return
      polling = true
      void refreshList().then(schedule)
    },
    refreshList,
    async openDirectory(path) {
      const r = await doOpen(path)
      if (r.ok) {
        putItem(r.workspace)
        notify()
      }
      return r
    },
    async cloneRepository(url, parent) {
      const r = await doClone(url, parent)
      if (r.ok) {
        putItem(r.workspace)
        notify()
      }
      return r
    },
    async stopSession(wid) {
      const r = await doStop(wid)
      if (r.ok) {
        putItem(r.workspace)
        notify()
      }
      return r
    },
    subscribe(fn) {
      subscribers.add(fn)
      return () => {
        subscribers.delete(fn)
      }
    },
    stop() {
      polling = false
      if (poll !== null && usingDefaultTimer) clearTimeout(poll as ReturnType<typeof setTimeout>)
      poll = null
      closeInner()
      id = null
    },
  }
  return api
}

let page: WorkspaceStore | null = null

export function pageWorkspaces(): WorkspaceStore {
  if (page === null) {
    page = createWorkspaceStore({
      open: (url) => new EventSource(url),
      reload: () => location.reload(),
    })
  }
  return page
}
