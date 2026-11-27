import type { El, PaneCalls, PaneData } from '../view.tsx'
import type { CrewView, NeedView } from '../types.ts'
import { inboxActions, stuckActions } from '../actions.ts'
import { GLYPH, HOTKEY, INDENT, TONE, WIDTH } from '../style.ts'
import { TEXT } from '../text.ts'
import { preview } from './preview.tsx'

// The ids of the selectable items: stuck crews first, then inbox items.
const stuckId = (c: CrewView) => `s:${c.slug}`
const needId = (id: string) => `n:${id}`

// The action Buttons of the selected stuck crew, with the open preview under them.
function actions(el: El, c: CrewView, d: PaneData, k: PaneCalls) {
  const { Box, Button } = el
  const acts = stuckActions(c)
  return (
    <Box key={`a${c.slug}`} flexDirection="column" paddingLeft={INDENT}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {acts.map((a, i) => (
          <Button key={`${a.key}${c.slug}`} plain {...(i === 0 && !(d.preview !== null && acts.some(x => x.text === d.preview)) ? { autoFocus: true as const } : {})} hotkey={HOTKEY.actions[a.key as keyof typeof HOTKEY.actions]} onPress={() => k.onPreview(a.text)}>{a.label}</Button>
        ))}
      </Box>
      {d.preview !== null && acts.some(a => a.text === d.preview) ? preview(el, d.preview, k, 0, d.fill) : null}
    </Box>
  )
}

const VERB_TEXT = { approve: TEXT.move.approve, reject: TEXT.move.reject, answer: TEXT.move.own }
const VERB_KEY = { approve: HOTKEY.inbox.approve, reject: HOTKEY.inbox.reject, answer: HOTKEY.inbox.own }

// What the selected inbox item offers: its effects, then one Button per floor action of its kind (or the way to resolve it
// in the session), with the open preview under them.
function needActions(el: El, n: NeedView, d: PaneData, k: PaneCalls) {
  const { Box, Text, Button } = el
  const verbs = inboxActions(n)
  const open = d.fill !== null && d.fill.verb !== null && d.fill.item === n.id ? d.fill : null
  return (
    <Box key={`a${n.id}`} flexDirection="column" paddingLeft={INDENT}>
      {verbs.includes('approve') && <Text dimColor wrap="wrap">{TEXT.move.ifApprove(n.onYes)}</Text>}
      {verbs.includes('reject') && <Text dimColor wrap="wrap">{TEXT.move.ifReject(n.onNo)}</Text>}
      {verbs.length === 0 && <Text dimColor wrap="wrap">{n.onYes}</Text>}
      {verbs.length === 0 && <Text dimColor wrap="wrap">{n.onNo}</Text>}
      {verbs.length === 0 && <Text dimColor wrap="wrap">{TEXT.move.inSession}</Text>}
      {verbs.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {verbs.map((v, i) => (
            <Button key={`${v}${n.id}`} plain {...(i === 0 && open === null ? { autoFocus: true as const } : {})} hotkey={VERB_KEY[v]} onPress={() => k.onPickInbox(v, n.id)}>{VERB_TEXT[v]}</Button>
          ))}
        </Box>
      )}
      {open !== null ? preview(el, open.line, k, 0, open) : null}
    </Box>
  )
}

export function move(el: El, d: PaneData, k: PaneCalls) {
  const { Box, Text, Button } = el
  const stuck = d.view.crews.filter(c => c.stuck)
  const ids = [...stuck.map(stuckId), ...d.view.needs.map(n => needId(n.id))]
  if (ids.length === 0) return <Text dimColor>{TEXT.move.empty}</Text>
  const selected = d.selected !== null && ids.includes(d.selected) ? d.selected : ids[0]
  return (
    <Box flexDirection="column" gap={1}>
      {stuck.map(c => (
        <Box key={stuckId(c)} flexDirection="column">
          <Box flexDirection="row">
            <Box width={WIDTH.GLYPH_COL} flexShrink={0}><Text color={TONE.attention} bold>{GLYPH.stuck}</Text></Box>
            <Box flexGrow={1} flexShrink={1}>
              <Button key={`b${c.slug}`} plain onPress={() => k.onSelect(stuckId(c))}>
                <Text color={TONE.attention} bold wrap="wrap">{`${c.slug} ${TEXT.stuck}`}</Text>
              </Button>
            </Box>
          </Box>
          <Box paddingLeft={INDENT}><Text wrap="wrap">{c.stuck?.detail ?? ''}</Text></Box>
          {selected === stuckId(c) && actions(el, c, d, k)}
        </Box>
      ))}
      {d.view.needs.map(n => (
        <Box key={needId(n.id)} flexDirection="column">
          <Button key={`b${n.id}`} plain onPress={() => k.onSelect(needId(n.id))}>
            <Text bold wrap="wrap">{`${GLYPH.need} ${TEXT.move.kind(n.kind)}${TEXT.move.idGap}${n.id}`}</Text>
          </Button>
          <Box paddingLeft={INDENT}><Text wrap="wrap">{n.title}</Text></Box>
          {selected === needId(n.id) && needActions(el, n, d, k)}
        </Box>
      ))}
    </Box>
  )
}
