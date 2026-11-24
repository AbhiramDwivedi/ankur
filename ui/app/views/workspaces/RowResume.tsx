// The one-click "Resume session" of the current workspace row: when the workspace has no session going but the
// repository has an earlier one (the newest), this button continues it, the way "Resume" does on the Resume page.
// A session another process holds reads "Resume anyway" and is sent with force, under the same warning.
import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import type { PriorSession, ResumeResult, SessionsResult, WorkspaceItem } from '../../store/types.ts'
import { Button } from '../../components/ui/button.tsx'
import { Notice } from '../../components/ui/notice.tsx'
import { getSessions, resumeWorkspace } from '../../store/api.ts'
import { TWO_WRITERS, resumeErrorWords } from '../resume/format.ts'

/** The session the row offers: the repository's newest, when this workspace has none going and it has a conversation on disk. */
export function resumeOffer(item: Pick<WorkspaceItem, 'status' | 'session'>, sessions: PriorSession[] | null): PriorSession | null {
  if (item.session || item.status === 'stopping' || !sessions || sessions.length === 0) return null
  const newest = sessions[0]
  return newest.transcript ? newest : null
}

export interface RowResumeProps {
  item: WorkspaceItem
  resume?: (id: string, sessionId: string, force: boolean) => Promise<ResumeResult>
  load?: (id: string) => Promise<SessionsResult>
  /** The sessions already known (tests, and a page that has them). */
  initial?: PriorSession[] | null
}

export function RowResume({ item, resume = resumeWorkspace, load = getSessions, initial = null }: RowResumeProps) {
  const [sessions, setSessions] = useState<PriorSession[] | null>(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const hasSession = Boolean(item.session)
  useEffect(() => {
    if (hasSession || initial) return
    let cancelled = false
    void load(item.id).then((r) => {
      if (!cancelled) setSessions(r.ok ? r.sessions : null)
    })
    return () => {
      cancelled = true
    }
  }, [item.id, item.status, hasSession, load, initial])

  const offer = resumeOffer(item, sessions)
  if (!offer) return null

  const go = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    const r = await resume(item.id, offer.id, offer.live)
    if (!alive.current) return
    setPending(false)
    if (!r.ok) setError(resumeErrorWords(r.error))
  }

  const label = pending ? 'Resuming…' : offer.live ? 'Resume anyway' : 'Resume session'
  return (
    <div className="mt-1 min-w-0 px-1">
      <Button size="sm" variant="secondary" pending={pending} icon={<Play aria-hidden="true" className="fill-current" />} onClick={() => void go()}>
        {label}
      </Button>
      {offer.live ? <p className="mt-1 text-meta text-signal-text">Another Claude Code process holds this session now. {TWO_WRITERS}</p> : null}
      {error !== null ? (
        <Notice tone="fail" className="mt-2">
          {error}
        </Notice>
      ) : null}
    </div>
  )
}
