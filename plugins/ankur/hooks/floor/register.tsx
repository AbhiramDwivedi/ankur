// The factory floor: ankur's run drawn by Claude Code. A band above the prompt shows the run's
// stage timeline and what needs you; /floor opens a pane with Crews, Your move, Decisions, ADRs
// and Design. It reads the run dir ankur already writes, through $.fs, polling every 5 s; it never
// writes to it. An action fills the prompt box after a preview and a confirm; the floor never submits.
import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { FloorView, Tab } from './types.ts'
import type { FillView } from '../../types/index.d.ts'
import { CHECK_MS, crewFill, inspected, openFill, readItem, refusedBy, stuckActions, type Verb } from './actions.ts'
import { createLoader, emptyView, fixtureView, newestRunDir, slash, type Fs } from './load.ts'
import { band, glance, pane } from './view.tsx'
import { bandColumns } from './view/band.tsx'
import { PREVIEW_KEY, scrollStep } from './style.ts'
import { TEXT } from './text.ts'

const PANE = 'ankur-floor'
const TITLE = 'Factory floor'
const POLL_MS = 5000
// the wait that puts the preview's scroll after the draw that holds it
const REVEAL_MS = 30

const view = atom({ plugin: 'ankur', key: 'view' } as const, emptyView(), { shape: 'view-1' })
const tab = atom({ plugin: 'ankur', key: 'tab' } as const, 'crews' as Tab, { shape: 'tab-1' })
const expanded = atom({ plugin: 'ankur', key: 'expanded' } as const, null as string | null, { shape: 'exp-1' })
const showDone = atom({ plugin: 'ankur', key: 'showDone' } as const, false, { shape: 'done-1' })
const diagram = atom({ plugin: 'ankur', key: 'diagram' } as const, 0, { shape: 'diag-1' })
// the diagram's first visible column
const diagramX = atom({ plugin: 'ankur', key: 'diagramX' } as const, 0, { shape: 'diagx-1' })
// the Your move item whose actions show, by id
const selected = atom({ plugin: 'ankur', key: 'selected' } as const, null as string | null, { shape: 'sel-1' })
// the line whose action preview is open
const preview = atom({ plugin: 'ankur', key: 'preview' } as const, null as string | null, { shape: 'prev-1' })
// where the check of that preview stands: the line, its item, its code and the state the pane draws
const fill = atom({ plugin: 'ankur', key: 'fill' } as const, null as FillView | null, { shape: 'fill-1' })

// the slice of $.fs the floor reads with, built where a hook calls it (a const bound to a function, so the engine's scan follows `$` into it)
const fsOf = ($: any): Fs => ({
  read: (p, o) => $.fs.read(p, o ?? {}),
  stat: p => $.fs.stat(p),
  list: p => $.fs.list(p),
  exists: p => $.fs.exists(p),
})

// Scrolls the open preview into the pane's visible rows. The engine answers a refusal as a resolved `{ deny }`, not a
// throw, so the result is read and a deny is logged along with a throw.
async function revealPreview($: any): Promise<void> {
  try {
    const res = await $.ui.scroll({ in: PANE, to: { key: PREVIEW_KEY }, block: 'nearest' })
    if (res?.deny) $.ui.log(`floor: the preview was not scrolled into view: ${res.deny}`)
  } catch (err) {
    $.ui.log(`floor: could not scroll the preview into view: ${err}`)
  }
}

// The check in flight, by number: opening, closing or timing out a preview takes a new number, so a check that answers
// late fills nothing and changes nothing.
let attempt = 0

function setFill($: any, f: FillView | null): Promise<unknown> {
  return Promise.all([update($, fill, () => f), update($, preview, () => f?.line ?? null)])
}
function closeFill($: any): Promise<unknown> {
  attempt++
  return setFill($, null)
}

