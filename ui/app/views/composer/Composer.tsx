// The Message form: the first send starts an ankur run, later sends are messages or a
// new goal. Enter sends, Shift+Enter is a newline; on any failure the text stays in the box.
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowUp, Play, Plus } from 'lucide-react'
import type { Connection, RunState } from '../../store/types.ts'
import { postWorkspaceMessage } from '../../store/api.ts'
import { cn } from '../../lib/utils.ts'
import { Button } from '../../components/ui/button.tsx'
import { Textarea } from '../../components/ui/textarea.tsx'
import { InputGroup, InputGroupAction } from '../../components/ui/input-group.tsx'
import { Hint } from '../../components/ui/hint.tsx'
import { triggerLook } from '../../components/ui/tabs.tsx'
import {
  CARD_OPEN_HINT,
  GOAL_BOX_ID,
  STILL_SENDING,
  WORKING_STATUS,
  noteResult,
  notSent,
  openCards,
  reasonOf,
  usePageFlags,
  useSendState,
} from '../move/format.ts'
import { FollowUps } from './FollowUps.tsx'

export interface ComposerProps {
  state: RunState | null
  now: number
  /** The workspace this composer sends to; the composer is keyed by it, so a typed goal never crosses over. */
  workspace: { id: string; name: string }
  connection: Connection
  /** A stop under way makes the box read-only; a stopped session makes the next goal start a new one. */
  lifecycle?: 'stopping' | 'stopped' | null
  /** A message was taken by the server. */
  onSent?: () => void
}

type Choice = 'message' | 'goal'

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'message', label: 'Message' },
  { value: 'goal', label: 'New goal' },
]

// The session never took the message (the 30 s alert and the page's own 15 s timeout both land here); sending again is safe.
const NOT_TAKEN = 'The session has not taken the message. Try again, or reload if it keeps happening. Sending again is safe.'
const EXPIRED_HINT = "This page's session has expired. Reload to continue."
const OFFLINE_HINT = 'Not connected. Your text is kept.'
const TYPE_FIRST = 'Type a goal first.'
const START_HINT = 'Starts an ankur run on this goal.'
const MESSAGE_HINT = 'Sends to the PM as a message.'
const GOAL_HINT = 'Sends to the PM as a new goal for this run.'

function grow(box: HTMLTextAreaElement | null) {
  if (!box) return
  box.style.height = 'auto'
  const edge = box.offsetHeight - box.clientHeight
  box.style.height = `${box.scrollHeight + edge}px`
}

