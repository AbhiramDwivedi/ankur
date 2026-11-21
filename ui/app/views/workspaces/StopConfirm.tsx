// The inline confirm of "Stop session" (S4): no modal, no focus trap. Focus starts on "Keep running"; Esc or
// "Keep running" closes it and the row puts focus back on its Stop button.
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Button } from '../../components/ui/button.tsx'

export const STOP_CONFIRM_ID = 'stop-confirm'

export interface StopConfirmProps {
  name: string
  /** The stop POST is under way: Stop session reads Stopping… and is pending (aria-disabled, focus kept). */
  pending?: boolean
  onStop: () => void
  onKeep: () => void
}

export function StopConfirm({ name, pending = false, onStop, onKeep }: StopConfirmProps) {
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    keep.current?.focus()
  }, [])
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onKeep()
  }
  return (
    <div
      role="group"
      aria-label="Confirm stop"
      id={STOP_CONFIRM_ID}
      onKeyDown={onKeyDown}
      className="mt-2 flex min-w-0 flex-col gap-2 rounded-ctl border border-border bg-surface p-3 text-meta motion-safe:animate-confirm-in"
    >
      <p className="min-w-0 font-medium text-fg [overflow-wrap:anywhere]">Stop the session for {name}?</p>
      <p className="min-w-0 text-muted">Other workspaces keep running. The conversation stays here.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" pending={pending} onClick={onStop}>
          {pending ? 'Stopping…' : 'Stop session'}
        </Button>
        <Button ref={keep} size="sm" variant="secondary" onClick={onKeep}>
          Keep running
        </Button>
      </div>
    </div>
  )
}
