// The retro as the last line of the Crews card: the same 48 px line as a crew (glyph, "Retro", one status line,
// a five-step bar, a chevron) that opens to its five steps in order. RetroLine is a list item, so BuildNetwork places it
// after the crew lines when state.retro exists.
import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import type { RetroInfo, RunState } from '../../store/types.ts'
import { cn } from '../../lib/utils.ts'
import { StatusGlyph } from '../../components/ui/dot.tsx'
import { SegmentBar } from '../metrics/SegmentBar.tsx'
import { RetroStep } from './RetroStep.tsx'
import { RETRO_STEPS, retroLineView } from './format.ts'

export interface RetroLineProps {
  retro: RetroInfo
  /** The line starts opened (a test seam: the static renderer cannot click). */
  defaultOpen?: boolean
}

export function RetroLine({ retro, defaultOpen = false }: RetroLineProps) {
  const [open, setOpen] = React.useState(defaultOpen)
  const listId = React.useId()
  const view = retroLineView(retro)
  return (
    <li className="min-h-12 min-w-0 border-b border-border last:border-b-0">
      <button
        type="button"
        data-focus="inset"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="grid h-12 w-full grid-cols-[0.75rem_minmax(0,1fr)_auto_1rem] grid-rows-[auto_auto] content-center items-center gap-x-3 px-4 text-left transition-colors duration-(--duration-quick) ease-out hover:bg-sunken active:translate-y-px active:bg-pressed"
      >
        <StatusGlyph glyph={view.glyph} className="row-span-2" />
        <span className="min-w-0 truncate font-mono text-ui font-semibold text-fg">Retro</span>
        <span className="justify-self-end text-micro whitespace-nowrap text-muted tabular-nums">After the crews</span>
        <ChevronRight aria-hidden="true" className={cn('row-span-2 size-4 text-subtle transition-transform duration-(--duration-quick) ease-out', open && 'rotate-90')} />
        <span title={view.words} className="col-start-2 min-w-0 truncate text-meta text-muted">
          {view.words}
        </span>
        <SegmentBar label={view.label} className="w-16 justify-self-end" segments={view.tones.map((tone) => ({ tone }))} />
      </button>
      {open && (
        <div className="min-w-0 pr-4 pb-3 pl-8">
          <ul id={listId} aria-label="Retro steps" className="flex min-w-0 flex-col gap-2">
            {RETRO_STEPS.map((s) => (
              <RetroStep key={s.key} label={s.label} step={retro.steps[s.key]} />
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

export interface RetroRailProps {
  state: RunState | null
  now: number
}

/** Kept so the page shell still imports it: the retro now renders inside BuildNetwork as RetroLine, so this draws nothing. */
export function RetroRail(_props: RetroRailProps) {
  return null
}
