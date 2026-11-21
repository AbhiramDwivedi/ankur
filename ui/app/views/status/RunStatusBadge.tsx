// The run-level status: Not started, Working, Waiting on you, Finished. Word and
// icon share one element, as in StatusBadge. RUN_TONE and RunStatusIcon are the one tone and icon map: the banner
// badge and the workspace rail both import them, so a recolour touches this file only.
import { CircleCheck, CircleDashed, Hand } from 'lucide-react'
import { Badge, type BadgeTone } from '../../components/ui/badge.tsx'
import { ActiveIcon } from './StatusBadge.tsx'
import { RUN_STATUS_WORD, type RunStatus } from './status.ts'

export interface RunStatusBadgeProps {
  status: RunStatus
  size?: 'sm' | 'md'
  /** Replaces the status word, keeping the status's tone and glyph (the banner's "No session yet"). */
  word?: string
}

export const RUN_TONE: Record<RunStatus, BadgeTone> = { 'not-started': 'neutral', working: 'brand', waiting: 'signal', finished: 'ok' }

/** The text colour of a status word set on a plain surface (the rail), per tone; `ok` and `neutral` stay quiet. */
export const TONE_TEXT: Record<BadgeTone, string> = {
  neutral: 'text-muted',
  brand: 'text-brand-strong',
  signal: 'text-signal-text',
  fail: 'text-fail-text',
  ok: 'text-fg',
  move: 'text-fg',
  'fail-solid': 'text-fail-text',
}

export function RunStatusIcon({ status }: { status: RunStatus }) {
  switch (status) {
    case 'working': return <ActiveIcon />
    case 'waiting': return <Hand aria-hidden="true" className="size-3.5 shrink-0" />
    case 'finished': return <CircleCheck aria-hidden="true" className="size-3.5 shrink-0 text-ok" />
    case 'not-started': return <CircleDashed aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
  }
}

export function RunStatusBadge({ status, size = 'md', word }: RunStatusBadgeProps) {
  return (
    <Badge tone={RUN_TONE[status]} size={size}>
      <span className="inline-flex items-center gap-1">
        <RunStatusIcon status={status} />
        <span>{word ?? RUN_STATUS_WORD[status]}</span>
      </span>
    </Badge>
  )
}
