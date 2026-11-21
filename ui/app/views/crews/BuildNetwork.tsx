// The Crews card: one card headed "Crews" with one 48 px line per crew, the retro as the last line when
// there is one. The list scrolls on its own. Busy with no state; one line of words while there are no crews. A polite
// live region announces a crew whose status changed between snapshots. A line keeps its element when its crew changes
// state (CrewLine is keyed by slug), so nothing below it moves.
import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import type { Crew, RunState } from '../../store/types.ts'
import { cn } from '../../lib/utils.ts'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import { crewStatus, STATUS_WORD, type Status } from '../status/status.ts'
import { CrewLine } from './CrewLine.tsx'
import { RetroLine } from './RetroRail.tsx'
import { NO_CREWS } from './format.ts'
import { goalGroups, goalLabel, type GoalGroup } from './goals.ts'

export interface BuildNetworkProps {
  state: RunState | null
  now: number
}

type Goals = readonly { id: string; goal: string | null }[]

const CARD = 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface shadow-e1'

/** An earlier goal of the run: one line, its crews as lines once opened. */
function EarlierGoal({ group, now, goals }: { group: GoalGroup; now: number; goals: Goals }) {
  const [open, setOpen] = React.useState(false)
  const id = React.useId()
  const label = `Earlier goal: ${goalLabel(group)}`
  return (
    <li className="min-w-0 border-b border-border last:border-b-0">
      <button
        type="button"
        data-focus="inset"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full min-w-0 items-center gap-3 px-4 text-left text-meta text-muted transition-colors duration-(--duration-quick) ease-out hover:bg-sunken active:translate-y-px active:bg-pressed"
      >
        <ChevronRight aria-hidden="true" className={cn('size-4 shrink-0 text-subtle transition-transform duration-(--duration-quick) ease-out', open && 'rotate-90')} />
        <span title={label} className={cn('min-w-0', open ? 'break-words' : 'truncate')}>
          {label}
        </span>
      </button>
      {open && (
        <ul id={id} aria-label={label} className="min-w-0 border-t border-border">
          {group.crews.map((c) => (
            <CrewLine key={c.slug} crew={c} now={now} goals={goals} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function BuildNetwork({ state, now }: BuildNetworkProps) {
  const loaded = state !== null
  const allCrews: Crew[] = state?.run?.crews ?? []
  const groups = goalGroups(state?.run)
  const shown = groups.at(-1) ?? null
  const earlier = groups.slice(0, -1).reverse()
  const crews = shown?.crews ?? []
  const statusKey = allCrews.map((c) => `${c.slug}:${crewStatus(c)}`).join('|')
  const prev = React.useRef<Map<string, Status> | null>(null)
  const [announce, setAnnounce] = React.useState('')
  const headId = React.useId()

  // One polite message for the latest crew whose status changed since the last snapshot; none on the first.
  React.useEffect(() => {
    const cur = new Map<string, Status>(allCrews.map((c) => [c.slug, crewStatus(c)]))
    const before = prev.current
    prev.current = cur
    if (!loaded || before === null) return
    let latest = ''
    for (const [slug, s] of cur) {
      const was = before.get(slug)
      if (was !== undefined && was !== s) latest = `Crew ${slug} is now ${STATUS_WORD[s].toLowerCase()}`
    }
    if (latest) setAnnounce(latest)
  }, [statusKey, loaded])

  if (state === null) {
    return (
      <section aria-labelledby={headId} aria-busy="true" className={CARD}>
        <h2 id={headId} className="border-b border-border px-4 py-2 text-ui font-semibold text-fg">
          Crews
        </h2>
        <div className="flex flex-col">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-none" />
          ))}
        </div>
      </section>
    )
  }

  const goals: Goals = state.run?.goals ?? []
  const merged = crews.filter((c) => c.status === 'merged').length

  return (
    <section aria-labelledby={headId} aria-busy="false" className={CARD}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 id={headId} className="text-ui font-semibold text-fg">
          Crews
        </h2>
        {crews.length > 0 && <span className="text-meta text-muted tabular-nums">{`${merged} of ${crews.length} merged`}</span>}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {crews.length === 0 && !state.retro ? (
        <p className="min-w-0 p-4 text-body text-muted">{NO_CREWS}</p>
      ) : (
        <ul aria-label="Crews" className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
          {crews.map((c) => (
            <CrewLine key={c.slug} crew={c} now={now} goals={goals} />
          ))}
          {earlier.map((g) => (
            <EarlierGoal key={g.id} group={g} now={now} goals={goals} />
          ))}
          {state.retro && <RetroLine retro={state.retro} />}
        </ul>
      )}
    </section>
  )
}
