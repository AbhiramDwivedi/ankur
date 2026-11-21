// ui-workspaces: the registry of open workspaces. One store and one session per workspace, in memory only.
// Imports ui-state and ui-session through their index.ts and nothing from the plugin.
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { ankurDirFor } from '../state/index.ts'
import type { Store, createStore as CreateStore } from '../state/index.ts'
import { endTree } from '../session/index.ts'
import type { Session, SessionControl, createSession as CreateSession } from '../session/index.ts'
import { checkRepoPath } from './open.ts'
import type { GitRun, OpenError } from './open.ts'

export type WorkspaceStatus = 'not-started' | 'idle' | 'working' | 'waiting' | 'finished' | 'stopping' | 'stopped' | 'failed'

export interface WorkspaceItem {
  id: string
  name: string
  path: string
  status: WorkspaceStatus
  reason: string | null // set only when status is 'failed'
  openRequests: number
  session: boolean // a session process exists: only then can it be stopped
}

export interface Workspace {
  item(): WorkspaceItem
  state: Store // this workspace's store
  control: SessionControl // sends to the current session, starting a new one when needed
}

export interface Workspaces {
  list(): WorkspaceItem[] // in open order
  open(path: unknown): Promise<{ ok: true; workspace: WorkspaceItem; existed: boolean } | { ok: false; error: OpenError }>
  openRepo(path: string, ankurDir?: string): WorkspaceItem // --repo: no git check
  get(id: string): Workspace | null
  primary(): Workspace | null // the --repo workspace, or null
  stop(id: string): Promise<{ ok: true; workspace: WorkspaceItem } | { ok: false; error: 'workspace' }>
  closeAll(): Promise<void>
}

export interface WorkspaceDeps {
  pluginPath: string
  claudeDir: string
  createStore: typeof CreateStore
  createSession: typeof CreateSession
  git?: GitRun // 10 s timeout
  platform?: NodeJS.Platform
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void
  treeKill?: (pid: number) => void
}

const CLOSE_MS = 5000 // how long stop waits for session.close()
const CLOSE_ALL_MS = 2000 // the same inside a shutdown, which the server forces to exit after 5 s
const CLOSE_ALL_GRACE_MS = 1500

export const workspaceId = (p: string): string => 'w' + createHash('sha256').update(p).digest('hex').slice(0, 12)

interface Entry {
  id: string
  name: string
  path: string
  store: Store
  ankurDirFlag: string | undefined
  session: Session // always set by attach() before the entry is stored
  stopped: boolean // stop() finished and no message has started a new session since
  stopping: Promise<void> | null
  lastSessionId: string | null
}

const oneLine = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0]!

function withTimeout<T>(p: Promise<T>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    p.then(
      () => { clearTimeout(timer); resolve() },
      () => { clearTimeout(timer); resolve() },
    )
  })
}

