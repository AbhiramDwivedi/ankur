// "Resume an earlier session": the repository's earlier Claude Code sessions, newest first. A row resumes that session
// in this workspace (the next message continues it, and the conversation shows what was said before) or copies the
// terminal command that resumes it there. A session another process holds shows the warning and "Resume anyway".
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import { Notice } from '../../components/ui/notice.tsx'
import { getSessions, resumeWorkspace } from '../../store/api.ts'
import type { PriorSession, ResumeResult, SessionsResult } from '../../store/types.ts'
import { CopyResume } from './CopyResume.tsx'
import { NO_PROMPT, TWO_WRITERS, resumeErrorWords, shortId, whenWords } from './format.ts'

export interface ResumePanelProps {
  workspace: { id: string; name: string; path: string }
  /** Asks the server to continue the session; the page store's resumeSession. */
  resume?: (id: string, sessionId: string, force: boolean) => Promise<ResumeResult>
  load?: (id: string) => Promise<SessionsResult>
  /** The workspace now continues a session: the page moves focus to the composer. */
  onResumed?: () => void
}

export function ResumePanel({ workspace, resume = resumeWorkspace, load = getSessions, onResumed }: ResumePanelProps) {
  const [sessions, setSessions] = useState<PriorSession[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const r = await load(workspace.id)
    if (r.ok) {
      setSessions(r.sessions)
      setFailed(false)
    } else setFailed(true)
  }, [load, workspace.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const go = async (s: PriorSession) => {
    setPending(s.id)
    setError(null)
    const r = await resume(workspace.id, s.id, s.live)
    setPending(null)
    if (r.ok) return onResumed?.()
    setError(resumeErrorWords(r.error))
    void refresh()
  }

  if (sessions !== null && sessions.length === 0 && !failed) return null
  return (
    <section aria-labelledby="resume-heading" className="flex min-w-0 shrink-0 flex-col gap-2 rounded-ctl border border-border bg-surface p-3">
      <h2 id="resume-heading" className="text-ui font-semibold text-fg">
        Resume an earlier session
      </h2>
      <p className="text-meta text-muted">
        Continue where a session left off, with its conversation. {TWO_WRITERS}
      </p>
      {error !== null ? <Notice tone="fail">{error}</Notice> : null}
      {failed ? (
        <p className="text-meta text-muted">
          Could not read the earlier sessions.{' '}
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            Try again
          </Button>
        </p>
      ) : sessions === null ? (
        <p role="status" className="text-meta text-muted">Looking for earlier sessions…</p>
      ) : (
        <ul className="flex max-h-72 min-w-0 flex-col gap-2 overflow-y-auto">
          {sessions.map((s) => {
            const name = s.title ?? NO_PROMPT
            return (
              <li key={s.id} className="flex min-w-0 flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
                <p title={name} className="min-w-0 truncate text-ui text-fg">{name}</p>
                <p className="min-w-0 text-meta text-muted">
                  <time dateTime={s.lastActive} title={s.lastActive}>{whenWords(s.lastActive)}</time>
                  {' · '}
                  <span className="font-mono">{shortId(s.id)}</span>
                  {s.ankurDir ? ' · has a run record' : ''}
                  {s.transcript ? '' : ' · no conversation on disk'}
                </p>
                {s.live ? <p className="text-meta text-signal-text">Another Claude Code process holds this session now. {TWO_WRITERS}</p> : null}
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    pending={pending === s.id}
                    aria-disabled={!s.transcript || (pending !== null && pending !== s.id) || undefined}
                    aria-label={`${s.live ? 'Resume anyway' : 'Resume'}: ${name}`}
                    onClick={() => {
                      if (s.transcript && pending === null) void go(s)
                    }}
                  >
                    {pending === s.id ? 'Resuming…' : s.live ? 'Resume anyway' : 'Resume'}
                  </Button>
                  <CopyResume repo={workspace.path} sessionId={s.id} describedAs={name} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
