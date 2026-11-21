// The shared detail dialog (S2): an ADR, a deliverable, Spend by model, the architecture doc, the plan.
// The client's own markup, not a scroll-locking modal primitive: role dialog, aria-modal named by its
// title, a focus trap, Escape to close. Opening focuses the ×; the caller returns focus to the opener in
// onClose. The header and footer stay in place; only the body scrolls.
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { Badge } from '../../components/ui/badge.tsx'

export interface DeliverableDialogProps {
  onClose: () => void
  /** The body: any content. */
  children: ReactNode
  /** Mono line above the title, such as the number of a decision record. */
  kicker?: string
  title?: string
  subtitle?: string
  /** The status pill's words. */
  status?: string
  /** Set for an ADR waiting for approval: the footer gets Approve, the same request as Your move. */
  onApprove?: () => void
  /** The approval POST is under way: Approve shows pending. */
  approving?: boolean
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function DeliverableDialog({ onClose, children, kicker, title = 'Deliverable', subtitle, status, onApprove, approving = false }: DeliverableDialogProps) {
  const box = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    // Focus moves into the dialog when it opens: the ×.
    box.current?.querySelector<HTMLElement>(`[aria-label="Close"]`)?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !box.current) return
    const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
    if (all.length === 0) {
      e.preventDefault()
      return
    }
    const first = all[0]!
    const last = all[all.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && (active === first || !box.current.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !box.current.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div aria-hidden="true" className="absolute inset-0 bg-scrim" onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="relative flex max-h-[85dvh] w-full max-w-2xl min-w-0 animate-confirm-in flex-col overflow-hidden rounded-t-panel bg-surface text-fg shadow-e-hero sm:rounded-panel"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            {kicker && <p className="font-mono text-micro break-all text-muted">{kicker}</p>}
            <h2 id={titleId} className="text-title font-semibold break-words text-fg">
              {title}
            </h2>
            {subtitle && <p className="text-ui break-words text-muted">{subtitle}</p>}
          </div>
          {status && (
            <Badge tone="neutral" size="sm" className="shrink-0">
              {status}
            </Badge>
          )}
          <Button variant="ghost" size="icon" aria-label="Close" className="size-8 shrink-0" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          {onApprove && (
            <Button variant="secondary" pending={approving} onClick={onApprove}>
              {approving ? 'Sending…' : 'Approve'}
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </footer>
      </div>
    </div>
  )
}
