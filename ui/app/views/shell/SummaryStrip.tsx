// The summary strip under the header: the stage timeline, then the Usage so far cell. There is no requirements cell:
// RunState carries no requirements data, so Usage takes the strip's width.
import type { RunState } from '../../store/types.ts'
import { UsageCell } from '../metrics/UsageCell.tsx'
import { Timeline } from '../rail/Timeline.tsx'

export interface SummaryStripProps {
  state: RunState | null
  now: number
}

export function SummaryStrip({ state, now }: SummaryStripProps) {
  return (
    <section aria-label="Run summary" className="flex min-w-0 shrink-0 flex-col gap-3 border-b border-border bg-bg px-4 py-3 lg:px-6">
      <Timeline state={state} now={now} />
      <UsageCell state={state} now={now} />
    </section>
  )
}
