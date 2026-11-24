// The page. App is the only reader of the workspace store: it passes { state, now } of the one current workspace to
// every area root, so no area shows another workspace's conversation, crews, decisions or requests.
// From 1024 px the page is the viewport (no page scroll): the workspace rail (232 px), the centre (header, summary strip,
// tabs; the tab panel is the only part that scrolls) and a side column (Your move, then Crews) of 320 px, 376 px from 1280.
// Below 1024 px there is one column and the page scrolls: the workspace switcher, header, Your move, summary strip,
// Crews, tabs.
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Notice } from './components/ui/notice.tsx'
import { Skeleton } from './components/ui/skeleton.tsx'
import { useWorkspaceList, useWorkspaceView } from './store/react.ts'
import { pageWorkspaces, SINGLE_ID } from './store/workspaces.ts'
import type { Connection, RunState, WorkspaceItem } from './store/types.ts'
import { Composer } from './views/composer/Composer.tsx'
import { BuildNetwork } from './views/crews/BuildNetwork.tsx'
import { GOAL_BOX_ID, reasonOf } from './views/move/format.ts'
import { YourMove } from './views/move/YourMove.tsx'
import { Banner } from './views/shell/Banner.tsx'
import { ResumePanel } from './views/resume/ResumePanel.tsx'
import { OverviewTabs } from './views/shell/OverviewTabs.tsx'
import { SkipLink } from './views/shell/SkipLink.tsx'
import { SummaryStrip } from './views/shell/SummaryStrip.tsx'
import { useInstantThemeSwitch } from './views/shell/instantTheme.ts'
import { useLinkTimers } from './views/shell/useLinkTimers.ts'
import { useWide } from './views/shell/useWide.ts'
import { noSessionWord, workspaceStatusLabel } from './views/status/status.ts'
import { Transcript, type Lifecycle } from './views/transcript/Transcript.tsx'
import { homeRelative, stageOf } from './views/workspaces/format.ts'
import { OpenDirectory } from './views/workspaces/OpenDirectory.tsx'
import { WorkspaceRail } from './views/workspaces/WorkspaceRail.tsx'
import type { StopLocal } from './views/workspaces/WorkspaceRow.tsx'

const TICK_MS = 1000

/** Wall-clock milliseconds, updated once a second, so every clock on the page agrees. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** The link to the current workspace's stream. */
function useWorkspaceConnection(): Connection {
  const store = pageWorkspaces()
  return useSyncExternalStore(store.subscribe, store.getConnection, () => 'live' as Connection)
}

const stripSlash = (p: string) => p.replace(/[\\/]+$/, '')

/** The one-shot note above the conversation after S2 succeeds (UX direction S3). */
function noteFor(w: WorkspaceItem, existed: boolean, typed: string): string {
  if (!existed) return `Opened ${w.name}. Its session starts with the first goal you type.`
  const t = stripSlash(typed)
  const same = t === stripSlash(w.path) || t === stripSlash(homeRelative(w.path))
  return same ? `${w.name} is already open. Switched to it.` : `${typed} is inside ${w.name}, which is already open. Switched to it.`
}

// Alt+Up and Alt+Down are the page's keys from anywhere but a text field, which keeps them (Alt+Down opens a select's list,
// Option+Up moves a caret on macOS). The composer does not take focus back from a row after a switch, so no field is exempt.
const isTyping = (t: EventTarget | null): boolean =>
  t instanceof Element && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null

/** A workspace with no run and no conversation yet: the composer is where it starts. */
const isFresh = (s: RunState): boolean => s.run === null && s.transcript.length === 0

