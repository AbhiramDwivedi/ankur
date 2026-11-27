import type { El, PaneData } from '../view.tsx'
import { WIDTH } from '../style.ts'
import { TEXT } from '../text.ts'

// One row per ADR: the status column, then the title with a hanging indent. Under NARROW the status
// sits on its own line above the title.
export function adrs(el: El, d: PaneData) {
  const { Box, Text } = el
  const narrow = d.columns < WIDTH.NARROW
  return (
    <Box flexDirection="column">
      {d.view.adrs.length === 0 && <Text dimColor>{TEXT.adrs.empty}</Text>}
      {d.view.adrs.map(a =>
        narrow ? (
          <Box key={a.file} flexDirection="column">
            <Text dimColor>{a.status}</Text>
            <Text wrap="wrap">{a.title}</Text>
          </Box>
        ) : (
          <Box key={a.file} flexDirection="row">
            <Box width={WIDTH.ADR_STATUS_COL} flexShrink={0}>
              <Text dimColor>{a.status}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{a.title}</Text></Box>
          </Box>
        ),
      )}
    </Box>
  )
}
