// One step of the retro line: a member-style row of the opened line, glyph, step name and its status in
// words, then the time and the step's detail when it has them.
import type { RetroStep as Step } from '../../store/types.ts'
import { StatusGlyph, type Glyph } from '../../components/ui/dot.tsx'
import { cn } from '../../lib/utils.ts'
import { hhmm } from './format.ts'

export interface RetroStepProps {
  label: string
  step: Step
}

const GLYPH: Record<Step['status'], Glyph> = { pending: 'plan', running: 'run', done: 'done', failed: 'fail', skipped: 'idle' }

export function RetroStep({ label, step }: RetroStepProps) {
  const at = step.at ? hhmm(step.at) : ''
  return (
    <li aria-label={`${label}: ${step.status}`} className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-2">
        <StatusGlyph glyph={GLYPH[step.status]} small />
        <span className="min-w-0 truncate text-ui font-semibold text-fg">{label}</span>
        <span className={cn('ml-auto shrink-0 text-meta whitespace-nowrap', step.status === 'failed' ? 'text-fail-text' : 'text-muted')}>
          {step.status}
          {at && `, ${at}`}
        </span>
      </div>
      {step.detail && <span className="min-w-0 pl-5 text-meta break-words text-muted">{step.detail}</span>}
    </li>
  )
}
