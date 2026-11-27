import type { El, PaneCalls, PaneData } from '../view.tsx'
import { GLYPH, HOTKEY, WIDTH } from '../style.ts'
import { TEXT } from '../text.ts'

// Diagram lines are drawn as cells, one code point each (box art is single width).
const cells = (l: string): string[] => Array.from(l)

export function design(el: El, d: PaneData, k: PaneCalls) {
  const { Box, Text, Button, Code } = el
  const list = d.view.diagrams
  if (list.length === 0) return <Text dimColor>{TEXT.design.empty}</Text>
  const i = Math.min(Math.max(0, d.diagram), list.length - 1)
  const g = list[i]
  if (g === undefined) return <Text dimColor>{TEXT.design.none}</Text>

  // the width of the drawn diagram, and how far it can scroll; the offset is clamped here
  const lines = g.lines === null ? null : g.lines.map(cells)
  const total = lines === null ? 0 : Math.max(0, ...lines.map(l => l.length))
  const maxX = Math.max(0, total - d.columns)
  const x = Math.min(Math.max(0, d.diagramX), maxX)
  const wide = maxX > 0
  const narrow = d.columns < WIDTH.NARROW

  const scroll = wide ? (
    <Box flexDirection="row" gap={1}>
      <Button key="left" plain hotkey={HOTKEY.design.left} onPress={() => k.onDiagramX(Math.max(0, x - d.scrollStep))}>{TEXT.design.left}</Button>
      <Button key="right" plain hotkey={HOTKEY.design.right} onPress={() => k.onDiagramX(Math.min(maxX, x + d.scrollStep))}>{TEXT.design.right}</Button>
      <Text dimColor>{TEXT.design.range(x + 1, Math.min(total, x + d.columns), total, GLYPH.range)}</Text>
    </Box>
  ) : null

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Button key="prev" plain hotkey={HOTKEY.design.prev} onPress={() => k.onDiagram((i + list.length - 1) % list.length)}>{TEXT.design.prev}</Button>
        <Text dimColor>{i + 1}/{list.length}</Text>
        <Button key="next" plain hotkey={HOTKEY.design.next} onPress={() => k.onDiagram((i + 1) % list.length)}>{TEXT.design.next}</Button>
        {narrow ? null : scroll}
      </Box>
      {narrow ? scroll : null}
      <Text bold wrap="wrap">{g.heading}</Text>
      {lines === null
        ? <Code source={g.source} language="mermaid" wrap="wrap" />
        : lines.map((l, j) => {
          const shown = l.slice(x, x + d.columns).join('')
          return <Text key={`l${j}`} wrap="wrap">{shown === '' ? ' ' : shown}</Text>
        })}
    </Box>
  )
}
