import type { El, PaneCalls, PaneData } from '../view.tsx'
import type { CrewView } from '../types.ts'
import { GAP, glyph, stagesOf } from '../view.tsx'
import { stuckActions } from '../actions.ts'
import { GLYPH, HOTKEY, INDENT, TONE, WIDTH } from '../style.ts'
import { TEXT } from '../text.ts'
import { preview } from './preview.tsx'

type Tier = 'wide' | 'medium' | 'narrow'
const tierOf = (columns: number): Tier => (columns >= WIDTH.WIDE ? 'wide' : columns >= WIDTH.NARROW ? 'medium' : 'narrow')

const statusWord = (c: CrewView): string => (c.stuck ? TEXT.stuck : (c.status ?? TEXT.crews.noStatus))
const agentsOf = (c: CrewView): string => `${c.members.length}/${c.estAgents ?? TEXT.crews.unknownAgents}`

// One crew's row, laid out by the width of the pane. Only the latest text is cut, with an ellipsis.
function crewRow(el: El, c: CrewView, columns: number, onToggle: (slug: string) => void) {
  const { Box, Text, Button } = el
  const mark = <Text color={c.stuck ? TONE.attention : undefined}>{glyph(c)}</Text>
  const slug = <Button key={`t${c.slug}`} plain onPress={() => onToggle(c.slug)}>{c.slug}</Button>
  const latest = c.stuck ? c.stuck.detail : (c.latest ?? '')
  const tier = tierOf(columns)
  if (tier === 'wide') {
    return (
      <Box key={`c${c.slug}`} flexDirection="row">
        <Box width={WIDTH.GLYPH_COL} flexShrink={0}>{mark}</Box>
        <Box width={WIDTH.SLUG_COL} flexShrink={0}>{slug}</Box>
        <Box width={WIDTH.STATUS_COL} flexShrink={0}><Text dimColor>{statusWord(c)}</Text></Box>
        <Box width={WIDTH.AGENTS_COL} flexShrink={0}><Text dimColor>{agentsOf(c)}</Text></Box>
        <Box flexGrow={1} flexShrink={1}><Text dimColor wrap="truncate-end">{latest}</Text></Box>
      </Box>
    )
  }
  const facts = tier === 'medium'
    ? <Box flexDirection="row"><Box width={WIDTH.AGENTS_COL} flexShrink={0}><Text dimColor>{agentsOf(c)}</Text></Box><Box flexGrow={1} flexShrink={1}><Text dimColor wrap="truncate-end">{latest}</Text></Box></Box>
    : <Box flexDirection="row"><Box width={WIDTH.STATUS_COL} flexShrink={0}><Text dimColor>{statusWord(c)}</Text></Box><Box width={WIDTH.AGENTS_COL} flexShrink={0}><Text dimColor>{agentsOf(c)}</Text></Box><Box flexGrow={1} flexShrink={1}><Text dimColor wrap="truncate-end">{latest}</Text></Box></Box>
  return (
    <Box key={`c${c.slug}`} flexDirection="column">
      <Box flexDirection="row">
        <Box width={WIDTH.GLYPH_COL} flexShrink={0}>{mark}</Box>
        <Box flexGrow={1} flexShrink={1}>{slug}</Box>
        {tier === 'medium' && <Box width={WIDTH.STATUS_COL} flexShrink={0}><Text dimColor>{statusWord(c)}</Text></Box>}
      </Box>
      <Box paddingLeft={WIDTH.GLYPH_COL}>{facts}</Box>
    </Box>
  )
}

// What an expanded crew adds: goal, latest and stuck detail in full, every member, and the stuck actions with their preview.
function crewDetail(el: El, c: CrewView, d: PaneData, k: PaneCalls) {
  const { Box, Text, Button } = el
  const rows: any[] = []
  const line = (key: string, text: string, props: Record<string, unknown> = {}) =>
    rows.push(<Box key={`${key}${c.slug}`} paddingLeft={INDENT}><Text wrap="wrap" {...props}>{text}</Text></Box>)
  if (c.goal) line('g', c.goal, { dimColor: true })
  if (c.latest) line('l', c.latest)
  if (c.stuck) line('d', c.stuck.detail, { color: TONE.attention })
  for (const m of c.members) {
    const meta = `${m.type ?? ''} ${m.model ?? ''}${m.effort ? `/${m.effort}` : ''}${GAP}${m.state}`.trim()
    rows.push(
      <Box key={`m${c.slug}${m.name}`} flexDirection="column" paddingLeft={INDENT}>
        <Text wrap="wrap">{m.name} <Text dimColor>{meta}</Text></Text>
        {m.detail ? <Box paddingLeft={INDENT}><Text dimColor wrap="wrap">{m.detail}</Text></Box> : null}
      </Box>,
    )
  }
  if (c.members.length === 0) rows.push(<Box key={`n${c.slug}`} paddingLeft={INDENT}><Text dimColor>{TEXT.crews.noAgents}</Text></Box>)
  const acts = stuckActions(c)
  if (acts.length > 0) {
    rows.push(
      <Box key={`a${c.slug}`} flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={INDENT}>
        {acts.map(a => (
          <Button key={`${a.key}${c.slug}`} plain hotkey={HOTKEY.actions[a.key as keyof typeof HOTKEY.actions]} onPress={() => k.onPreview(a.text)}>{a.label}</Button>
        ))}
      </Box>,
    )
    if (d.preview !== null && acts.some(a => a.text === d.preview)) rows.push(preview(el, d.preview, k, INDENT))
  }
  return rows
}

export function crews(el: El, d: PaneData, k: PaneCalls) {
  const { Box, Text, Button } = el
  const rows: any[] = []
  for (const s of stagesOf(d.view.crews)) {
    const name = s.stage === null ? TEXT.crews.unplanned : `${TEXT.crews.stage} ${s.stage}`
    const tally = `${s.crews.filter(c => c.status === 'merged').length}/${s.crews.length} ${TEXT.merged}`
    rows.push(
      <Text key={`h${s.stage}`} bold color={s.glyph === GLYPH.stuck ? TONE.attention : undefined}>
        {s.glyph} {name} <Text dimColor>{tally}</Text>
      </Text>,
    )
    if (s.glyph === GLYPH.merged && !d.showDone) continue
    for (const c of s.crews) {
      rows.push(crewRow(el, c, d.columns, k.onToggle))
      if (d.expanded === c.slug) rows.push(...crewDetail(el, c, d, k))
    }
  }
  if (rows.length === 0) rows.push(<Text key="none" dimColor>{TEXT.crews.none}</Text>)
  return (
    <Box flexDirection="column">
      <Button key="done" plain dimColor hotkey={HOTKEY.crews.done} onPress={k.onToggleDone}>{d.showDone ? TEXT.crews.fold : TEXT.crews.show}</Button>
      {rows}
    </Box>
  )
}
