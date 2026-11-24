// One workspace in the rail (S1): a button with the name, the path, the status word with its glyph and the
// open-request chip. On the current row only, a "Stop session" button opens the inline confirm (S4).
import { useEffect, useRef, useState } from 'react'
import { Square } from 'lucide-react'
import type { PriorSession, ResumeResult, WorkspaceItem } from '../../store/types.ts'
import { Button } from '../../components/ui/button.tsx'
import { StatusGlyph, type Glyph } from '../../components/ui/dot.tsx'
import { Notice } from '../../components/ui/notice.tsx'
import { cn } from '../../lib/utils.ts'
import { noSessionWord, workspaceStatusLabel } from '../status/status.ts'
import { countChip, fitPath, homeRelative } from './format.ts'
import { RowResume } from './RowResume.tsx'
import { STOP_CONFIRM_ID, StopConfirm } from './StopConfirm.tsx'

/** What the page knows of a stop it started: under way, no answer in 15 s, or refused. */
export interface StopLocal {
  phase: 'stopping' | 'stuck' | 'error'
  error?: string
}

export interface WorkspaceRowProps {
  item: WorkspaceItem
  current: boolean
  /** The link is lost: the word is the last one seen, dimmed. */
  stale: boolean
  /** The current row's "stage i of n"; other rows have no run state in memory to read it from. */
  stage: { i: number; n: number } | null
  stop: StopLocal | undefined
  onSelect: (id: string) => void
  onStop: (id: string) => void
  /** Continues a session in this workspace; the page store's resumeSession. Without it the row has no Resume button. */
  onResume?: (id: string, sessionId: string, force: boolean) => Promise<ResumeResult>
  /** The earlier sessions when already known (tests); otherwise the row reads them from the server. */
  sessions?: PriorSession[] | null
}

const RUN_MARK = {
  working: (text: string) => ({ text, glyph: 'run' as Glyph, color: 'text-run-text' }),
  waiting: (text: string) => ({ text, glyph: 'ask' as Glyph, color: 'text-signal-text' }),
  finished: (text: string) => ({ text, glyph: 'done' as Glyph, color: 'text-fg' }),
}
const isRun = (s: WorkspaceItem['status']): s is keyof typeof RUN_MARK => s in RUN_MARK

/** The status of a row as the rail and the disclosure say it: its text, and the glyph and text colour that go with it. */
export function rowStatus(item: WorkspaceItem, stop: StopLocal | undefined, stage: { i: number; n: number } | null, stale: boolean) {
  const stopping = stop?.phase === 'stopping' || stop?.phase === 'stuck' || item.status === 'stopping'
  if (stopping) {
    const text = stop?.phase === 'stuck' ? 'Still stopping…' : workspaceStatusLabel('stopping')
    return { text, glyph: 'idle' as Glyph, color: 'text-fail-text' }
  }
  const text = workspaceStatusLabel(item.status, { stage, reason: item.reason, stale, session: item.session })
  if (item.status === 'failed') return { text, glyph: 'fail' as Glyph, color: 'text-fail-text' }
  if (noSessionWord(item.status, item.session)) return { text, glyph: 'plan' as Glyph, color: 'text-muted' }
  if (isRun(item.status)) return RUN_MARK[item.status](text)
  return { text, glyph: (item.status === 'stopped' ? 'idle' : 'plan') as Glyph, color: 'text-muted' }
}

/** The open-request count of a row: a stopped workspace has no session, so no chip. */
export const rowCount = (item: WorkspaceItem): number => (item.status === 'stopped' ? 0 : item.openRequests)

const canStop = (item: WorkspaceItem) => item.session && (item.status === 'working' || item.status === 'waiting' || item.status === 'finished')

