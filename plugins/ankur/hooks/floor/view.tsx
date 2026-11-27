// View builders. They take the resolved elements and plain data and callbacks, never `$`
// (the engine's module scan refuses a function handed `$`), so the hooks resolve and pass down.
// The band and each tab live in view/*; this file keeps the pane frame, the glance and the shared helpers.
import type { Elements } from 'claude-code'
import type { CrewView, FloorView, Tab } from './types.ts'
import type { FillView } from '../../types/index.d.ts'
import type { Verb } from './actions.ts'
import { GLYPH, HOTKEY, TONE } from './style.ts'
import { TEXT } from './text.ts'
import { band } from './view/band.tsx'
import { crews } from './view/crews.tsx'
import { move } from './view/move.tsx'
import { decisions } from './view/decisions.tsx'
import { adrs } from './view/adrs.tsx'
import { design } from './view/design.tsx'

export { band }

export type El = Elements['terminal']

// two spaces between the parts of a line, in the band and the pane
export const GAP = '  '

export const TABS: { id: Tab; label: string; hotkey: string }[] = [
  { id: 'crews', label: TEXT.tabs.crews, hotkey: HOTKEY.tabs.crews },
  { id: 'move', label: TEXT.tabs.move, hotkey: HOTKEY.tabs.move },
  { id: 'decisions', label: TEXT.tabs.decisions, hotkey: HOTKEY.tabs.decisions },
  { id: 'adrs', label: TEXT.tabs.adrs, hotkey: HOTKEY.tabs.adrs },
  { id: 'design', label: TEXT.tabs.design, hotkey: HOTKEY.tabs.design },
]

const done = (c: CrewView) => c.status === 'merged' || c.status === 'dropped'
export const glyph = (c: CrewView): string =>
  c.stuck ? GLYPH.stuck : c.status === 'merged' ? GLYPH.merged : c.status === 'dropped' ? GLYPH.dropped : c.status === 'running' ? GLYPH.running : GLYPH.planned

export interface StageSum { stage: number | null; crews: CrewView[]; glyph: string }

export function stagesOf(crews: CrewView[]): StageSum[] {
  const by = new Map<number | null, CrewView[]>()
  for (const c of crews) {
    const list = by.get(c.stage) ?? []
    list.push(c)
    by.set(c.stage, list)
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a ?? 1e9) - (b ?? 1e9))
    .map(([stage, list]) => ({
      stage, crews: list,
      glyph: list.some(c => c.stuck) ? GLYPH.stuck : list.some(c => c.status === 'running') ? GLYPH.running
        : list.every(done) ? GLYPH.merged : GLYPH.planned,
    }))
}

// The band's stage timeline, with runs of finished stages and runs of planned stages folded: "S0–S14 ✓  S15 ●  S16–S19 ○".
export function timeline(crews: CrewView[]): string {
  const items: { from: string; to: string; glyph: string }[] = []
  for (const s of stagesOf(crews)) {
    const name = s.stage === null ? 'S?' : `S${s.stage}`
    const last = items[items.length - 1]
    if ((s.glyph === GLYPH.merged || s.glyph === GLYPH.planned) && last?.glyph === s.glyph) last.to = name
    else items.push({ from: name, to: name, glyph: s.glyph })
  }
  return items.map(i => `${i.from === i.to ? i.from : `${i.from}${GLYPH.range}${i.to}`} ${i.glyph}`).join(GAP)
}

export interface Counts { running: number; stuck: number; merged: number; total: number; needs: number }
export const countsOf = (v: FloorView): Counts => ({
  running: v.crews.filter(c => c.status === 'running').length,
  stuck: v.crews.filter(c => c.stuck).length,
  merged: v.crews.filter(c => c.status === 'merged').length,
  total: v.crews.length,
  needs: v.needs.length + v.crews.filter(c => c.stuck).length,
})

