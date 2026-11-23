// Your move: what the run needs from the person right now. It is the one dark hero card of the page: a title, the
// count in words, then one block per ask (a kind line, the question, buttons with the first as the main one) and
// the run's open inbox items. A pressed button reads Sending… and stays until the server's request status changes;
// then the block becomes a status line. With nothing open the card keeps its title and says so.
// The card scrolls inside itself (min-h-0, overflow-y-auto) so the crews under it keep their lines in view.
import { useEffect, useRef, useState } from 'react'
import type { Request, RunState } from '../../store/types.ts'
import { postWorkspaceAnswer } from '../../store/api.ts'
import { pageWorkspaces } from '../../store/workspaces.ts'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import { Notice } from '../../components/ui/notice.tsx'
import { OpenItemBlocks, openItemsOf } from '../workspaces/OpenItems.tsx'
import { QuestionCard } from './QuestionCard.tsx'
import { ReplyCard } from './ReplyCard.tsx'
import { PermissionCard } from './PermissionCard.tsx'
import {
  AGAIN_SAFE,
  GOAL_BOX_ID,
  NOT_REACHED,
  SESSION_ENDED,
  cardName,
  hasWork,
  hhmm,
  NO_WORK,
  needWords,
  noteResult,
  notSent,
  openCards,
  plural,
  reasonOf,
  replyWaitsOnAgents,
  settledWords,
  usePageFlags,
  type AnswerBody,
} from './format.ts'

export interface YourMoveProps {
  state: RunState | null
  now: number
  /** The workspace the card speaks for; read from the workspace store when the page does not pass it. */
  workspace?: { id: string; name: string }
}

/** Answered blocks that stay under the open ones. */
const MAX_SETTLED = 3

const CARD =
  'flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto rounded-panel bg-move p-4 text-move-fg shadow-e-hero outline-none [&_:focus-visible]:outline-focus-on-move lg:max-h-[calc(100dvh-20rem)]'

interface Local {
  /** What this page posted and the server took (200, or 409 answered). */
  sent?: AnswerBody
  /** The server said 409 cancelled. */
  cancelled?: boolean
  error?: string | null
}

function answerError(status: number, error: string | null): string {
  if (status === 409 && error === 'ended') return SESSION_ENDED
  const why =
    status === 404
      ? 'The request no longer exists on the server.'
      : status === 400
        ? 'The server did not accept that answer.'
        : status === 0
          ? 'Could not reach the server.'
          : `The server answered ${status}.`
  return `${why} ${NOT_REACHED} ${AGAIN_SAFE}`
}

/** The selected workspace's name when the page did not pass one: the store's list row of the selected id. */
function storeName(): string | null {
  if (typeof window === 'undefined') return null
  const w = pageWorkspaces()
  const id = w.getView().id
  return w.getList().items?.find((x) => x.id === id)?.name ?? null
}