export function createWorkspaces(deps: WorkspaceDeps): Workspaces {
  const entries = new Map<string, Entry>()
  let primaryId: string | null = null
  let storesClosed = false

  // The run as the store holds it: a typed goal starts /ankur:run only when no plan is live.
  const liveRun = (e: Entry) => (e.store.snapshot().state as { run?: { version: number | null; crews: { slug: string }[] } | null }).run ?? null

  // Starts a session for `e`, wired the way main.ts wired the single one: subscribe, setSession, ankurDirFor on each new id.
  function attach(e: Entry): void {
    const session = deps.createSession({
      repo: e.path,
      pluginPath: deps.pluginPath,
      claudeDir: deps.claudeDir,
      hasPlan: () => { const r = liveRun(e); return r !== null && r.version !== null },
      crewSlugs: () => liveRun(e)?.crews.map((c) => c.slug) ?? [],
    })
    e.session = session
    e.stopped = false
    e.lastSessionId = null
    session.subscribe((view) => {
      if (e.session !== session || storesClosed) return // a replaced session's late views are dropped
      e.store.setSession(view)
      const id = view.session.sessionId
      if (e.ankurDirFlag === undefined && id && id !== e.lastSessionId) {
        e.lastSessionId = id
        ankurDirFor(e.path, id).then(
          (dir) => { if (e.lastSessionId === id && e.session === session && !storesClosed) e.store.setAnkurDir(dir) },
          (err) => process.stderr.write(`ankur dir lookup failed: ${oneLine(err)}\n`),
        )
      }
    })
  }

  function create(p: string, ankurDir: string | undefined): Entry {
    const id = workspaceId(p)
    const store = deps.createStore(ankurDir === undefined ? { repo: p, pluginPath: deps.pluginPath, claudeDir: deps.claudeDir } : { repo: p, pluginPath: deps.pluginPath, claudeDir: deps.claudeDir, ankurDir })
    const e = { id, name: path.basename(p) || p, path: p, store, ankurDirFlag: ankurDir, stopped: false, stopping: null, lastSessionId: null } as unknown as Entry
    attach(e)
    entries.set(id, e)
    return e
  }

  // The first of these that holds.
  function item(e: Entry): WorkspaceItem {
    const s = e.store.snapshot().state as any
    const requests: any[] = Array.isArray(s.requests) ? s.requests : []
    const cards = requests.filter((r) => r.status === 'open' && (r.kind === 'question' || r.kind === 'permission')).length
    const inbox = typeof s.inbox?.open === 'number' ? s.inbox.open : 0
    const openRequests = cards + inbox
    const status = s.session?.status as string | undefined
    const transcript: unknown[] = Array.isArray(s.transcript) ? s.transcript : []
    const live = transcript.length > 0 || (status !== undefined && status !== 'idle')
    const base = { id: e.id, name: e.name, path: e.path, openRequests, session: live && !e.stopped }
    if (e.stopping !== null) return { ...base, status: 'stopping', reason: null }
    if (!e.stopped && (status === 'error' || status === 'ended')) {
      return { ...base, status: 'failed', reason: status === 'error' ? (s.session.error ?? 'the session failed') : 'the session ended' }
    }
    if (e.stopped) return { ...base, status: 'stopped', reason: null }
    const run = s.run ?? null
    const crews: { status: string | null }[] = run?.crews ?? []
    const allDone = crews.length > 0 && crews.every((c) => c.status === 'merged' || c.status === 'dropped')
    if (!live) {
      if (allDone) return { ...base, status: 'finished', reason: null }
      if (openRequests > 0) return { ...base, status: 'waiting', reason: null }
      return { ...base, status: run !== null ? 'idle' : 'not-started', reason: null }
    }
    // The rule of runStatus in ui/app/views/shell/runStatus.ts, copied here.
    if (run === null && transcript.length === 0) return { ...base, status: 'not-started', reason: null }
    const waiting = requests.some((r) => r.status === 'open') || (status === 'waiting' && (s.session.backgroundTasks?.length ?? 0) === 0)
    if (waiting) return { ...base, status: 'waiting', reason: null }
    if (allDone && status !== 'running') return { ...base, status: 'finished', reason: null }
    return { ...base, status: 'working', reason: null }
  }

  const control = (e: Entry): SessionControl => ({
    send(text, intent) {
      // Refuse a bad message before it replaces a session: the stopped conversation must stay on the page.
      if (intent !== undefined && intent !== null && intent !== 'goal' && intent !== 'add') return { ok: false, error: 'intent' }
      if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'text' }
      if (e.stopping !== null) return { ok: false, error: 'ended' }
      const status = (e.store.snapshot().state as any).session?.status
      if (e.stopped || status === 'error' || status === 'ended') {
        const old = e.session
        const pid = e.stopped ? null : old.pid()
        attach(e)
        // A session that failed on its own: end whatever it left running. A stopped one was ended by stop().
        void old.close().catch(() => {})
        if (pid !== null) void endTree(pid, { platform: deps.platform, kill: deps.kill, treeKill: deps.treeKill }).catch(() => {})
      }
      return e.session.send(text, intent)
    },
    answer: (id, body) => e.session.answer(id, body),
  })

  function view(e: Entry): Workspace {
    return { item: () => item(e), state: e.store, control: control(e) }
  }

  function stopEntry(e: Entry, closeMs: number, graceMs?: number): Promise<void> {
    if (e.stopping !== null) return e.stopping
    if (e.stopped) return Promise.resolve()
    const session = e.session
    const run = async () => {
      const pid = session.pid()
      await withTimeout(session.close(), closeMs)
      if (pid !== null) {
        try {
          await endTree(pid, { platform: deps.platform, kill: deps.kill, treeKill: deps.treeKill, ...(graceMs === undefined ? {} : { graceMs }) })
        } catch (err) {
          process.stderr.write(`ankur-ui: ending the process tree of ${e.name} failed: ${oneLine(err)}\n`)
        }
      }
    }
    const p = run().finally(() => {
      if (e.session === session) e.stopped = true
      e.stopping = null
    })
    e.stopping = p
    return p
  }

  return {
    list: () => [...entries.values()].map(item),
    async open(typed) {
      const r = await checkRepoPath(typed, deps.git)
      if (!r.ok) return r
      // No await from here to the set below, so two opens of one path cannot both create a workspace.
      const existing = entries.get(workspaceId(r.path))
      if (existing) return { ok: true, workspace: item(existing), existed: true }
      return { ok: true, workspace: item(create(r.path, undefined)), existed: false }
    },
    openRepo(p, ankurDir) {
      let real = path.resolve(p)
      try { real = realpathSync(real) } catch { /* not there yet: keep it as given */ }
      const existing = entries.get(workspaceId(real))
      const e = existing ?? create(real, ankurDir)
      if (primaryId === null) primaryId = e.id
      return item(e)
    },
    get(id) {
      const e = entries.get(id)
      return e ? view(e) : null
    },
    primary() {
      const e = primaryId === null ? undefined : entries.get(primaryId)
      return e ? view(e) : null
    },
    async stop(id) {
      const e = entries.get(id)
      if (!e) return { ok: false, error: 'workspace' }
      await stopEntry(e, CLOSE_MS)
      return { ok: true, workspace: item(e) }
    },
    async closeAll() {
      await Promise.all([...entries.values()].map((e) => stopEntry(e, CLOSE_ALL_MS, CLOSE_ALL_GRACE_MS)))
      if (storesClosed) return
      storesClosed = true
      for (const e of entries.values()) e.store.close()
    },
  }
}
