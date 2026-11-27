import type { El } from '../view.tsx'
import { countsOf, timeline } from '../view.tsx'
import type { FloorView } from '../types.ts'
import { GLYPH, HOTKEY, TONE, WIDTH } from '../style.ts'
import { TEXT } from '../text.ts'

// Cells a string takes: one per character (code point), as the engine counts them.
const cells = (s: string) => [...s].length

// The goal as far as `room` cells allow: whole, cut with `…`, or null below BAND_MIN_GOAL.
function fitGoal(goal: string, room: number): string | null {
  if (cells(goal) <= room) return goal
  if (room < WIDTH.BAND_MIN_GOAL) return null
  return `${[...goal].slice(0, room - 1).join('').trimEnd()}${GLYPH.ellipsis}`
}

// Cells the band has, from AbovePrompt's props: bodyColumns, which is the column less the engine's mark.
export const bandColumns = (props: { bodyColumns?: number }): number =>
  props.bodyColumns ?? WIDTH.BAND_FALLBACK_COLUMNS - WIDTH.BAND_MARK

// One line: name, goal, stage timeline, counts, the Floor key. The goal takes what the rest leaves and is the only part cut.
export function band(el: El, v: FloorView, onOpen: () => void, columns: number) {
  const { Box, Text, Button } = el
  const n = countsOf(v)
  const allMerged = n.total > 0 && n.merged === n.total
  const tail: { key: string; text: string; tone?: typeof TONE.attention; bold?: boolean }[] = [
    ...(n.total === 0
      ? [{ key: 'planning', text: TEXT.band.planning }]
      : [
          { key: 'timeline', text: timeline(v.crews) },
          ...(allMerged ? [{ key: 'merged', text: TEXT.band.allMerged(n.total) }] : [{ key: 'running', text: `${n.running} ${TEXT.running}` }]),
        ]),
    ...(n.stuck > 0 ? [{ key: 'stuck', text: `${n.stuck} ${TEXT.stuck}`, tone: TONE.attention, bold: true }] : []),
    ...(n.needs > 0 ? [{ key: 'need', text: `${n.needs} ${TEXT.needYou}`, tone: TONE.attention }] : []),
  ]
  const floorCells = cells(TEXT.band.floor) + WIDTH.KEY_PREFIX
  // Parts give way in a set order when the rest overruns the line: the goal, then the timeline, the name, the running count and the stuck count.
  // The need-you count and the Floor key stay, so the band never wraps.
  let shown = tail
  let showName = true
  const fixedOf = () => [...(showName ? [TEXT.band.name] : []), ...shown.map(t => t.text)].reduce((a, t) => a + cells(t), floorCells)
    + WIDTH.BAND_GAP * (shown.length + (showName ? 1 : 0))
  const fits = () => fixedOf() + WIDTH.BAND_SLACK <= columns
  const dropPart = (...keys: string[]) => { if (fixedOf() > columns) shown = shown.filter(t => !keys.includes(t.key)) }
  if (!fits()) shown = shown.filter(t => t.key !== 'timeline')
  if (!fits()) showName = false
  dropPart('running', 'merged')
  dropPart('stuck', 'planning')
  const room = columns - WIDTH.BAND_SLACK - fixedOf() - WIDTH.BAND_GAP
  // the goal goes first, so it never comes back once a lower part has gone
  const goal = shown !== tail || !showName ? null : fitGoal(v.goal ?? TEXT.band.noGoal, room)
  return (
    <Box flexDirection="row" gap={WIDTH.BAND_GAP}>
      {showName && <Box flexShrink={0}><Text bold>{TEXT.band.name}</Text></Box>}
      {goal !== null && <Text dimColor wrap="truncate-end">{goal}</Text>}
      {shown.map(t => <Box key={t.key} flexShrink={0}><Text color={t.tone} bold={t.bold}>{t.text}</Text></Box>)}
      <Box flexShrink={0}><Button key="floor" plain hotkey={HOTKEY.band.floor} onPress={onOpen}>{TEXT.band.floor}</Button></Box>
    </Box>
  )
}
