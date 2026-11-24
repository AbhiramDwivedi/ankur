// "Copy resume command": puts `cd <repo> && claude --resume <id>` (PowerShell form on Windows) on the clipboard and
// says "Copied" for a moment. When the browser has no clipboard (an insecure origin, a refusal) the command shows
// in a read-only field that is already selected, so Ctrl+C or Cmd+C copies it. Every part works by keyboard.
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { resumeCommand } from './command.ts'

export interface CopyResumeProps {
  repo: string
  sessionId: string
  /** The button's words; the default names the action. */
  label?: string
  /** Names the session in the accessible name, for a row that holds many of these. */
  describedAs?: string
  className?: string
  /** The header's form: below the xl width only the icon shows (the words stay for a screen reader), like the notifications button. */
  compact?: boolean
}

export const COPIED_MS = 2000

type Phase = 'idle' | 'copied' | 'manual'

export function CopyResume({ repo, sessionId, label = 'Copy resume command', describedAs, className, compact = false }: CopyResumeProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const field = useRef<HTMLInputElement>(null)
  const command = resumeCommand(repo, sessionId)

  useEffect(() => {
    if (phase !== 'copied') return
    const t = setTimeout(() => setPhase('idle'), COPIED_MS)
    return () => clearTimeout(t)
  }, [phase])

  useEffect(() => {
    if (phase === 'manual') field.current?.select()
  }, [phase])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setPhase('copied')
    } catch {
      setPhase('manual') // no Clipboard API here, or the browser said no
    }
  }

  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center gap-2 ${className ?? ''}`}>
      <Button
        size="sm"
        variant="ghost"
        className="min-h-6 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        icon={phase === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        aria-label={describedAs === undefined ? undefined : `${label}: ${describedAs}`}
        onClick={copy}
      >
        <span className={compact ? 'max-xl:sr-only' : undefined}>{phase === 'copied' ? 'Copied' : label}</span>
      </Button>
      {phase === 'manual' ? (
        <input
          ref={field}
          readOnly
          value={command}
          aria-label="Resume command, copy it with the keyboard"
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-6 w-72 max-w-full rounded-ctl border border-border bg-surface px-2 font-mono text-meta text-fg"
        />
      ) : null}
      <span role="status" className="sr-only">
        {phase === 'copied' ? 'Copied' : phase === 'manual' ? 'This browser blocked the clipboard. The command is selected: copy it with the keyboard.' : ''}
      </span>
    </span>
  )
}
