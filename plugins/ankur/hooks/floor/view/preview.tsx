import type { El, PaneCalls } from '../view.tsx'
import type { FillView } from '../../../types/index.d.ts'
import { typesCode } from '../actions.ts'
import { HOTKEY, PREVIEW_KEY, TONE } from '../style.ts'
import { TEXT } from '../text.ts'

type Tone = (typeof TONE)[keyof typeof TONE]

// The preview of one action, drawn inline under its row. It shows the exact line the floor will put in the prompt box
// (never send), whole and wrapped, and where the check of it stands (`fill`, null reads as ready). Confirm puts the line in
// the box, after the floor re-reads the item and the box; Cancel holds the focus ring, so a stray Enter never fills.
// A state that cannot proceed shows words, never an inert Button. Every row keeps its place from one state to the next, so
// nothing jumps while a check runs. What a button does is `k.onAct` (confirm or check again) and `k.onPreview(null)` (close).
// The bordered Box is the outermost keyed element (`marginLeft` indents it, so no keyed wrapper hides PREVIEW_KEY from
// the scroll that reveals it).
export function preview(el: El, line: string, k: PaneCalls, marginLeft = 0, fill: FillView | null = null) {
  const { Box, Text, Button } = el
  const f = fill !== null && fill.line === line ? fill : null
  const state = f?.state ?? 'ready'
  const subject = f === null || f.verb === null ? null : f.item
  const msg = (m: { head: string; tail: string }, color: Tone) => (
    <Text color={color} wrap="wrap"><Text bold>{m.head}</Text>{` ${m.tail}`}</Text>
  )
  const close = (label: string) => (
    <Button key="previewCancel" plain autoFocus hotkey={HOTKEY.preview.cancel} onPress={() => k.onPreview(null)}>{label}</Button>
  )
  const again = (label: string) => (
    <Button key="previewConfirm" plain hotkey={HOTKEY.preview.confirm} onPress={() => k.onAct(line)}>{label}</Button>
  )

  // what the client types after the line: the code (and answer) when the line has none, or the answer
  const typed = f === null ? null : typesCode(f)
  const typeRow = typed === null ? null
    : <Text wrap="wrap">{typed.kind === 'missing' ? (f?.verb === 'answer' ? TEXT.preview.noCodeAnswer : TEXT.preview.noCode) : typed.kind === 'answer' ? TEXT.preview.typeCodeAnswer(typed.code) : TEXT.preview.typeCode(typed.code)}</Text>

  if (f !== null && state === 'filled') {
    return (
      <Box key={PREVIEW_KEY} flexDirection="column" borderStyle="round" borderColor={TONE.border} paddingX={1} marginLeft={marginLeft}>
        <Text color={TONE.done} wrap="wrap">{TEXT.preview.filled(line)}</Text>
        <Text dimColor wrap="wrap">{typed === null ? TEXT.preview.filledNext : TEXT.preview.filledNextCode}</Text>
        {typeRow}
        {typed === null && f.verb === 'answer' ? <Text wrap="wrap">{TEXT.preview.filledAnswer}</Text> : null}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Button key="previewCancel" plain onPress={() => k.onPreview(null)}>{TEXT.preview.done}</Button>
        </Box>
      </Box>
    )
  }
  if (f !== null && state === 'resolved') {
    return (
      <Box key={PREVIEW_KEY} flexDirection="column" borderStyle="round" borderColor={TONE.border} paddingX={1} marginLeft={marginLeft}>
        {msg(TEXT.preview.resolved(f.item, f.decision ?? ''), TONE.fail)}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>{close(TEXT.preview.close)}</Box>
      </Box>
    )
  }

  // the first row: the lead, or why the line is not going into the box
  const top = state === 'draft' ? msg(TEXT.preview.draft, TONE.attention)
    : state === 'stuck' ? msg(TEXT.preview.stuck(subject), TONE.fail)
    : state === 'refused' && f?.refusal ? msg(TEXT.preview.refused[f.refusal], TONE.fail)
    : state === 'checking' ? <Text dimColor wrap="wrap">{TEXT.preview.checking(subject)}</Text>
    : <Text dimColor wrap="wrap">{TEXT.preview.lead}</Text>

  // the third row: what changed, or what the client types after the line
  const changed = state === 'changed' ? <Text color={TONE.attention} wrap="wrap">{TEXT.preview.changed}</Text> : null
  const type = typeRow ?? (f?.verb === 'answer' ? <Text wrap="wrap">{TEXT.preview.typeAnswer}</Text> : null)

  // Confirm again where it can help: not where the box has no composer
  const retry = state === 'draft' ? TEXT.preview.check
    : state === 'stuck' ? TEXT.preview.again
    : state === 'refused' && f?.refusal === 'no_composer' ? null
    : TEXT.preview.confirm
  return (
    <Box key={PREVIEW_KEY} flexDirection="column" borderStyle="round" borderColor={TONE.border} paddingX={1} marginLeft={marginLeft}>
      {top}
      <Text wrap="wrap">{line}</Text>
      {changed}
      {type}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {retry === null ? null : again(retry)}
        {close(TEXT.preview.cancel)}
      </Box>
    </Box>
  )
}
