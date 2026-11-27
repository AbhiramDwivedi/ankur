import type { El, PaneData } from '../view.tsx'
import { WIDTH } from '../style.ts'
import { TEXT } from '../text.ts'

// Newest first. The time column is fixed, so a multi-line decision wraps under its own text.
export function decisions(el: El, d: PaneData) {
  const { Box, Text } = el
  const all = d.view.decisions
  const list = all.slice(-WIDTH.DECISIONS_MAX).reverse()
  return (
    <Box flexDirection="column">
      {list.length === 0 && <Text dimColor>{TEXT.decisions.empty}</Text>}
      {all.length > list.length && <Text dimColor>{TEXT.decisions.cut(list.length, all.length)}</Text>}
      {list.map((x, i) => (
        <Box key={`d${i}`} flexDirection="row">
          <Box width={WIDTH.TIME_COL} flexShrink={0}>
            <Text dimColor>{x.time}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{x.text}</Text></Box>
        </Box>
      ))}
    </Box>
  )
}
