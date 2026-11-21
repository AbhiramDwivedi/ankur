// The two-line Approve and Deny buttons of an approval ask: the word and icon on the
// first line, what the press sends on the second, so the name starts with the word and ends with the hint.
import type { ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/utils.ts'

export const APPROVE_HINT = 'Sends: Approved.'
export const DENY_HINT = 'Sends: Not approved.'

interface DecisionButtonProps {
  kind: 'allow' | 'deny'
  /** The main look: only Approve, and only while the reply box is empty. */
  primary: boolean
  /** This is the button pressed and its POST is under way. */
  pending: boolean
  /** Another button of the ask is under way. */
  disabled: boolean
  onPress: () => void
}

export function DecisionButton({ kind, primary, pending, disabled, onPress }: DecisionButtonProps) {
  const allow = kind === 'allow'
  const line: ReactNode = (
    <span className="flex min-w-0 flex-col items-start text-left">
      <span>{allow ? 'Approve' : 'Deny'}</span>{' '}
      <span className={cn('text-micro font-normal whitespace-normal', primary ? 'text-move' : 'text-move-muted')}>
        {allow ? APPROVE_HINT : DENY_HINT}
      </span>
    </span>
  )
  return (
    <Button
      variant={primary ? 'on-move' : 'move'}
      className="h-auto min-h-9 py-2 max-sm:w-full max-sm:justify-start"
      pending={pending}
      disabled={disabled}
      data-main={primary ? 'true' : undefined}
      icon={allow ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
      onClick={onPress}
    >
      {pending ? 'Sending…' : line}
    </Button>
  )
}
