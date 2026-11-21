// The conversation with the PM: a chat thread with the PM's hand-offs to crews
// woven in as system lines. The log is its own scroll container. It follows new items only while the reader sits
// at the bottom; once they scroll up it holds still and offers "New messages". It shows the newest PAGE items and
// adds PAGE more on request. A card's "Read in thread" reaches a message through REVEAL_EVENT.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Square, TriangleAlert } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import type { RunState } from '../../store/types.ts'
import { hhmm } from '../rail/format.ts'
import { REVEAL_EVENT } from '../move/format.ts'
import { Bubble } from './Bubble.tsx'
import { Markdown } from './Markdown.tsx'
import { PmAvatar } from './PmAvatar.tsx'
import { SystemLine } from './SystemLine.tsx'
import { isGrouped, mergeThread, PAGE, type ThreadItem } from './thread.ts'

/** What the page itself knows of the workspace's session: a stop under way, or done (at is the page's clock, null after a reload). */
export type Lifecycle = { kind: 'stopping' } | { kind: 'stopped'; at: number | null }

export interface TranscriptProps {
  state: RunState | null
  now: number
  lifecycle?: Lifecycle | null
}

const OUTSIDE_RUN = "This run was started outside the page, so its messages aren't shown here. Send a message to the PM to continue."
const FIRST_USE = 'No messages yet. Send the project manager a goal or a question.'

export const lifecycleWords = (l: Lifecycle): string =>
  l.kind === 'stopping'
    ? 'Stopping the session…'
    : `Session stopped${l.at === null ? '' : ` at ${hhmm(new Date(l.at).toISOString())}`}. Its Claude Code process has ended.`
const RECORDED_MAX = 8 // the newest messages of messages.jsonl the page lists under the thread
const WORKING = 'Working on it…'
const STILL_WORKING = 'Still working. Crews may be running; their progress shows in Build network.'
const ENDED = 'The session has ended. Reload to start a new one.'
const LONG_WAIT_MS = 3 * 60_000

const smooth = (): ScrollBehavior =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

