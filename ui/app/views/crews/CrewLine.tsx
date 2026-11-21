// One crew on the Crews card: a 48 px line (glyph, slug in mono, one status line, "Stage n", the step bar, a chevron)
// that opens to its members. It is the same <li>, keyed by slug, in every state: only classes change, so a crew going
// from running to done keeps its element, its height and the list's scroll; the background, the glyph and the last
// segment cross-fade over motion.base (the transition sits on this root; reduced motion zeroes it in app.css).
// The members mount only while the line is open.
import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import type { Crew } from '../../store/types.ts'
import { cn } from '../../lib/utils.ts'
import { StatusGlyph, type Glyph } from '../../components/ui/dot.tsx'
import { agentStatus, type Status } from '../status/status.ts'
import { SegmentBar } from '../metrics/SegmentBar.tsx'
import { StuckCard } from './StuckCard.tsx'
import { crewAgents, crewLineView, crewSteps, memberState, memberTask, pipClass, roleWord, modelKey } from './format.ts'

export interface CrewLineProps {
  crew: Crew
  now: number
  /** The run's goals, so the project manager's line shows the goal text, not its id. */
  goals?: readonly { id: string; goal: string | null }[]
  /** The line starts opened (a test seam: the static renderer cannot click). */
  defaultOpen?: boolean
}

const MEMBER_GLYPH: Record<Status, Glyph> = { done: 'done', active: 'run', waiting: 'ask', stuck: 'ask', planned: 'plan' }

export function CrewLine({ crew, now, goals = [], defaultOpen = false }: CrewLineProps) {
  const [open, setOpen] = React.useState(defaultOpen)
  const listId = React.useId()
  const view = crewLineView(crew)
  const steps = crewSteps(crew)
  const stuck = crew.status !== 'merged' && crew.status !== 'dropped' && crew.stuck ? crew.stuck : null
  const partial = (crew.eventsUnread ?? 0) > 0
  const agents = open ? crewAgents(crew) : []
  const stage = crew.stage === null ? 'No stage' : `Stage ${crew.stage}`

  return (
    <li
      data-crew={crew.slug}
      className={cn('min-h-12 min-w-0 border-b border-border transition-colors duration-(--duration-base) ease-out last:border-b-0', view.merged && 'bg-ok-soft')}
    >
      <button
        type="button"
        data-focus="inset"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="group grid h-12 w-full grid-cols-[0.75rem_minmax(0,1fr)_auto_1rem] grid-rows-[auto_auto] content-center items-center gap-x-3 px-4 text-left transition-colors duration-(--duration-quick) ease-out hover:bg-sunken active:translate-y-px active:bg-pressed"
      >
        <StatusGlyph glyph={view.glyph} className="row-span-2" />
        <span title={crew.slug} className="min-w-0 truncate font-mono text-ui font-semibold text-fg">
          {crew.slug}
        </span>
        <span className="justify-self-end text-micro whitespace-nowrap text-muted tabular-nums">{stage}</span>
        <ChevronRight aria-hidden="true" className={cn('row-span-2 size-4 text-subtle transition-transform duration-(--duration-quick) ease-out', open && 'rotate-90')} />
        <span title={view.words} className="col-start-2 min-w-0 truncate text-meta text-muted">
          {view.words}
        </span>
        <SegmentBar label={steps.label} className="w-16 justify-self-end" segments={steps.tones.map((tone) => ({ tone }))} />
      </button>
      {open && (
        <div className="min-w-0 pr-4 pb-3 pl-8">
          {partial && (
            <p className="mb-2 min-w-0 rounded-ctl bg-fail-soft p-3 text-meta break-words text-fail-text">
              Couldn't read this crew's events. Showing the last known agents.
            </p>
          )}
          {stuck && <StuckCard crew={crew} stuck={stuck} now={now} />}
          <ul id={listId} aria-label={`Members of ${crew.slug}`} className="mt-2 flex max-h-64 min-w-0 flex-col gap-2 overflow-y-auto">
            {agents.length === 0 && <li className="text-meta text-muted">No agents yet.</li>}
            {agents.map((m) => {
              const model = modelKey(m.model)
              const task = memberTask(m, crew, goals)
              return (
                <li key={m.name} className="flex min-w-0 flex-col">
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusGlyph glyph={crew.status === 'dropped' ? 'plan' : MEMBER_GLYPH[agentStatus(m, crew)]} small />
                    <span className="min-w-0 truncate text-ui font-semibold text-fg">{roleWord(m)}</span>
                    {model && (
                      <span title={m.model ?? undefined} className="flex shrink-0 items-center gap-1 text-meta text-muted">
                        <span aria-hidden="true" className={cn('size-1.5 rounded-full', pipClass(m.model))} />
                        {model}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-meta whitespace-nowrap text-muted">{memberState(m, crew)}</span>
                  </div>
                  {task && (
                    <span title={task} className="min-w-0 truncate pl-5 text-meta text-muted">
                      {task}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </li>
  )
}