// Opens the preview of a stuck-crew message. Only the press reads the prompt box for it: a message holds no code, so the open
// has nothing to read, and a draft is still caught before anything is filled.
async function openCrew($: any, line: string): Promise<void> {
  const mine = ++attempt
  const v = await read($, view)
  const slug = v.crews.find(c => stuckActions(c).some(a => a.text === line))?.slug ?? ''
  if (mine === attempt) await setFill($, crewFill(slug, line))
}

// Opens the preview of an inbox action: the item and its sidecar are read now, so the line carries the code held today.
async function openInbox($: any, verb: Verb, id: string): Promise<void> {
  const mine = ++attempt
  const v = await read($, view)
  const item = await readItem(fsOf($), v.source, v.dir, id, await $.session.id())
  const box = await $.prompt.read()
  if (mine === attempt) await setFill($, inspected(openFill(verb, id, null), item, box.text, true))
}

// Confirm, Try again or Check again. The item and the prompt box are read again; only a line that passes both is put in
// the box, and a line the client did not see (a changed code) is shown first. The floor never replaces a draft and never
// submits. A check that has not answered in CHECK_MS says so, and a late answer is dropped.
async function act($: any, line: string): Promise<void> {
  const f = await read($, fill)
  if (f === null || f.line !== line || f.state === 'checking' || f.state === 'filled' || f.state === 'resolved') return
  const mine = ++attempt
  await setFill($, { ...f, state: 'checking' })
  const deadline = $.clock.after(CHECK_MS, () => {
    if (mine !== attempt) return
    attempt++
    void setFill($, { ...f, state: 'stuck' })
  })
  try {
    const v = await read($, view)
    const item = f.verb === null ? null : await readItem(fsOf($), v.source, v.dir, f.item, await $.session.id())
    const box = await $.prompt.read()
    if (mine !== attempt) return
    const g = inspected(f, item, box.text, false)
    // Check again only looks; anything but a ready line is shown and waits for the client
    if (f.state === 'draft' || g.state !== 'ready') return void (await setFill($, g))
    deadline.cancel()
    const res = await $.prompt.fill({ text: g.line, mode: 'replace' })
    if (res.isFilled) $.ui.toast(TEXT.toast.filled)
    if (mine === attempt) await setFill($, res.isFilled ? { ...g, state: 'filled' } : { ...g, state: 'refused', refusal: refusedBy(res.refusal) })
  } catch (err) {
    $.ui.log(`floor: could not put the line in the prompt box: ${(err as Error)?.message ?? err}`)
    if (mine === attempt) await setFill($, { ...f, state: 'refused', refusal: 'hook' })
  } finally {
    deadline.cancel()
  }
}

