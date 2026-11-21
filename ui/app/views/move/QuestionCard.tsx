// One open question from Claude as a block of the Your move card. A single-choice question is a row of
// buttons, the first (recommended) one main: pressing one answers at once. A multi-select or multi-question ask is
// one form of radiogroups and checkboxes with a Submit button. Both have a `Your own answer` box; Enter in it submits.
// Labels are posted exactly as sent, "(Recommended)" and all.
import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Question, QuestionOption, QuestionRequest } from '../../store/types.ts'
import { cn } from '../../lib/utils.ts'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { ago, cardName } from './format.ts'

export interface QuestionCardProps {
  request: QuestionRequest
  now: number
  /** The answer POST is under way. */
  busy: boolean
  /** Why the last answer did not go through, in words. */
  error: string | null
  onAnswer: (body: { answers: Record<string, string> }) => void
}

const SUFFIX = /\s*\(Recommended\)\s*$/
const isRecommended = (o: QuestionOption) => o.recommended || SUFFIX.test(o.label)
const shown = (o: QuestionOption) => o.label.replace(SUFFIX, '')

/** Recommended options first, the rest in the order they were sent. */
function ordered(q: Question): QuestionOption[] {
  return [...q.options.filter(isRecommended), ...q.options.filter((o) => !isRecommended(o))]
}

const MISSING = 'Answer every question before submitting: choose an option or type your own.'

