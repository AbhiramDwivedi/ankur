// The page header: the workspace's name (h1), one line of its goal, the run badge (status and elapsed time), the
// notifications and theme buttons, the PM session line and the server notices. It holds what RunContext held.
// It never shows the model, the cost or a limit: the Usage cell of the summary strip owns the figures.
import { useEffect, useRef, useState } from 'react'
import { Bell, BellRing, Moon, Sun } from 'lucide-react'
import type { Connection, Request, RunState } from '../../store/types.ts'
import { useTheme } from '../../lib/theme.ts'
import { cn } from '../../lib/utils.ts'
import { Button } from '../../components/ui/button.tsx'
import { StatusGlyph, type Glyph } from '../../components/ui/dot.tsx'
import { sessionWords, usePageFlags } from '../move/format.ts'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import { Badge } from '../../components/ui/badge.tsx'
import { RunStatusBadge } from '../status/RunStatusBadge.tsx'
import { workspaceStatusLabel, type RunStatus } from '../status/status.ts'
import { formatElapsed, runTimeMs } from '../metrics/format.ts'
import { firstGoal } from '../rail/format.ts'
import { runStatusOf } from './runStatus.ts'
import { RunStatus as RunNotices } from './RunStatus.tsx'
import { useLinkTimers } from './useLinkTimers.ts'
import { UnreachableNotice } from './UnreachableNotice.tsx'

export interface BannerProps {
  state: RunState | null
  now: number
  connection: Connection
  /** The workspace the page shows: its name is the title. */
  workspace?: { name: string; path: string } | null
  /** Set while the workspace is stopping or stopped: the badge then says that word in place of the run word. */
  lifecycle?: 'stopping' | 'stopped' | null
  /** The workspace's snapshot has not arrived: the badge is a skeleton, not a guessed word. */
  loading?: boolean
  /** The workspace has no session: the badge says so, in the rail's word, not the recorded run's status. */
  noSession?: boolean
}

export const NO_GOAL = 'No goal yet. Type one below and ankur starts a Claude Code session in this repository.'

const btnTarget = 'min-h-6 pointer-coarse:min-h-11 pointer-coarse:min-w-11'

const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window

const notifyTitle = (r: Request) =>
  r.kind === 'question' ? 'Ankur: Question from Claude' : r.kind === 'permission' ? `Ankur: Approval needed: ${r.toolName}` : null

/** The run badge: glyph, tone and words per run status. Words carry the meaning; the glyph and tone repeat it. */
const BADGE: Record<RunStatus, { glyph: Glyph; tone: string }> = {
  working: { glyph: 'run', tone: 'bg-run-soft text-run-text' },
  waiting: { glyph: 'ask', tone: 'bg-signal-soft text-signal-text' },
  finished: { glyph: 'idle', tone: 'bg-sunken text-muted' },
  'not-started': { glyph: 'idle', tone: 'bg-sunken text-muted' },
}

function badgeWords(status: RunStatus, ms: number | null): string {
  const elapsed = ms === null ? '' : `, ${formatElapsed(ms)}`
  if (status === 'working') return `Running${elapsed}`
  if (status === 'waiting') return `Waiting on you${elapsed}`
  return status === 'finished' ? 'Idle, goal finished' : 'Idle'
}

