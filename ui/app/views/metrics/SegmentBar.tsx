// A row of status segments: the step bar on a crew line and the Agents and Crews merged tiles. A live
// segment carries D2's sheen; under reduced motion it is solid brand. Decorative (aria-hidden) unless it has a
// `label`: the crew line's bar then reads as an image with its progress ("3 of 5 steps done"). A segment's
// colour eases over motion.base, so a step turning done cross-fades.
import { cn } from '../../lib/utils.ts'

export type SegmentTone = 'ok' | 'brand' | 'fail' | 'signal' | 'border' | 'strong' | 'run'

export interface Segment {
  tone: SegmentTone
  live?: boolean
  title?: string
}

const fill: Record<SegmentTone, string> = {
  ok: 'bg-ok',
  brand: 'bg-brand',
  fail: 'bg-fail',
  signal: 'bg-signal',
  border: 'bg-border',
  strong: 'bg-border-strong',
  run: 'bg-run',
}

export interface SegmentBarProps {
  segments: Segment[]
  className?: string
  /** The bar's progress in words; with it the bar is an image with this name, without it the bar is decoration. */
  label?: string
}

export function SegmentBar({ segments, className, label }: SegmentBarProps) {
  const a11y = label ? ({ role: 'img', 'aria-label': label } as const) : ({ 'aria-hidden': true } as const)
  return (
    <span {...a11y} className={cn('flex h-1.5 min-w-0 gap-1', className)}>
      {segments.length === 0 ? (
        <span className="h-full flex-1 rounded-full bg-border" />
      ) : (
        segments.map((s, i) => (
          <span key={i} title={s.title} className={cn('h-full min-w-0 flex-1 overflow-hidden rounded-full transition-colors duration-(--duration-base) ease-out', fill[s.tone])} />
        ))
      )}
    </span>
  )
}
