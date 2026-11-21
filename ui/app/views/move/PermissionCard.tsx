// One open permission request as a block of the Your move card: a tool wants to run. It shows the tool,
// what it would do, why it asked and the blocked path, then Allow (the main button) or Deny with a message.
import { useId, useState } from 'react'
import type { PermissionRequest } from '../../store/types.ts'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { ago, cardName } from './format.ts'

export interface PermissionCardProps {
  request: PermissionRequest
  now: number
  /** The answer POST is under way. */
  busy: boolean
  /** Why the last answer did not go through, in words. */
  error: string | null
  onAnswer: (body: { decision: 'allow' | 'deny'; message?: string }) => void
}

export function PermissionCard({ request, now, busy, error, onAnswer }: PermissionCardProps) {
  const base = useId()
  const [message, setMessage] = useState('')
  const [pressed, setPressed] = useState<'allow' | 'deny' | null>(null)
  const decide = (decision: 'allow' | 'deny') => {
    const m = message.trim()
    setPressed(decision)
    onAnswer(m === '' ? { decision } : { decision, message: m })
  }
  const facts: [string, string | null, boolean][] = [
    ['Tool', request.toolName, false],
    [request.toolName === 'Bash' ? 'Command' : 'Summary', request.summary, true],
    ['Why it asked', request.decisionReason, false],
    ['Blocked path', request.blockedPath, true],
  ]
  const alertId = `${base}-alert`
  return (
    <article
      aria-label={cardName(request)}
      data-request={request.id}
      data-open="true"
      className="flex min-w-0 flex-col gap-3 border-t border-move-line pt-4 first:border-t-0 first:pt-0"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-3 text-meta">
        <span className="font-semibold text-move-fg">Permission request</span>
        <span className="ml-auto text-move-muted tabular-nums">Asked {ago(request.createdAt, now)}</span>
      </p>
      {request.title && <p className="min-w-0 text-body font-medium text-move-fg [overflow-wrap:anywhere]">{request.title}</p>}
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-ui">
        {facts
          .filter(([, v]) => v !== null && v !== '')
          .map(([k, v, mono]) => (
            <div key={k} className="contents">
              <dt className="text-move-muted">{k}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">
                {mono ? <code className="rounded-chip bg-move-fg/10 px-1 py-1 font-mono text-meta">{v}</code> : v}
              </dd>
            </div>
          ))}
      </dl>
      <Input
        aria-label="Message with your answer"
        surface="move"
        placeholder="Optional message to send with your decision"
        autoComplete="off"
        value={message}
        disabled={busy}
        aria-describedby={error ? alertId : undefined}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          variant="on-move"
          data-main="true"
          pending={busy && pressed === 'allow'}
          disabled={busy && pressed !== 'allow'}
          onClick={() => decide('allow')}
        >
          {busy && pressed === 'allow' ? 'Sending…' : 'Allow'}
        </Button>
        <Button variant="move" pending={busy && pressed === 'deny'} disabled={busy && pressed !== 'deny'} onClick={() => decide('deny')}>
          {busy && pressed === 'deny' ? 'Sending…' : 'Deny'}
        </Button>
      </div>
      {error && (
        <p id={alertId} role="alert" className="min-w-0 text-ui text-move-fg">
          {error}
        </p>
      )}
    </article>
  )
}