export default function App() {
  const store = pageWorkspaces()
  const list = useWorkspaceList()
  const view = useWorkspaceView()
  const connection = useWorkspaceConnection()
  const now = useNow()
  const wide = useWide()
  const { slow } = useLinkTimers(connection)
  useInstantThemeSwitch()

  const [showOpen, setShowOpen] = useState(false)
  const [note, setNote] = useState<{ id: string; text: string } | null>(null)
  const [stops, setStops] = useState<Record<string, StopLocal>>({})
  const [stoppedAt, setStoppedAt] = useState<Record<string, number>>({})
  const [announcement, setAnnouncement] = useState('')
  // Where focus goes once the composer is on the page: after "Open a directory" always; after a click on a workspace
  // row only when that workspace is new (a fresh one starts in the composer; a running one keeps focus on its row).
  const focusComposer = useRef<false | 'always' | 'if-fresh'>(false)

  const items = list.items ?? []
  const current = items.find((w) => w.id === view.id) ?? null
  const state = view.state
  // The single-repo server form answers 404 to the list: one repository, un-scoped routes, no rail.
  const single = list.single === true
  const showOpenPanel = list.items !== null && (items.length === 0 || showOpen)

  // The page opens on the first workspace (the --repo one, or the first one opened) when it has none selected.
  useEffect(() => {
    if (list.items === null || list.items.length === 0) return
    if (view.id === null || !list.items.some((w) => w.id === view.id)) store.select(list.items[0]!.id)
  }, [store, list.items, view.id])

  // A stop that got no answer in 15 s may still have finished: the list says so.
  useEffect(() => {
    for (const w of items) {
      if (w.status === 'stopped' && stops[w.id]?.phase === 'stuck') {
        setStops(({ [w.id]: _gone, ...rest }) => rest)
        setStoppedAt((s) => ({ ...s, [w.id]: Date.now() }))
      }
    }
  }, [items, stops])

  // After S2 succeeds, or a click on a fresh workspace, focus is in the composer.
  useEffect(() => {
    const want = focusComposer.current
    if (!want || showOpenPanel) return
    if (want === 'if-fresh') {
      if (state === null) return
      if (!isFresh(state)) {
        focusComposer.current = false
        return
      }
    }
    const box = document.getElementById(GOAL_BOX_ID)
    if (!box) return
    box.focus()
    focusComposer.current = false
  })

  const choose = (id: string, say = true, click = false) => {
    const w = items.find((x) => x.id === id)
    const changed = id !== view.id
    focusComposer.current = click ? 'if-fresh' : false
    setShowOpen(false)
    if (!changed) return
    setNote(null)
    store.select(id)
    if (say && w) setAnnouncement(`Switched to ${w.name}. ${workspaceStatusLabel(w.status, { reason: w.reason })}.`)
  }

  const step = (dir: 1 | -1) => {
    if (items.length === 0) return
    const at = items.findIndex((w) => w.id === view.id)
    const next = items[at < 0 ? (dir > 0 ? 0 : items.length - 1) : (at + dir + items.length) % items.length]!
    choose(next.id)
    document.querySelector<HTMLElement>(`[data-ws="${next.id}"]`)?.focus({ focusVisible: true } as FocusOptions)
  }

  // Alt+Up and Alt+Down switch workspace from anywhere but a text field; Esc leaves S2 when there is a workspace to go back to.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (isTyping(e.target)) return
      e.preventDefault()
      step(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Escape' && showOpen && items.length > 0 && !e.defaultPrevented) {
      setShowOpen(false)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const stopSession = async (id: string) => {
    setStops((s) => ({ ...s, [id]: { phase: 'stopping' } }))
    const r = await store.stopSession(id)
    if (r.ok) {
      setStops(({ [id]: _gone, ...rest }) => rest)
      setStoppedAt((s) => ({ ...s, [id]: Date.now() }))
      return
    }
    setStops((s) => ({ ...s, [id]: r.error === 'timeout' ? { phase: 'stuck' } : { phase: 'error', error: reasonOf(r.status, r.error) } }))
  }

  const lifecycle: Lifecycle | null =
    current === null
      ? null
      : stops[current.id]?.phase === 'stopping' || stops[current.id]?.phase === 'stuck' || current.status === 'stopping'
        ? { kind: 'stopping' }
        : current.status === 'stopped'
          ? { kind: 'stopped', at: stoppedAt[current.id] ?? null }
          : null

  const stale = list.error || (view.id !== null && connection !== 'live' && slow)
  const workspace = current ? { name: current.name, path: current.path } : null

  const props = { state, now }
  // A workspace chosen before its snapshot arrives: its rail row may say Working, so no guessed words or New goal mode.
  const loading = state === null && current !== null

  // The earlier sessions are offered while the workspace has no session process and no conversation on screen.
  const canResume = current !== null && !single && !loading && state !== null && !current.session && current.status !== 'stopping' && state.transcript.length === 0

  const hasOpenRequest =state?.requests.some((r) => r.status === 'open') ?? false
  const skipTarget = showOpenPanel ? '#main' : hasOpenRequest ? '#your-move' : wide ? '#main' : '#conversation'
  const skipLabel = !showOpenPanel && hasOpenRequest ? 'Skip to Your move' : 'Skip to content'

  const banner = (
    <Banner
      key="banner"
      {...props}
      connection={connection}
      workspace={workspace}
      lifecycle={lifecycle?.kind ?? null}
      loading={loading}
      noSession={current !== null && noSessionWord(current.status, current.session)}
    />
  )
  const noteBlock =
    note !== null && note.id === view.id ? (
      <div key="note" className="shrink-0 px-4 pt-3 lg:px-6">
        <Notice tone="info">{note.text}</Notice>
      </div>
    ) : null
  const composerWorkspace = current ? { id: current.id, name: current.name } : single ? { id: SINGLE_ID, name: 'this repository' } : null
  const summary = <SummaryStrip key="summary" {...props} />
  const yourMove = <YourMove key="move" {...props} workspace={current ? { id: current.id, name: current.name } : undefined} />
  // The crews card shrinks to its lines and scrolls inside itself; the wrapper lets it stop short of the column's bottom.
  const crews = (
    <div key="crews" className="flex min-h-0 min-w-0 flex-col">
      <BuildNetwork {...props} />
    </div>
  )
  const tabs = (
    <OverviewTabs
      key="tabs"
      {...props}
      conversation={
        <>
          {canResume && current ? (
            <ResumePanel
              workspace={current}
              resume={store.resumeSession}
              onResumed={() => {
                focusComposer.current = 'always'
                setNote(null)
              }}
            />
          ) : null}
          <Transcript {...props} lifecycle={lifecycle} />
          {loading ? (
            <Skeleton className="h-24 shrink-0 border border-border bg-surface" />
          ) : composerWorkspace ? (
            <Composer
              {...props}
              workspace={composerWorkspace}
              connection={connection}
              lifecycle={lifecycle?.kind ?? null}
              onSent={() => setNote(null)}
            />
          ) : null}
        </>
      }
    />
  )

  const content = (
    // One workspace's page: keyed by its id, so nothing local to an area (a typed goal, a scroll, a card's draft, the tab) crosses over.
    <Fragment key={view.id ?? 'none'}>
      {wide ? (
        <>
          <main id="main" tabIndex={-1} className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface outline-none">
            {banner}
            {noteBlock}
            {summary}
            {tabs}
          </main>
          <aside
            aria-label="What needs you and the crews"
            className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden border-l border-border bg-bg p-4"
          >
            {yourMove}
            {crews}
          </aside>
        </>
      ) : (
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-col bg-surface outline-none">
          {banner}
          {noteBlock}
          <div className="bg-bg px-4 py-4">{yourMove}</div>
          {summary}
          <div className="bg-bg px-4 py-4">{crews}</div>
          {tabs}
        </main>
      )}
    </Fragment>
  )

  return (
    <>
      <SkipLink href={skipTarget} label={skipLabel} />
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div
        className={`min-h-dvh min-w-0 lg:grid lg:h-dvh lg:grid-rows-1 lg:overflow-hidden ${
          single
            ? 'lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_376px]'
            : 'lg:grid-cols-[232px_minmax(0,1fr)_320px] xl:grid-cols-[232px_minmax(0,1fr)_376px]'
        }`}
      >
        {single ? null : <WorkspaceRail
          items={list.items}
          error={list.error}
          expired={list.expired}
          currentId={view.id}
          openShown={showOpenPanel}
          stale={stale}
          stage={stageOf(state)}
          stops={stops}
          onSelect={(id) => choose(id, true, true)}
          onOpen={() => setShowOpen(true)}
          onStop={(id) => void stopSession(id)}
          onResume={store.resumeSession}
          onRetry={() => void store.refreshList()}
        />}
        {showOpenPanel ? (
          <main id="main" tabIndex={-1} className="min-h-0 min-w-0 overflow-y-auto outline-none lg:col-span-2">
            <OpenDirectory
              open={store.openDirectory}
              clone={store.cloneRepository}
              onOpened={(w, existed, typed) => {
                focusComposer.current = 'always'
                setShowOpen(false)
                setNote({ id: w.id, text: noteFor(w, existed, typed) })
                store.select(w.id)
              }}
            />
          </main>
        ) : list.items === null && !single ? (
          list.error || list.expired ? null : (
            <main id="main" tabIndex={-1} aria-busy="true" className="flex min-w-0 flex-col gap-4 p-6 outline-none">
              <Skeleton className="h-10 border border-border bg-surface" />
              <Skeleton className="h-40 border border-border bg-surface" />
            </main>
          )
        ) : (
          content
        )}
      </div>
    </>
  )
}
