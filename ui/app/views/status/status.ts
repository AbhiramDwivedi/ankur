// The shared status vocabulary. Pure rules, no React: every view that shows
// a status word reads it from here, so one state never carries two names.
import type { Crew, Member, RunState, WorkspaceStatus } from '../../store/types.ts'

export type Status = 'active' | 'done' | 'waiting' | 'stuck' | 'planned'
export type RunStatus = 'not-started' | 'working' | 'waiting' | 'finished'

export const STATUS_WORD: Record<Status, string> = {
  active: 'Active',
  done: 'Done',
  waiting: 'Waiting on you',
  stuck: 'Stuck',
  planned: 'Planned',
}

export const RUN_STATUS_WORD: Record<RunStatus, string> = {
  'not-started': 'Not started',
  working: 'Working',
  waiting: 'Waiting on you',
  finished: 'Finished',
}

/** The words of a workspace row in the rail. Working, waiting and finished are the banner's words. */
export const WORKSPACE_STATUS_WORD: Record<WorkspaceStatus, string> = {
  'not-started': 'No session yet',
  idle: 'No session yet',
  working: RUN_STATUS_WORD.working,
  waiting: RUN_STATUS_WORD.waiting,
  finished: RUN_STATUS_WORD.finished,
  stopping: 'Stopping…',
  stopped: 'Stopped, no session',
  failed: 'Failed',
}

export const FAILED_REASON_WORDS = 6

export interface WorkspaceLabelOpts {
  /** The current stage of the run and how many there are; only Working shows it. */
  stage?: { i: number; n: number } | null
  /** Why the session ended on its own; only Failed shows it, cut to six words. */
  reason?: string | null
  /** The item's session flag: false makes waiting, idle and not-started all say "No session yet". */
  session?: boolean
  /** The link is lost: the word is the last one seen. */
  stale?: boolean
}

/** True when the workspace has no session and its status is waiting, idle or not-started: the rail and the banner then say "No session yet". */
export function noSessionWord(status: WorkspaceStatus, session: boolean | undefined): boolean {
  return session === false && (status === 'waiting' || status === 'idle' || status === 'not-started')
}

/** The status text of a workspace row: its word, with the stage on Working, the reason on Failed, " (last seen)" when stale. */
export function workspaceStatusLabel(status: WorkspaceStatus, opts: WorkspaceLabelOpts = {}): string {
  let text = noSessionWord(status, opts.session) ? WORKSPACE_STATUS_WORD['not-started'] : WORKSPACE_STATUS_WORD[status]
  if (status === 'working' && opts.stage) text += `, stage ${opts.stage.i} of ${opts.stage.n}`
  if (status === 'failed') {
    const words = (opts.reason ?? '').trim().split(/\s+/).filter(Boolean)
    if (words.length > 0) text += `: ${words.slice(0, FAILED_REASON_WORDS).join(' ')}${words.length > FAILED_REASON_WORDS ? '…' : ''}`
  }
  return opts.stale ? `${text} (last seen)` : text
}

const ASKS = /^\s*(QUESTION|BLOCKED|PROPOSAL)\b/

/** True when a detail line opens with a marker that needs the client's answer. */
const asks = (detail: string | null | undefined): boolean => detail != null && ASKS.test(detail)

/** Merged and dropped first, then stuck, then a project manager ask, then running; planned last. */
export function crewStatus(crew: Crew): Status {
  if (crew.status === 'merged' || crew.status === 'dropped') return 'done'
  if (crew.stuck) return 'stuck'
  if (crew.status === 'running') return asks(crew.projectManager?.detail) ? 'waiting' : 'active'
  if (crew.status === 'planned') return 'planned'
  if (crew.status === null && crew.members.length === 0) return 'planned'
  return 'active'
}

/** An agent never contradicts its crew: a merged or dropped crew makes every agent Done, then the member's own state. */
export function agentStatus(member: Member, crew: Pick<Crew, 'status'>): Status {
  if (crew.status === 'merged' || crew.status === 'dropped') return 'done'
  if (member.state === 'reported') return 'done'
  if (member.state === 'stalled' || member.state === 'allowance-spent') return 'stuck'
  if (asks(member.detail)) return 'waiting'
  return 'active'
}

/** An open request always waits on the client; a waiting session with background tasks still running is Working. */
const isWaiting = (s: RunState): boolean =>
  s.requests.some((q) => q.status === 'open') || (s.session.status === 'waiting' && s.session.backgroundTasks.length === 0)
const allCrewsDone = (s: RunState): boolean => {
  const crews = s.run?.crews ?? []
  return crews.length > 0 && crews.every((c) => c.status === 'merged' || c.status === 'dropped')
}
const noPlan = (s: RunState): boolean => s.run === null && s.transcript.length === 0

/** The PM node: Planned before any run, Waiting on an ask, Done once every crew is, else Active. */
export function pmStatus(s: RunState): Status {
  if (noPlan(s)) return 'planned'
  if (isWaiting(s)) return 'waiting'
  if (allCrewsDone(s) && s.session.status !== 'running') return 'done'
  return 'active'
}

export function runStatus(s: RunState): RunStatus {
  if (noPlan(s)) return 'not-started'
  if (isWaiting(s)) return 'waiting'
  if (allCrewsDone(s) && s.session.status !== 'running') return 'finished'
  return 'working'
}
