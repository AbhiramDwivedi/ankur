// The stage timeline of the summary strip: an ordered list of Plan, one step per stage of the latest goal, and Merge.
// A done step has the done glyph and joins the next with an ok line; the current step has the sun glyph and
// aria-current="step"; the rest are hollow. The words under each label say what the step holds, so no state rests on colour.
import { StatusGlyph, type Glyph } from '../../components/ui/dot.tsx'
import { cn } from '../../lib/utils.ts'
import type { Crew, RunState } from '../../store/types.ts'
import { hhmm, plural } from '../crews/format.ts'
import { latestGoal } from '../crews/goals.ts'
import { runStatus } from '../status/status.ts'

export interface TimelineProps {
  state: RunState | null
  now: number
}

interface Step {
  key: string
  label: string
  glyph: Glyph
  meta: string
  done: boolean
  current: boolean
}

const isDone = (c: Crew) => c.status === 'merged' || c.status === 'dropped'

/** What a stage holds, in words: the crews running, else the ones done or planned. */
function stageMeta(crews: Crew[]): string {
  const running = crews.filter((c) => c.status === 'running').length
  const done = crews.filter(isDone).length
  const planned = crews.length - running - done
  if (running > 0) return `${plural(running, 'crew')} running`
  if (planned === 0) return `${plural(done, 'crew')} done`
  return done > 0 ? `${done} done, ${planned} planned` : `${plural(planned, 'crew')} planned`
}

function stepsOf(state: RunState | null): Step[] {
  const merge = (done: boolean, current: boolean): Step => ({
    key: 'merge',
    label: 'Merge',
    glyph: done ? 'done' : current ? 'now' : 'plan',
    meta: done ? 'Done' : 'After the last stage',
    done,
    current,
  })
  // No plan and no conversation: nothing has started, so no step is current.
  if (state === null || (state.run === null && state.transcript.length === 0)) {
    return [{ key: 'plan', label: 'Plan', glyph: 'plan', meta: 'Not started', done: false, current: false }, merge(false, false)]
  }
  const goal = latestGoal(state.run)
  const approvedAt = goal?.approvedAt ?? state.run?.approvedAt ?? null
  const crews = goal?.crews ?? []
  const stages = [...new Set(crews.map((c) => c.stage ?? 0))].sort((a, b) => a - b)
  const planDone = approvedAt !== null || stages.length > 0
  const list: Omit<Step, 'glyph' | 'current'>[] = [
    {
      key: 'plan',
      label: 'Plan',
      // A conversation with no run has no plan to approve yet: it never reads "Waiting for approval".
      meta: planDone ? (approvedAt !== null ? `Done ${hhmm(approvedAt)}`.trim() : 'Done') : state.run === null ? 'No plan yet' : 'Waiting for approval',
      done: planDone,
    },
    ...stages.map((n) => {
      const mine = crews.filter((c) => (c.stage ?? 0) === n)
      return { key: `stage-${n}`, label: `Stage ${n}`, meta: stageMeta(mine), done: mine.every(isDone) }
    }),
  ]
  const finished = runStatus(state) === 'finished'
  const at = list.findIndex((s) => !s.done)
  const out: Step[] = list.map((s, i) => ({ ...s, current: i === at, glyph: s.done ? 'done' : i === at ? 'now' : 'plan' }))
  const mergeNow = at < 0 && stages.length > 0 && !finished
  out.push(merge(finished && stages.length > 0, mergeNow))
  return out
}

export function Timeline({ state }: TimelineProps) {
  const steps = stepsOf(state)
  return (
    <ol aria-label="Stage timeline" className="grid min-w-0 grid-cols-2 gap-y-3 sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none">
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={s.current ? 'step' : undefined}
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0 pr-2"
        >
          <StatusGlyph glyph={s.glyph} />
          <span title={s.label} className="min-w-0 truncate text-meta font-semibold text-fg">
            {s.label}
          </span>
          {i < steps.length - 1 && <span aria-hidden="true" className={cn('h-0.5 min-w-3 flex-1 rounded-full', s.done ? 'bg-ok' : 'bg-border')} />}
          <span title={s.meta} className="min-w-0 basis-full truncate pl-5 text-micro text-muted">
            {s.meta}
          </span>
        </li>
      ))}
    </ol>
  )
}