export function YourMove({ state, now, workspace }: YourMoveProps) {
  const flags = usePageFlags()
  const [local, setLocal] = useState<Record<string, Local>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const inFlight = useRef(new Set<string>())
  const region = useRef<HTMLElement>(null)
  const handOn = useRef(false)

  const isSettledHere = (r: Request) => r.status !== 'open' || local[r.id]?.sent !== undefined || local[r.id]?.cancelled === true
  const open = openCards(state).filter((r) => !isSettledHere(r))
  const items = openItemsOf(state)
  const openCount = open.length + items.length

  // The tab title counts what waits on the person.
  useEffect(() => {
    document.title = openCount > 0 ? `(${openCount}) Ankur` : 'Ankur'
  }, [openCount])

  // After an answer, focus goes to the next open block's first control, else the goal box.
  useEffect(() => {
    if (!handOn.current) return
    handOn.current = false
    const a = document.activeElement
    if (a && a !== document.body && region.current?.contains(a) === false) return
    const next = region.current?.querySelector<HTMLElement>(
      'article[data-open="true"] :is(button, input, textarea, [role="radio"]):not(:disabled):not([aria-disabled="true"]):not([tabindex="-1"])',
    )
    if (next) next.focus()
    else document.getElementById(GOAL_BOX_ID)?.focus()
  })

  const answer = async (r: Request, body: AnswerBody) => {
    if (inFlight.current.has(r.id)) return
    inFlight.current.add(r.id)
    setBusyId(r.id)
    setLocal((m) => ({ ...m, [r.id]: { ...m[r.id], error: null } }))
    const res = await postWorkspaceAnswer(pageWorkspaces().getView().id ?? '', r.id, body)
    inFlight.current.delete(r.id)
    setBusyId((b) => (b === r.id ? null : b))
    noteResult(res.status, res.error)
    if (res.status === 200 || (res.status === 409 && res.error === 'answered')) {
      handOn.current = true
      setLocal((m) => ({ ...m, [r.id]: { sent: body, error: null } }))
      return
    }
    if (res.status === 409 && res.error === 'cancelled') {
      handOn.current = true
      setLocal((m) => ({ ...m, [r.id]: { cancelled: true, error: null } }))
      return
    }
    // A reply block words a failure like the composer does: "Not sent: <reason>. Your text is still here."
    const words =
      r.kind === 'reply' && !(res.status === 409 && res.error === 'ended')
        ? notSent(reasonOf(res.status, res.error))
        : answerError(res.status, res.error)
    setLocal((m) => ({ ...m, [r.id]: { ...m[r.id], error: words } }))
  }

  const title = (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <h2 id="your-move-title" className="text-lead font-semibold text-move-fg">
        Your move
      </h2>{' '}
      {state !== null && hasWork(state, items.length) && (
        <span className="shrink-0 text-meta font-medium text-move-muted tabular-nums">{needWords(openCount)}</span>
      )}{' '}
    </div>
  )

  if (state === null) {
    return (
      <section id="your-move" data-surface="move" aria-labelledby="your-move-title" aria-busy="true" tabIndex={-1} className={CARD}>
        {title}
        <Skeleton className="h-24 w-full bg-move-line" />
      </section>
    )
  }

  const name = workspace?.name ?? storeName() ?? 'this workspace'
  const settled = state.requests
    .filter(isSettledHere)
    .sort((a, b) => Date.parse(b.answeredAt ?? b.createdAt) - Date.parse(a.answeredAt ?? a.createdAt))
    .slice(0, MAX_SETTLED)
  // A reply that came back while agents still run asks nothing; it keeps a quiet block with its text.
  const waitingReplies = state.requests.filter(
    (r): r is Extract<Request, { kind: 'reply' }> => r.status === 'open' && !isSettledHere(r) && replyWaitsOnAgents(r),
  )
  const renderOpen = (r: Request) => {
    const props = { now, busy: busyId === r.id, error: local[r.id]?.error ?? null }
    if (r.kind === 'question') return <QuestionCard key={r.id} request={r} {...props} onAnswer={(b) => void answer(r, b)} />
    if (r.kind === 'permission') return <PermissionCard key={r.id} request={r} {...props} onAnswer={(b) => void answer(r, b)} />
    return <ReplyCard key={r.id} request={r} {...props} transcript={state.transcript} onAnswer={(b) => void answer(r, b)} />
  }

  const waitingBlock = (r: Extract<Request, { kind: 'reply' }>) => (
    <article
      key={r.id}
      aria-label={cardName(r)}
      data-request={r.id}
      className="flex min-w-0 flex-col gap-1 border-t border-move-line pt-4 text-ui first:border-t-0 first:pt-0"
    >
      <p className="line-clamp-3 min-w-0 text-move-fg whitespace-pre-wrap [overflow-wrap:anywhere]">{r.text}</p>
      <p className="min-w-0 text-meta text-move-muted [overflow-wrap:anywhere]">
        Agents still running; nothing needed from you ({plural(r.backgroundTasks, 'background task')}).
      </p>
    </article>
  )

  const settledBlock = (r: Request) => {
    const { head, lines } = settledWords(local[r.id]?.cancelled ? { ...r, status: 'cancelled' } : r, local[r.id]?.sent ?? null)
    const when = hhmm(r.answeredAt)
    return (
      <article
        key={r.id}
        aria-label={cardName(r)}
        data-request={r.id}
        className="flex min-w-0 flex-col gap-1 border-t border-move-line pt-4 text-ui first:border-t-0 first:pt-0"
      >
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-move-fg">{cardName(r)}</span>
          {when && <span className="font-mono text-meta text-move-muted tabular-nums">{when}</span>}
        </p>
        {r.kind === 'permission' && (r.title || r.summary) && (
          <p className="min-w-0 text-move-fg [overflow-wrap:anywhere]">
            {r.title}
            {r.title && r.summary ? ' ' : ''}
            {r.summary && <code className="rounded-chip bg-move-fg/10 px-1 py-1 font-mono text-meta">{r.summary}</code>}
          </p>
        )}
        {r.kind === 'reply' && r.text && <p className="line-clamp-3 min-w-0 text-move-fg whitespace-pre-wrap [overflow-wrap:anywhere]">{r.text}</p>}
        <p role="status" className="min-w-0 text-move-muted [overflow-wrap:anywhere]">
          {head}
        </p>
        {lines.map((l, i) => (
          <p key={i} className="min-w-0 text-meta text-move-muted [overflow-wrap:anywhere]">
            {l}
          </p>
        ))}
      </article>
    )
  }

  const hasBlocks = openCount > 0 || waitingReplies.length > 0 || settled.length > 0

  return (
    <section id="your-move" ref={region} data-surface="move" aria-labelledby="your-move-title" tabIndex={-1} className={CARD}>
      {title}

      {flags.ended && <Notice tone="fail">{SESSION_ENDED}</Notice>}

      {openCount === 0 && !flags.ended && (
        <p className="text-ui text-move-muted">
          {hasWork(state, items.length) || state.transcript.length > 0 ? `Nothing needs you in ${name}.` : NO_WORK}
        </p>
      )}

      {/* Every block is keyed under one list, so when an ask is settled the next one moves up in place and keeps what was typed in it. */}
      {hasBlocks && (
        <div className="flex min-w-0 flex-col gap-4">
          {open.map(renderOpen)}
          <OpenItemBlocks items={items} />
          {waitingReplies.map(waitingBlock)}
          {settled.map(settledBlock)}
        </div>
      )}
    </section>
  )
}