export interface PaneCalls {
  onTab: (t: Tab) => void
  onToggle: (slug: string) => void
  onToggleDone: () => void
  // confirm of a preview, or its check again or try again: the floor re-reads the item and the prompt box, then puts the
  // line in the prompt box. It never sends anything
  onAct: (line: string) => void
  onDiagram: (i: number) => void
  // the diagram's first visible column, set absolute (the diagram view clamps it)
  onDiagramX: (x: number) => void
  // open the preview of a stuck-crew message, or close any open preview with null
  onPreview: (line: string | null) => void
  // open the preview of an inbox action on one item: the floor reads the item's code and builds the line
  onPickInbox: (verb: Verb, id: string) => void
  // select one Your move item by its id, or none with null
  onSelect: (id: string | null) => void
}

export interface PaneData {
  view: FloorView
  tab: Tab
  expanded: string | null
  showDone: boolean
  diagram: number
  diagramX: number
  selected: string | null
  // the line whose preview is open
  preview: string | null
  // the open preview's state, for the line in `preview`
  fill: FillView | null
  isFocused: boolean
  columns: number
  // one sideways scroll step, in columns
  scrollStep: number
}

export const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}${GLYPH.ellipsis}` : t)

// The goal, the status line and the hint that the keys need the focus; with no run, the message and how to start one.
function header(el: El, d: PaneData) {
  const { Box, Text } = el
  const v = d.view
  const hint = d.isFocused ? null : <Text dimColor wrap="wrap">{TEXT.focusHint}</Text>
  if (v.source === 'none') {
    return (
      <Box flexDirection="column">
        {v.error !== null
          ? <Text bold color={TONE.fail} wrap="wrap">{v.error}</Text>
          : <Text bold wrap="wrap">{TEXT.noRun}</Text>}
        <Text dimColor wrap="wrap">{TEXT.noRunHint}</Text>
        {hint}
      </Box>
    )
  }
  const n = countsOf(v)
  const parts = [
    `${n.merged}/${n.total} ${TEXT.merged}`,
    `${n.running} ${TEXT.running}`,
    ...(n.stuck > 0 ? [`${n.stuck} ${TEXT.stuck}`] : []),
    v.source === 'fixture' ? TEXT.fixture : `${v.eventLines} ${TEXT.events}`,
  ]
  return (
    <Box flexDirection="column">
      <Text bold wrap="wrap">{v.goal ?? TEXT.band.noGoal}</Text>
      <Text dimColor wrap="wrap">{parts.join(GAP)}{d.isFocused ? '' : `${GAP}${TEXT.focusHint}`}</Text>
    </Box>
  )
}

// The tab row: every tab a plain Button that draws its key; the active one bold and underlined, holding the focus
// unless a preview's Cancel does. It wraps rather than cuts at a narrow width.
function tabRow(el: El, d: PaneData, k: PaneCalls) {
  const { Box, Text, Button } = el
  const needs = countsOf(d.view).needs
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {TABS.map(t => {
        const active = t.id === d.tab
        const label = t.id === 'move' && needs > 0 ? TEXT.tabs.withCount(t.label, needs) : t.label
        return (
          <Button key={`tab${t.id}`} plain hotkey={t.hotkey} {...(active && d.preview === null ? { autoFocus: true as const } : {})} onPress={() => k.onTab(t.id)}>
            {active ? <Text bold underline>{label}</Text> : <Text dimColor>{label}</Text>}
          </Button>
        )
      })}
    </Box>
  )
}

export function pane(el: El, d: PaneData, k: PaneCalls) {
  const { Box, Text } = el
  const v = d.view
  const body = v.source === 'none' ? <Text dimColor>{TEXT.noRunOpen}</Text>
    : d.tab === 'crews' ? crews(el, d, k) : d.tab === 'move' ? move(el, d, k)
    : d.tab === 'decisions' ? decisions(el, d) : d.tab === 'adrs' ? adrs(el, d) : design(el, d, k)
  return (
    <Box flexDirection="column">
      {header(el, d)}
      {tabRow(el, d, k)}
      {body}
    </Box>
  )
}

// The desktop widget: a glance, no tabs.
export function glance(el: El, v: FloorView) {
  const { Box, Text } = el
  const n = countsOf(v)
  return (
    <Box flexDirection="column">
      <Text bold>{n.merged}/{n.total} {TEXT.merged}</Text>
      <Text>{timeline(v.crews)}</Text>
      {n.needs > 0 && <Text color={TONE.attention}>{n.needs} {TEXT.needYou}</Text>}
    </Box>
  )
}