export function Composer({ state, now, workspace, connection, lifecycle = null, onSent }: ComposerProps) {
  const base = useId()
  const flags = usePageFlags()
  const [text, setText] = useState('')
  const [picked, setChoice] = useState<Choice | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const sending = useRef(false)
  const refocus = useRef(false)

  // The Send as default of Message appears once a plan exists or a goal was sent.
  const stopping = lifecycle === 'stopping'
  // After a stop the next goal starts a new session: the box reads as it did before the first goal.
  const planned =
    lifecycle !== 'stopped' &&
    state !== null &&
    ((state.run !== null && state.run.version !== null) || state.transcript.some((e) => e.role === 'user' && e.intent === 'goal'))
  const sentAny = state !== null && (state.transcript.some((e) => e.role === 'user') || (state.session.queue ?? []).length > 0)
  const cardOpen = openCards(state).length > 0
  const stage = useSendState(busy, error !== null)
  const expired = flags.expired
  const offline = connection !== 'live'
  const empty = text.trim() === ''
  // Before a run the composer defaults to New goal (a goal starts /ankur:run); once planned it defaults to Message.
  const choice: Choice = lifecycle === 'stopped' ? 'goal' : (picked ?? (planned ? 'message' : 'goal'))
  const asGoal = choice === 'goal'
  const lastEntry = state?.transcript[state.transcript.length - 1]
  const working = state?.session.status === 'running' && lastEntry?.role === 'user'

  // A single-repo server (workspace id '') has the same label and button words; only its placeholder differs.
  const legacy = workspace.id === ''
  const sendName = !planned && choice === 'goal' ? 'Start' : choice === 'goal' ? 'Add as new goal' : 'Send'
  const starts = !planned && choice === 'goal'
  const SendIcon = !planned && choice === 'goal' ? Play : choice === 'goal' ? Plus : ArrowUp
  const hintId = `${base}-hint`
  const alertId = `${base}-alert`
  const stuck = stage === 'stuck' && error === null
  const alertText = error ?? (stuck ? NOT_TAKEN : null)

  let hint: string
  if (expired) hint = EXPIRED_HINT
  else if (offline) hint = OFFLINE_HINT
  else if (cardOpen) hint = CARD_OPEN_HINT
  else if (!planned && choice === 'goal') hint = empty ? TYPE_FIRST : START_HINT
  else hint = choice === 'goal' ? GOAL_HINT : MESSAGE_HINT

  // A workspace with no messages yet and nothing to answer: the box is where the client starts. With an ask open the
  // client starts at the skip link, which leads to Your move.
  const firstUse = state !== null && state.transcript.length === 0 && !cardOpen
  // Only when focus has nowhere else: Alt+Up and Alt+Down put it on the new workspace row, and the composer must not
  // take it back when that workspace's state arrives.
  useEffect(() => {
    const at = document.activeElement
    if (firstUse && (at === null || at === document.body)) box.current?.focus()
  }, [firstUse])

  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    box.current?.focus()
  })

  const send = async (retry = false) => {
    if ((sending.current && !retry) || expired || offline || stopping) return
    if (empty) {
      box.current?.focus()
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const sent = text
    const res = await postWorkspaceMessage(workspace.id, sent, asGoal ? 'goal' : undefined)
    sending.current = false
    setBusy(false)
    const tokenDead = noteResult(res.status, res.error)
    if (res.status === 202 || res.status === 200) {
      // Clear only what was sent: anything typed while the send was on its way stays in the box.
      setText((cur) => (cur.startsWith(sent) ? cur.slice(sent.length) : cur))
      if (box.current && box.current.value === sent) box.current.style.height = ''
      if (planned && choice === 'goal') setChoice(null)
      onSent?.()
      return
    }
    if (tokenDead) return
    // The page's own 15 s timeout means the session never took the message: say so as the 30 s stuck alert does.
    const reason = reasonOf(res.status, res.error)
    setError(
      res.status === 0 && res.error === 'timeout'
        ? NOT_TAKEN
        : starts
          ? `Could not start the session: ${reason}. Your goal is kept; press Start to try again.`
          : `${notSent(reason)} Sending again is safe.`,
    )
    refocus.current = true
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const moveChoice = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const next = (i + step + CHOICES.length) % CHOICES.length
    setChoice(CHOICES[next]!.value)
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <form
      id="composer"
      aria-label="Message"
      noValidate
      className="flex min-w-0 shrink-0 flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <label htmlFor={GOAL_BOX_ID} className="sr-only">
        Message the project manager in {workspace.name}
      </label>

      <div
        role="radiogroup"
        aria-label="Send as"
        className="inline-flex max-w-full items-center gap-1 self-start overflow-x-auto rounded-ctl bg-secondary p-1 no-scrollbar"
      >
        {CHOICES.map((c, i) => {
          const on = c.value === choice
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-state={on ? 'checked' : 'unchecked'}
              tabIndex={on ? 0 : -1}
              onClick={() => setChoice(c.value)}
              onKeyDown={(e) => moveChoice(e, i)}
              className={cn(
                triggerLook,
                'h-8 pointer-coarse:h-11 data-[state=checked]:bg-surface data-[state=checked]:text-fg data-[state=checked]:shadow-e1 data-[state=checked]:ring-1 data-[state=checked]:ring-border',
              )}
            >
              <span className="min-w-0 truncate">{c.label}</span>
            </button>
          )
        })}
      </div>

      <InputGroup>
        <Textarea
          id={GOAL_BOX_ID}
          ref={box}
          variant="bare"
          aria-describedby={alertText ? alertId : hintId}
          aria-invalid={error ? true : undefined}
          rows={3}
          placeholder={
            lifecycle === 'stopped'
              ? `Type a goal to start a new session for ${workspace.name}`
              : planned || choice === 'message'
                ? 'Ask the PM, or add a detail'
                : legacy
                  ? 'Describe the goal, for example: add CSV export'
                  : 'Type a goal, e.g. add rate limiting to the public API'
          }
          className="max-h-[40vh] resize-y focus-visible:outline-2 focus-visible:outline-(--focus) focus-visible:-outline-offset-2"
          value={text}
          disabled={expired}
          readOnly={stopping || busy}
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError(null)
          }}
          onInput={(e) => grow(e.currentTarget)}
          onKeyDown={onKey}
        />
        <InputGroupAction>
          <Button
            type="submit"
            variant="primary"
            pending={busy}
            disabled={expired || offline || empty || stopping}
            icon={<SendIcon aria-hidden="true" />}
            className="pointer-coarse:h-11"
          >
            {busy ? 'Sending…' : sendName}
          </Button>
        </InputGroupAction>
      </InputGroup>

      <Hint id={hintId}>{hint}</Hint>

      <p role="status" className={cn('text-meta text-muted', stage !== 'slow' && !working && 'sr-only')}>
        {stage === 'slow' ? STILL_SENDING : working ? WORKING_STATUS : ''}
      </p>

      {alertText && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2 rounded-ctl px-3 py-2 text-ui',
            error ? 'text-fail-text' : 'bg-signal-soft text-signal-text',
          )}
        >
          <span id={alertId} role="alert" className="min-w-0 [overflow-wrap:anywhere]">
            {alertText}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="pointer-coarse:min-h-11"
            disabled={busy && !stuck}
            onClick={() => void send(true)}
          >
            Try again
          </Button>
        </div>
      )}

      {sentAny && <FollowUps state={state} now={now} />}
    </form>
  )
}