export function QuestionCard({ request, now, busy, error, onAnswer }: QuestionCardProps) {
  const base = useId()
  const [picks, setPicks] = useState<string[][]>(() => request.questions.map(() => []))
  const [own, setOwn] = useState<string[]>(() => request.questions.map(() => ''))
  const [missing, setMissing] = useState(false)
  const [pressed, setPressed] = useState<string | null>(null)
  const firstRefs = useRef<(HTMLElement | null)[]>([])
  const first = request.questions[0]
  const alertId = `${base}-alert`
  const shownError = missing ? MISSING : error
  const single = request.questions.length === 1 && first !== undefined && !first.multiSelect

  const submit = () => {
    const answers: Record<string, string> = {}
    for (const [qi, q] of request.questions.entries()) {
      const typed = (own[qi] ?? '').trim()
      const chosen = picks[qi] ?? []
      let value: string
      if (q.multiSelect) value = [...chosen, ...(typed ? [typed] : [])].join(', ')
      else value = typed || chosen[0] || ''
      if (value === '') {
        setMissing(true)
        firstRefs.current[qi]?.focus()
        return
      }
      answers[q.question] = value
    }
    setMissing(false)
    setPressed('submit')
    onAnswer({ answers })
  }

  const pick = (qi: number, label: string, multi: boolean) => {
    setMissing(false)
    setPicks((all) =>
      all.map((p, i) => {
        if (i !== qi) return p
        if (!multi) return [label]
        return p.includes(label) ? p.filter((x) => x !== label) : [...p, label]
      }),
    )
  }

  const answerWith = (q: Question, label: string, key = label) => {
    setPressed(key)
    setMissing(false)
    onAnswer({ answers: { [q.question]: label } })
  }

  const ownTyped = (own[0] ?? '').trim()

  return (
    <article
      aria-label={cardName(request)}
      data-request={request.id}
      data-open="true"
      className="flex min-w-0 flex-col gap-3 border-t border-move-line pt-4 first:border-t-0 first:pt-0"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-3 text-meta">
        <span className="font-semibold text-move-fg">Question from Claude</span>
        {first && <span className="min-w-0 text-move-muted">{first.header}</span>}
        <span className="ml-auto text-move-muted tabular-nums">Asked {ago(request.createdAt, now)}</span>
      </p>

      {single ? (
        <div className="flex min-w-0 flex-col gap-3">
          <p id={`${base}-q0`} className="min-w-0 text-body text-move-fg [overflow-wrap:anywhere]">
            {first.question}
          </p>
          <div role="group" aria-labelledby={`${base}-q0`} className="flex min-w-0 flex-wrap items-start gap-3">
            {ordered(first).map((o, i) => {
              const label = shown(o)
              const on = busy && pressed === o.label
              const descId = `${base}-o${i}`
              const note = [isRecommended(o) ? 'Recommended.' : '', o.description].filter(Boolean).join(' ')
              return (
                <div key={o.label} className="flex min-w-0 max-w-full flex-col gap-1">
                  <Button
                    variant={i === 0 ? 'on-move' : 'move'}
                    data-main={i === 0 ? 'true' : undefined}
                    pending={on}
                    disabled={busy && !on}
                    aria-describedby={note ? descId : undefined}
                    onClick={() => answerWith(first, o.label)}
                  >
                    {on ? 'Sending…' : label}
                  </Button>
                  {note && (
                    <span id={descId} className="max-w-[28ch] text-micro text-move-muted [overflow-wrap:anywhere]">
                      {note}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <form
            noValidate
            className="flex min-w-0 flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!busy && ownTyped !== '') answerWith(first, ownTyped, 'own')
            }}
          >
            <Input
              aria-label="Your own answer"
              surface="move"
              placeholder="Or type your own answer"
              autoComplete="off"
              value={own[0] ?? ''}
              disabled={busy}
              className="min-w-0 flex-1"
              onChange={(e) => setOwn([e.target.value])}
            />
            <Button type="submit" variant="move" size="sm" aria-disabled={ownTyped === '' || undefined} pending={busy && pressed === 'own'} disabled={busy && pressed !== 'own'}>
              {busy && pressed === 'own' ? 'Sending…' : 'Send answer'}
            </Button>
          </form>
        </div>
      ) : (
        <form
          noValidate
          className="flex min-w-0 flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy) submit()
          }}
        >
          {request.questions.map((q, qi) => {
            const textId = `${base}-q${qi}`
            const opts = ordered(q)
            const chosen = picks[qi] ?? []
            const checkedAt = opts.findIndex((o) => chosen.includes(o.label))
            const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
              if (q.multiSelect) return
              const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
              if (step === 0) return
              e.preventDefault()
              const next = (i + step + opts.length) % opts.length
              const group = e.currentTarget.closest('[role="radiogroup"]')
              const target = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]
              target?.focus()
              pick(qi, opts[next]!.label, false)
            }
            return (
              <div key={q.question} className="flex min-w-0 flex-col gap-2">
                {request.questions.length > 1 && <span className="text-meta font-semibold text-move-muted">{q.header}</span>}
                <p id={textId} className="min-w-0 text-body text-move-fg [overflow-wrap:anywhere]">
                  {q.question}
                </p>
                {q.multiSelect && <p className="text-meta text-move-muted">Choose any number.</p>}
                <div role={q.multiSelect ? 'group' : 'radiogroup'} aria-labelledby={textId} className="grid min-w-0 gap-2">
                  {opts.map((o, i) => {
                    const on = chosen.includes(o.label)
                    const rec = isRecommended(o)
                    const label = shown(o)
                    const focusable = q.multiSelect || (checkedAt === -1 ? i === 0 : i === checkedAt)
                    const descId = `${base}-q${qi}-o${i}`
                    // The option is one button, so its name matches its visible text (WCAG 2.5.3); the description
                    // and the Recommended word sit beside it, tied on by aria-describedby.
                    return (
                      <div key={o.label} className="flex min-w-0 flex-col gap-1">
                        <button
                          ref={(el) => {
                            if (i === 0) firstRefs.current[qi] = el
                          }}
                          type="button"
                          role={q.multiSelect ? 'checkbox' : 'radio'}
                          aria-checked={on}
                          aria-label={rec ? `${label} (Recommended)` : label}
                          aria-describedby={o.description ? descId : undefined}
                          tabIndex={focusable ? 0 : -1}
                          disabled={busy}
                          onKeyDown={(e) => move(e, i)}
                          onClick={() => pick(qi, o.label, q.multiSelect)}
                          className={cn(
                            'flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-ctl border px-3 text-left text-ui font-semibold transition-colors duration-(--duration-quick) ease-out disabled:cursor-not-allowed disabled:opacity-60',
                            on ? 'border-move-fg bg-move-fg text-move' : 'border-move-line text-move-fg hover:border-move-muted',
                          )}
                        >
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
                          {rec && <span className="shrink-0 text-micro font-medium">Recommended</span>}
                        </button>
                        {o.description && (
                          <span id={descId} className="min-w-0 pl-3 text-meta text-move-muted [overflow-wrap:anywhere]">
                            {o.description}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <Input
                  aria-label="Your own answer"
                  surface="move"
                  placeholder={q.multiSelect ? 'Or add your own answer' : 'Or type your own answer'}
                  autoComplete="off"
                  value={own[qi] ?? ''}
                  disabled={busy}
                  onChange={(e) => {
                    const v = e.target.value
                    setMissing(false)
                    setOwn((all) => all.map((x, i) => (i === qi ? v : x)))
                  }}
                />
              </div>
            )
          })}
          <div>
            <Button type="submit" variant="on-move" data-main="true" pending={busy && pressed === 'submit'} disabled={busy && pressed !== 'submit'}>
              {busy && pressed === 'submit' ? 'Sending…' : 'Submit answers'}
            </Button>
          </div>
        </form>
      )}
      {shownError && (
        <p id={alertId} role="alert" className="min-w-0 text-ui text-move-fg">
          {shownError}
        </p>
      )}
    </article>
  )
}