export function WorkspaceRow({ item, current, stale, stage, stop, onSelect, onStop, onResume, sessions }: WorkspaceRowProps) {
  const [confirm, setConfirm] = useState(false)
  const stopBtn = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  const status = rowStatus(item, stop, stage, stale)
  const chip = countChip(rowCount(item))
  const stopping = stop?.phase === 'stopping' || stop?.phase === 'stuck' || item.status === 'stopping'
  // The name is "name, status, N need you": the count's words are the pill's sr-only words, so the count is not lost to a screen reader.
  const label = `${item.name}, ${status.text}${chip ? `, ${rowCount(item)}${chip.sr}` : ''}`

  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    stopBtn.current?.focus()
  })
  const phase = stop?.phase
  useEffect(() => {
    if (phase === 'error') stopBtn.current?.focus()
  }, [phase])

  // When the Stop button goes away (the session is stopped), focus would drop to <body>: hand it to the row's own button.
  const showStop = Boolean(current && (stopping || canStop(item)))
  const hadStop = useRef(showStop)
  const rowBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (hadStop.current && !showStop && (!document.activeElement || document.activeElement === document.body)) rowBtn.current?.focus()
    hadStop.current = showStop
  }, [showStop])

  const keep = () => {
    refocus.current = true
    setConfirm(false)
  }

  return (
    <li className="min-w-0">
      <div className="relative">
      <button
        ref={rowBtn}
        type="button"
        data-ws={item.id}
        title={item.path}
        aria-label={label}
        aria-describedby={chip ? `${item.id}-path ${item.id}-need` : `${item.id}-path`}
        aria-current={current ? 'true' : undefined}
        onClick={() => onSelect(item.id)}
        className={cn(
          'grid h-18 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[1rem_0.875rem_1rem] content-center items-center gap-x-2 rounded-ctl border p-3 text-left',
          'transition-[background-color,border-color,box-shadow] duration-(--duration-quick) ease-(--ease-out) active:translate-y-px',
          current ? 'border-border-strong bg-surface shadow-e1' : 'border-transparent hover:bg-surface active:bg-pressed',
        )}
      >
        <span title={item.name} className={cn('col-start-1 row-start-1 min-w-0 truncate text-ui leading-4 font-semibold', current ? 'text-fg font-semibold' : 'text-fg')}>
          {item.name}
        </span>
        {/* The spaces between the three texts are layout-neutral in a grid, and give the button's visible text its word breaks. */}
        {' '}
        <span aria-hidden="true" className="col-start-1 row-start-2" />
        <span className={cn('col-span-2 col-start-1 row-start-3 flex min-w-0 items-center gap-2 text-meta leading-4', stale ? 'text-muted' : status.color)}>
          <StatusGlyph glyph={status.glyph} />
          <span className="min-w-0 truncate">{status.text}</span>
        </span>
        {' '}
        {/* After the status in the DOM, so the visible text reads in the order of the button's name (name, status, count). */}
        {chip && (
          <span className="col-start-2 row-span-2 row-start-1 inline-flex min-h-6 items-center gap-1 self-center rounded-chip bg-signal-soft px-2 text-meta font-semibold whitespace-nowrap tabular-nums text-signal-text">
            <StatusGlyph glyph="ask" small />
            {/* One element: the visible "N need you" (the direction's words), hidden from the label check and read as the button's description. */}
            <span id={`${item.id}-need`} aria-hidden="true">{`${chip.text} need you`}</span>
          </span>
        )}
      </button>
      {/* The path is not part of the button's name or visible label (the name is name, status, count): it sits over the
          button's empty middle line on the same grid, and the button is described by it. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[1rem_0.875rem_1rem] content-center gap-x-2 border border-transparent p-3">
        <span id={`${item.id}-path`} title={item.path} className="col-start-1 row-start-2 min-w-0 truncate font-mono text-micro leading-3.5 text-muted">
          {fitPath(homeRelative(item.path))}
        </span>
        {/* An invisible copy of the chip holds column 2, so the path ends where the chip begins. */}
        {chip && (
          <span className="invisible col-start-2 row-start-2 inline-flex items-center gap-1 px-2 text-meta font-semibold tabular-nums">
            <StatusGlyph glyph="ask" small />
            <span>{`${chip.text} need you`}</span>
          </span>
        )}
      </div>
      </div>
      {current && (stopping || canStop(item)) && (
        <div className="mt-1 min-w-0 px-1">
          <Button
            ref={stopBtn}
            size="sm"
            variant="secondary"
            pending={stopping}
            icon={<Square aria-hidden="true" className="fill-current" />}
            aria-expanded={confirm}
            aria-controls={STOP_CONFIRM_ID}
            onClick={() => setConfirm((v) => !v)}
          >
            {stopping ? 'Stopping…' : 'Stop session'}
          </Button>
          {confirm && (
            <StopConfirm
              name={item.name}
              pending={stopping}
              onKeep={keep}
              onStop={() => {
                refocus.current = true
                setConfirm(false)
                onStop(item.id)
              }}
            />
          )}
        </div>
      )}
      {current && onResume && !stopping && !canStop(item) && <RowResume item={item} resume={onResume} initial={sessions} />}
      {current && stop?.phase === 'error' && (
        <Notice tone="fail" className="mt-2">
          Could not stop {item.name}: {stop.error}. Try again.
        </Notice>
      )}
      {current && stop?.phase === 'stuck' && (
        <Notice tone="fail" className="mt-2">
          The session has not ended yet.{' '}
          <button type="button" className="rounded-chip font-semibold underline" onClick={() => onStop(item.id)}>
            Try again
          </button>
        </Notice>
      )}
    </li>
  )
}