export function Banner({ state, now, connection, workspace, lifecycle, loading = false, noSession = false }: BannerProps) {
  const { dark, toggle } = useTheme()
  const flags = usePageFlags()
  const [notifyOn, setNotifyOn] = useState(false)
  const seen = useRef<Set<string> | null>(null)
  const live = connection === 'live'
  // 5 s of not being live changes the Session line; at 20 s the Reload notice takes the header's notice room.
  const { slow, unreachable } = useLinkTimers(connection)

  useEffect(() => {
    if (notifySupported() && Notification.permission === 'granted') setNotifyOn(true)
  }, [])

  // One notification per newly opened question or permission request; the ones open when notifications
  // came on count as seen.
  const requests = state?.requests
  useEffect(() => {
    if (!notifyOn || !requests) return
    const open = requests.filter((r) => r.status === 'open')
    if (seen.current === null) {
      seen.current = new Set(open.map((r) => r.id))
      return
    }
    for (const r of open) {
      if (seen.current.has(r.id)) continue
      seen.current.add(r.id)
      const title = notifyTitle(r)
      if (title === null || !notifySupported()) continue
      try {
        new Notification(title)
      } catch {
        // a browser that refuses page notifications; the title count still shows it
      }
    }
  }, [notifyOn, requests])

  const turnOnNotifications = async () => {
    if (!notifySupported()) return
    let p: NotificationPermission = Notification.permission
    if (p !== 'granted') {
      try {
        p = await Notification.requestPermission()
      } catch {
        return
      }
    }
    if (p === 'granted') {
      seen.current = new Set((requests ?? []).filter((r) => r.status === 'open').map((r) => r.id))
      setNotifyOn(true)
    }
  }

  const session = state?.session ?? null
  const status = runStatusOf(state, connection)
  // The elapsed time only means something while a run exists; an idle badge has none.
  const runMs = state && status !== 'not-started' ? runTimeMs(state, now) : null
  const goal = firstGoal(state)
  const goalText = goal === null ? null : (goal.goal ?? 'A run with no goal text.')
  const words = slow && !live ? 'Still connecting to the session…' : sessionWords(state, false, flags.expired)
  const working = session !== null && (session.status === 'running' || session.backgroundTasks.length > 0)
  // Same reading as views/status/status.ts: a waiting session with background tasks and no open request.
  const stillRunning =
    session?.status === 'waiting' && session.backgroundTasks.length > 0 && !(state?.requests ?? []).some((q) => q.status === 'open')
  const bad = flags.expired || unreachable || session?.status === 'error'
  const dot: Glyph = bad ? 'fail' : working ? 'run' : session?.status === 'waiting' ? 'ask' : 'idle'
  const badge = BADGE[status]

  return (
    <header className="flex min-w-0 shrink-0 flex-col gap-1 border-b border-border bg-surface px-4 py-2 lg:px-6">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-60 flex-col">
          <h1 title={workspace?.name} className="min-w-0 truncate text-title font-semibold text-fg">
            {workspace?.name ?? 'Ankur'}
          </h1>
          {goalText !== null ? (
            <p title={goalText} className="min-w-0 truncate text-ui text-muted">
              {goalText}
            </p>
          ) : (
            <p className="min-w-0 truncate text-ui text-muted">{NO_GOAL}</p>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <p
            role="status"
            aria-label="Run status"
            className={cn('inline-flex min-h-6 items-center gap-1', !loading && !lifecycle && !noSession && 'rounded-chip px-2 text-meta font-medium whitespace-nowrap', !loading && !lifecycle && !noSession && badge.tone)}
          >
            {loading ? (
              <Skeleton className="h-6 w-24" />
            ) : lifecycle ? (
              // A stopped or stopping workspace says the rail's word, not the last run word: one name per state.
              <Badge tone={lifecycle === 'stopping' ? 'fail' : 'neutral'}>{workspaceStatusLabel(lifecycle)}</Badge>
            ) : noSession ? (
              <RunStatusBadge status="not-started" word={workspaceStatusLabel('not-started')} />
            ) : (
              <>
                <StatusGlyph glyph={badge.glyph} small />
                <span>{badgeWords(status, runMs)}</span>
              </>
            )}
          </p>{' '}
          <Button
            size="sm"
            variant="ghost"
            className={btnTarget}
            icon={notifyOn ? <BellRing aria-hidden="true" /> : <Bell aria-hidden="true" />}
            aria-disabled={notifyOn || undefined}
            onClick={turnOnNotifications}
          >
            <span className="max-xl:sr-only">{notifyOn ? 'Notifications on' : 'Turn on notifications'}</span>
          </Button>
          <Button size="icon" variant="ghost" className={btnTarget} aria-label="Dark theme" aria-pressed={dark} onClick={toggle}>
            {dark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <StatusGlyph glyph={dot} />
        <span className="shrink-0 text-meta text-muted">PM session:</span>
        <p role="status" aria-label="Session" title={words} className={cn('min-w-0 truncate text-meta', bad ? 'text-fail-text' : 'text-fg')}>
          {words}
        </p>
        {stillRunning && <p className="min-w-0 truncate text-meta text-muted">Agents still running; nothing needed from you</p>}
        <RunNotices state={state} now={now} connection={connection} replacesReconnecting={unreachable && !!state} />
      </div>

      {unreachable ? <UnreachableNotice /> : null}
    </header>
  )
}
