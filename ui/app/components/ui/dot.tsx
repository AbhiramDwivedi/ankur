import { cn } from '../../lib/utils.ts'

// A 6 px status mark. Always aria-hidden and always next to words: it never carries meaning alone.
export type DotTone = 'neutral' | 'brand' | 'signal' | 'fail' | 'ok' | 'move' | 'opus' | 'sonnet'

const fill: Record<DotTone, string> = {
  neutral: 'bg-border-strong',
  brand: 'bg-brand',
  signal: 'bg-signal',
  fail: 'bg-fail',
  ok: 'bg-ok',
  move: 'bg-move',
  opus: 'bg-opus',
  sonnet: 'bg-sonnet',
}

const ring: Record<DotTone, string> = {
  neutral: 'border-border-strong',
  brand: 'border-brand',
  signal: 'border-signal',
  fail: 'border-fail',
  ok: 'border-ok',
  move: 'border-move',
  opus: 'border-opus',
  sonnet: 'border-sonnet',
}

export interface DotProps {
  tone?: DotTone
  /** An outline only, for a state that has not started. */
  hollow?: boolean
  className?: string
}

export function Dot({ tone = 'neutral', hollow = false, className }: DotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-1.5 shrink-0 rounded-full', hollow ? cn('border', ring[tone]) : fill[tone], className)}
    />
  )
}

// A Dot with a ping halo. The halo is its own element, so reduced motion nulls it and the dot stays.
export function LivePing({ tone = 'ok', className }: Omit<DotProps, 'hollow'>) {
  return (
    <span aria-hidden="true" className={cn('relative inline-flex size-1.5 shrink-0', className)}>
      <span className={cn('absolute inset-0 rounded-full opacity-75', fill[tone])} />
      <span className={cn('relative inline-block size-1.5 rounded-full', fill[tone])} />
    </span>
  )
}

// The status glyph: shape and colour both carry the state (the paths are Main.dc.html glyph(), a 12-unit grid).
// run is a blue filled circle, plan a hollow border-strong circle, now the sun circle with an fg ring, idle a
// small border-strong disc, done a grey check, ask a violet diamond, fail a red cross. Brand green is never a status.
// Always aria-hidden and always next to status words or an sr-only label. Fill and stroke ease over motion.base.
export type Glyph = 'run' | 'plan' | 'now' | 'idle' | 'done' | 'ask' | 'fail'

const glyphPath: Record<Glyph, string> = {
  run: 'M6 2a4 4 0 1 1 0 8a4 4 0 1 1 0-8Z',
  plan: 'M6 2a4 4 0 1 1 0 8a4 4 0 1 1 0-8Z',
  now: 'M6 1.8a4.2 4.2 0 1 1 0 8.4a4.2 4.2 0 1 1 0-8.4Z',
  idle: 'M6 3a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z',
  done: 'M2.5 6.4l2.4 2.4L9.6 3.6',
  ask: 'M6 1.5L10.5 6L6 10.5L1.5 6Z',
  fail: 'M3 3l6 6M9 3l-6 6',
}

const glyphLook: Record<Glyph, string> = {
  run: '[&_path]:fill-run',
  plan: '[&_path]:fill-none [&_path]:stroke-border-strong [&_path]:stroke-[1.6]',
  now: '[&_path]:fill-sun [&_path]:stroke-fg [&_path]:stroke-[1.4]',
  idle: '[&_path]:fill-border-strong',
  done: '[&_path]:fill-none [&_path]:stroke-ok [&_path]:stroke-2 [&_path]:[stroke-linecap:round] [&_path]:[stroke-linejoin:round]',
  ask: '[&_path]:fill-signal',
  fail: '[&_path]:fill-none [&_path]:stroke-fail [&_path]:stroke-2 [&_path]:[stroke-linecap:round]',
}

export interface StatusGlyphProps {
  glyph: Glyph
  /** 10 px, for inside pills and member rows. Default is 12 px. */
  small?: boolean
  className?: string
}

export function StatusGlyph({ glyph, small = false, className }: StatusGlyphProps) {
  return (
    <svg
      aria-hidden="true"
      data-glyph={glyph}
      viewBox="0 0 12 12"
      className={cn(
        'shrink-0 overflow-visible [&_path]:transition-[fill,stroke] [&_path]:duration-(--duration-base) [&_path]:ease-out',
        small ? 'size-2.5' : 'size-3',
        glyphLook[glyph],
        className,
      )}
    >
      <path d={glyphPath[glyph]} />
    </svg>
  )
}