/** Fenced blocks and 4-space-indented lines become a pre that scrolls inside the bubble. */
function Body({ text }: { text: string }) {
  const parts: { code: boolean; text: string }[] = []
  let fence = false
  for (const line of text.split('\n')) {
    const isFence = /^\s*```/.test(line)
    const code = fence || isFence || /^( {4}|\t)/.test(line)
    if (isFence) fence = !fence
    const body = isFence ? '' : line
    const last = parts[parts.length - 1]
    if (last && last.code === code) last.text += (isFence ? '' : '\n') + body
    else if (!(isFence && !code)) parts.push({ code, text: body })
  }
  if (parts.every((p) => !p.code)) return <>{text}</>
  return (
    <>
      {parts.map((p, i) =>
        p.code ? (
          <pre key={i} className="my-1 max-w-full overflow-x-auto rounded-ctl bg-sunken p-2 font-mono text-meta whitespace-pre [overflow-wrap:normal]">
            {p.text.replace(/^\n/, '')}
          </pre>
        ) : (
          <Fragment key={i}>{p.text.replace(/^\n/, '')}</Fragment>
        ),
      )}
    </>
  )
}

function Dots() {
  return (
    <span aria-hidden="true" className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 rounded-full bg-muted"
        />
      ))}
    </span>
  )
}

export function Transcript({ state, now, lifecycle = null }: TranscriptProps) {
  const transcript = state?.transcript
  const flow = state?.session.flow
  const queue = state?.session.queue
  const items = useMemo(() => mergeThread(transcript ?? [], flow ?? [], queue ?? []), [transcript, flow, queue])
  const runMessages = state?.run?.messages
  const recorded = useMemo(() => (runMessages ?? []).slice(-RECORDED_MAX), [runMessages])
  const [limit, setLimit] = useState(PAGE)
  const shown = items.length > limit ? items.slice(items.length - limit) : items
  const hiddenCount = items.length - shown.length

  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const keep = useRef<{ height: number; top: number } | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const litTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [behind, setBehind] = useState(false)
  const [reveal, setReveal] = useState<number | null>(null)
  const [lit, setLit] = useState<number | null>(null)
  const last = items.length ? items[items.length - 1]!.key : ''

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    if (atBottom.current) el.scrollTop = el.scrollHeight
    else setBehind(true)
  }, [last])

  // Items off screen get their real height after layout (content-visibility:auto): while the reader has not
  // scrolled up, keep the log on its real bottom as the list grows.
  useEffect(() => {
    const el = box.current
    const list = el?.querySelector('ol')
    if (!el || !list || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(list)
    return () => ro.disconnect()
  }, [last, state])

  // After "Show earlier messages" the reader keeps looking at the same message: restore by the height delta.
  useLayoutEffect(() => {
    const el = box.current
    const k = keep.current
    if (!el || !k) return
    keep.current = null
    el.scrollTop = k.top + (el.scrollHeight - k.height)
  }, [limit])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom.current) setBehind(false)
  }
  const toBottom = () => {
    const el = box.current
    if (!el) return
    atBottom.current = true
    setBehind(false)
    el.scrollTo({ top: el.scrollHeight, behavior: smooth() })
    el.focus({ preventScroll: true })
    // Items off screen are sized by estimate (content-visibility:auto), so the first target can fall short:
    // once the smooth scroll has settled, land on the real bottom.
    const settle = () => {
      el.removeEventListener('scrollend', settle)
      clearTimeout(timer)
      if (el.scrollHeight - el.scrollTop - el.clientHeight >= 1) el.scrollTop = el.scrollHeight
      atBottom.current = true
    }
    const timer = setTimeout(settle, 700)
    el.addEventListener('scrollend', settle)
  }
  const earlier = () => {
    const el = box.current
    if (el) keep.current = { height: el.scrollHeight, top: el.scrollTop }
    setLimit((l) => l + PAGE)
  }

  const onReveal = useCallback((e: Event) => {
    const n = (e as CustomEvent<{ n?: number }>).detail?.n
    if (typeof n !== 'number') return
    const all = itemsRef.current
    const at = all.findIndex((i) => i.kind === 'message' && i.entry.n === n)
    if (at < 0) return
    setLimit((l) => Math.max(l, Math.ceil((all.length - at) / PAGE) * PAGE))
    setReveal(n)
  }, [])
  useEffect(() => {
    window.addEventListener(REVEAL_EVENT, onReveal)
    return () => {
      window.removeEventListener(REVEAL_EVENT, onReveal)
      clearTimeout(litTimer.current)
    }
  }, [onReveal])
  useEffect(() => {
    if (reveal === null) return
    const el = document.getElementById(`msg-${reveal}`)
    if (!el) return
    atBottom.current = false
    el.scrollIntoView({ block: 'nearest', behavior: smooth() })
    el.focus({ preventScroll: true })
    setLit(reveal)
    setReveal(null)
    clearTimeout(litTimer.current)
    litTimer.current = setTimeout(() => setLit(null), 1500)
  }, [reveal, shown.length])

  const tail = items[items.length - 1]
  const waiting =
    state?.session.status === 'running' && tail?.kind === 'message' && tail.entry.role === 'user'
      ? now - Date.parse(tail.at) > LONG_WAIT_MS
        ? STILL_WORKING
        : WORKING
      : null
  // A stop the client asked for says so in its own line; the "ended" notice is for a session that died on its own.
  const ended = (state?.session.status === 'ended' || state?.session.status === 'error') && lifecycle === null

  const row = (it: ThreadItem, prev: ThreadItem | undefined) => {
    if (it.kind === 'system') {
      return (
        <li key={it.key} className="mt-4 min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_2rem]">
          <SystemLine entry={it.entry} />
        </li>
      )
    }
    if (it.kind === 'queued') {
      return (
        <Bubble key={it.key} id={`queued-${it.message.id}`} who="you" time={hhmm(it.at)} grouped={false} queued>
          {it.message.text}
        </Bubble>
      )
    }
    const e = it.entry
    const who = e.role === 'user' ? 'you' : e.role === 'error' ? 'error' : 'pm'
    return (
      <Bubble key={it.key} id={`msg-${e.n}`} who={who} time={hhmm(e.ts)} grouped={isGrouped(prev, it)} lit={lit === e.n}>
        {who === 'pm' ? <Markdown text={e.text} /> : <Body text={e.text} />}
      </Bubble>
    )
  }

  return (
    <section aria-labelledby="transcript-h" className="relative flex min-h-40 min-w-0 flex-1 flex-col">
      <h2 id="transcript-h" className="sr-only">
        Conversation
      </h2>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={box}
          role="log"
          aria-label="Conversation with the PM"
          aria-live="polite"
          tabIndex={0}
          onScroll={onScroll}
          className="min-h-24 min-w-0 flex-1 overflow-x-hidden overflow-y-auto rounded-card bg-sunken px-3 py-3 [scroll-behavior:auto] max-h-[70dvh] lg:max-h-none"
        >
          {!state ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-[70%]" />
              <Skeleton className="h-12 w-[55%] self-end" />
              <Skeleton className="h-12 w-[70%]" />
            </div>
          ) : (
            <>
              {hiddenCount > 0 && (
                <div className="mb-4 flex justify-center">
                  <Button variant="ghost" size="sm" className="pointer-coarse:h-11" onClick={earlier}>
                    Show earlier messages
                  </Button>
                </div>
              )}
              {shown.length === 0 && !ended && lifecycle === null ? (
                <ol>
                  <Bubble id="msg-first-use" who="pm" time="" grouped={false} hint>
                    {state.run ? OUTSIDE_RUN : FIRST_USE}
                  </Bubble>
                </ol>
              ) : (
                <ol>{shown.map((it, i) => row(it, shown[i - 1]))}</ol>
              )}
              {lifecycle !== null && (
                <p role="status" className="mt-4 flex min-w-0 items-center justify-center gap-2 text-center text-meta text-muted [overflow-wrap:anywhere]">
                  <Square aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
                  <span>{lifecycleWords(lifecycle)}</span>
                </p>
              )}
              {waiting && (
                <div aria-hidden="true" className="mt-4 flex items-center gap-2 text-meta text-muted">
                  <PmAvatar />
                  <span>{waiting}</span>
                  <Dots />
                </div>
              )}
              {ended && (
                <p className="mt-4 flex items-center justify-center gap-2 text-center text-meta text-fail-text">
                  <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                  {ENDED}
                </p>
              )}
          {recorded.length > 0 && (
            <div className="mt-4 min-w-0">
              <h3 id="recorded-h" className="mb-1 text-meta font-semibold text-muted">
                Recorded messages
              </h3>
              <ol aria-labelledby="recorded-h" className="flex min-w-0 flex-col gap-1">
                {recorded.map((m) => (
                  <li key={`${m.ts}|${m.from}|${m.to}`} className="min-w-0 rounded-ctl bg-sunken px-3 py-2 text-meta text-fg [overflow-wrap:anywhere]">
                    <span className="text-muted">
                      {hhmm(m.ts) !== '' && `${hhmm(m.ts)} `}
                      {m.from} to {m.to}
                    </span>
                    <p>{m.summary}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
            </>
          )}
        </div>
        {behind && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
            <Button
              size="sm"
              className="pointer-events-auto shadow-e2 pointer-coarse:h-11"
              icon={<ArrowDown aria-hidden="true" />}
              onClick={toBottom}
            >
              New messages
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
