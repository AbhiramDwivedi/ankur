// The server's notices and the stream's own state, as one polite list. Each item
// reads "Status: <text>"; the list is always there, so screen readers hear items arrive.
import type { Connection, RunState } from '../../store/types.ts'
import { Dot, StatusGlyph } from '../../components/ui/dot.tsx'

export interface RunStatusProps {
  state: RunState | null
  now: number
  /** The stream link; reconnecting adds a "Reconnecting…" item until it recovers. */
  connection?: Connection
  /** The Reload notice stands in for the "Reconnecting…" item, so the header keeps the height it had. */
  replacesReconnecting?: boolean
}

export function RunStatus({ state, connection, replacesReconnecting }: RunStatusProps) {
  const items: { id: string; text: string }[] = []
  if (connection === 'reconnecting' && !replacesReconnecting) items.push({ id: 'stream-reconnecting', text: 'Reconnecting…' })
  for (const n of state?.notices ?? []) {
    if (connection === 'reconnecting' && n.text === 'Reconnecting…') continue
    items.push(n)
  }
  return (
    <ul aria-label="Run status" aria-live="polite" className="flex min-w-0 flex-1 flex-wrap items-center gap-2 empty:hidden">
      {items.map((n) => {
        const failed = n.id === 'no-plugin'
        return (
        <li
          key={n.id}
          title={n.text}
          className={`flex min-w-0 items-center gap-2 rounded-ctl bg-sunken px-2 text-meta ${failed ? 'text-fail-text' : 'text-muted'}`}
        >
          {failed ? <StatusGlyph glyph="fail" small /> : <Dot tone="neutral" />}
          <span className="min-w-0 line-clamp-2 [overflow-wrap:anywhere]">
            <span className="sr-only">Status: </span>
            {n.text}
          </span>
        </li>
        )
      })}
    </ul>
  )
}