// Every hook of the floor, in order.
export function setupFloor(on: On): void {
  const loader = createLoader()
  let target: { kind: 'run' | 'fixture'; path: string } | null = null
  let busy = false
  let lastJson = ''
  let cwd = '.'
  // the preview line whose reveal is already scheduled
  let revealed: string | null = null
  // One poll: what changed in the target, folded into a view; null when nothing did (no redraw).
  // It takes an fs adapter and the time, never `$`: each hook builds the adapter where it calls.
  const refresh = async (fs: Fs, now: number): Promise<FloorView | null> => {
    if (busy || target === null) return null
    busy = true
    let next: FloorView
    try {
      next = target.kind === 'fixture'
        ? await fixtureView(fs, target.path, now)
        : await loader.poll(fs, target.path, now)
    } catch (err) {
      next = emptyView(TEXT.readFailed(target.path, String((err as Error)?.message ?? err)))
    } finally {
      busy = false
    }
    const { loadedAt, ...rest } = next
    const json = JSON.stringify(rest)
    if (json === lastJson) return null
    lastJson = json
    return next
  }

  // the matcher is for the engine's scan, which refuses a second matcher-less session.start in one module; the floor draws
  // only where a person is at the prompt
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    // the rest of the chain runs first, and a failure here never reaches it: the gate hooks start before the floor does
    const started = await next(e)
    try {
      await $.command.register({
        name: 'floor',
        description: 'Open the ankur factory floor: /floor [run dir] | /floor fixture <state.json>',
      })
      cwd = e.cwd
      const fs = fsOf($)
      // after a hot reload the module starts over; the view atom still names what it showed
      const kept = await read($, view)
      if (kept.source !== 'none' && kept.dir !== null) target = { kind: kept.source, path: kept.dir }
      else {
        const dir = await newestRunDir(fs, e.cwd)
        if (dir !== null) target = { kind: 'run', path: dir }
      }
      const first = await refresh(fs, await $.clock.now())
      if (first !== null) await update($, view, () => first)
      $.clock.every(POLL_MS, async () => {
        const got = await refresh(fs, await $.clock.now())
        if (got !== null) await update($, view, () => got)
      })
    } catch {
      // nothing to draw; the gate hooks already started
    }
    return started
  })

  on('command.run', { command: 'floor' }, async ($, e) => {
    const fs = fsOf($)
    const args = e.args.trim().split(/\s+/).filter(Boolean)
    if (args[0] === 'fixture' && args[1]) target = { kind: 'fixture', path: slash(args[1]) }
    else if (args[0]) target = { kind: 'run', path: slash(args[0]).replace(/(.)\/+$/, '$1') }
    else if (target === null) {
      const dir = await newestRunDir(fs, cwd)
      if (dir !== null) target = { kind: 'run', path: dir }
    }
    lastJson = ''
    const got = await refresh(fs, await $.clock.now())
    if (got !== null) await update($, view, () => got)
    const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE, focus: true })
    const v = await read($, view)
    const what = v.source === 'none' ? (v.error ?? 'no ankur run found') : `${v.source} ${v.dir}`
    return { text: `Factory floor ${isPlaced ? 'opened' : 'is not placed on this surface'}: ${what}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (e.props.hasSurvey || v.source === 'none') return next(e)
    const el = $.ui.resolve(e) as any
    return band(el, v, () => void $.ui.open({ id: PANE, title: TITLE, focus: true }), bandColumns(e.props))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e) as any
    const v = await read($, view)
    if (e.props.placement === 'widget') return glance(el, v)
    const columns = e.props.bodyColumns ?? 80
    // the scroll is asked only for a preview this draw holds, and after the draw: the engine knows the key once the tree is drawn
    const line = await read($, preview)
    if (line === null) revealed = null
    else if (revealed !== line) {
      revealed = line
      $.clock.after(REVEAL_MS, () => void revealPreview($))
    }
    return pane(
      el,
      {
        view: v,
        tab: await read($, tab),
        expanded: await read($, expanded),
        showDone: await read($, showDone),
        diagram: await read($, diagram),
        diagramX: await read($, diagramX),
        selected: await read($, selected),
        preview: await read($, preview),
        fill: await read($, fill),
        isFocused: e.props.isFocused,
        columns,
        scrollStep: scrollStep(columns),
      },
      {
        onTab: t => void Promise.all([update($, tab, () => t), closeFill($)]),
        onToggle: slug => void Promise.all([update($, expanded, cur => (cur === slug ? null : slug)), closeFill($)]),
        onToggleDone: () => void update($, showDone, cur => !cur),
        onDiagram: i => void Promise.all([update($, diagram, () => i), update($, diagramX, () => 0)]),
        onDiagramX: x => void update($, diagramX, () => x),
        // an opened preview is scrolled into view, so its Confirm and Cancel never sit below the pane's visible rows
        onPreview: line => void (line === null ? closeFill($) : openCrew($, line)),
        onPickInbox: (verb, id) => void openInbox($, verb, id),
        onSelect: id => void Promise.all([update($, selected, () => id), closeFill($)]),
        onAct: line => void act($, line),
      },
    )
  })
}

