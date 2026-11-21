// One open reply request as a block of the Your move card: the PM's turn ended with text and waits on the person.
// "The PM replied" is answered with a reply; only an approval ask ("Approval needed") has Approve and Deny.
import { useId, useRef, useState } from 'react'
import { MessageSquareText, TriangleAlert } from 'lucide-react'
import type { ReplyRequest, TranscriptEntry } from '../../store/types.ts'
import { Button } from '../../components/ui/button.tsx'
import { Label } from '../../components/ui/label.tsx'
import { Textarea } from '../../components/ui/textarea.tsx'
import { ago, cardName, previewText, NOT_TAKEN, plural, replyTarget, revealMessage, STILL_SENDING, useSendState } from './format.ts'
import { DecisionButton } from './ReplyActions.tsx'

type Body = { decision: 'allow' | 'deny' } | { decision: 'message'; message: string }

export interface ReplyCardProps {
  request: ReplyRequest
  now: number
  busy: boolean
  error: string | null
  onAnswer: (body: Body) => void
  /** The thread, so Read in thread can find the PM's message. */
  transcript?: TranscriptEntry[]
}

export function ReplyCard({ request, now, busy, error, onAnswer, transcript = [] }: ReplyCardProps) {
  const base = useId()
  const [message, setMessage] = useState('')
  const last = useRef<Body | null>(null)
  const ask = request.approvalAsk === true
  const stage = useSendState(busy, error !== null && !busy)
  const text = message.trim()
  const hasText = text !== ''
  const target = replyTarget(transcript, request)

  const send = (body: Body) => {
    last.current = body
    onAnswer(body)
  }
  const sendReply = () => {
    if (hasText) send({ decision: 'message', message: text })
  }
  const pressed = last.current

  const alertText = stage === 'stuck' ? NOT_TAKEN : error
  const showAlert = stage === 'stuck' || (stage === 'failed' && error !== null)
  const hint = ask
    ? hasText
      ? 'Sends your text instead of Approved. or Not approved.'
      : null
    : hasText
      ? 'Sends your text to the PM as the reply.'
      : 'Type a reply first.'
  const replyPrimary = !ask || hasText
  const sending = busy && pressed?.decision === 'message'

  return (
    <article
      aria-label={cardName(request)}
      data-request={request.id}
      data-open="true"
      className="flex min-w-0 flex-col gap-3 border-t border-move-line pt-4 first:border-t-0 first:pt-0"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-3 text-meta">
        <span className="font-semibold text-move-fg">{cardName(request)}</span>
        <span className="ml-auto text-move-muted tabular-nums">Asked {ago(request.createdAt, now)}</span>
      </p>
      {request.isError && (
        <p className="flex items-center gap-2 text-ui font-semibold text-move-fg">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          The PM's turn ended with an error.
        </p>
      )}
      <p className="min-w-0 text-body text-move-fg whitespace-pre-wrap [overflow-wrap:anywhere]">{previewText(request.text)}</p>
      {request.backgroundTasks > 0 && (
        <p className="text-meta text-move-muted">
          {plural(request.backgroundTasks, 'background task')} running when the turn ended; the session may start a turn on its own.
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          variant="move"
          size="sm"
          icon={<MessageSquareText aria-hidden="true" />}
          disabled={busy || target === null}
          onClick={() => target !== null && revealMessage(target)}
        >
          Read in thread
        </Button>
        {ask && (
          <>
            <DecisionButton
              kind="allow"
              primary={!hasText}
              pending={busy && pressed?.decision === 'allow'}
              disabled={busy && pressed?.decision !== 'allow'}
              onPress={() => send({ decision: 'allow' })}
            />
            <DecisionButton
              kind="deny"
              primary={false}
              pending={busy && pressed?.decision === 'deny'}
              disabled={busy && pressed?.decision !== 'deny'}
              onPress={() => send({ decision: 'deny' })}
            />
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${base}-reply`} className="text-meta font-medium text-move-fg">
          Your reply
        </Label>
        <Textarea
          id={`${base}-reply`}
          rows={3}
          surface="move"
          autoComplete="off"
          value={message}
          disabled={busy}
          aria-describedby={hint ? `${base}-hint` : undefined}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              if (!busy) sendReply()
            }
          }}
        />
        {hint && (
          <p id={`${base}-hint`} className="text-meta text-move-muted">
            {hint}
          </p>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant={replyPrimary ? 'on-move' : 'move'}
            data-main={replyPrimary && !ask ? 'true' : undefined}
            pending={sending}
            disabled={(busy && !sending) || (!busy && !hasText)}
            onClick={sendReply}
          >
            {sending ? 'Sending…' : 'Send reply'}
          </Button>
        </div>
      </div>
      {stage === 'slow' && (
        <p role="status" className="text-meta text-move-muted">
          {STILL_SENDING}
        </p>
      )}
      {showAlert && alertText && (
        <div role="alert" className="flex min-w-0 flex-wrap items-center gap-2 text-ui text-move-fg">
          <p className="min-w-0">{alertText}</p>
          {pressed && (
            <Button variant="move" size="sm" onClick={() => send(pressed)}>
              Try again
            </Button>
          )}
        </div>
      )}
    </article>
  )
}
