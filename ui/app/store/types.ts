// Types for every $defs entry of ui/contract/state.schema.json.

export type Instance = string

export interface AnkurDir {
  path: string | null
  exists: boolean
}

export interface Plugin {
  name: 'ankur'
  version: string | null
  path: string
  source: string | null
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

export interface Usage {
  costUsd: number | null
  models: Record<string, ModelUsage>
  results: number
  at: string
  /** A running estimate of the session's tokens. */
  live?: LiveUsage
}

export interface LiveUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  subagentTokens: number
  totalTokens: number
  at: string
}

/** What the user meant a message as. */
export type Intent = 'goal' | 'add' | null

/** An accepted message the SDK has not yet taken. */
export interface QueuedMessage {
  id: string
  text: string
  intent: Intent
  at: string
}

export interface BackgroundTask {
  taskId: string
  description: string
  subagentType: string | null
}

export type SessionStatus = 'idle' | 'running' | 'waiting' | 'ended' | 'error'

export interface Session {
  status: SessionStatus
  sessionId: string | null
  model: string | null
  claudeCodeVersion: string | null
  permissionMode: string | null
  plugin: Plugin | null
  usage: Usage | null
  backgroundTasks: BackgroundTask[]
  error: string | null
  /** Accepted messages the SDK has not yet taken, oldest first. */
  queue?: QueuedMessage[]
  /** The PM's hand-offs, oldest first, at most the last 200. */
  flow?: FlowEntry[]
}

/** One hand-off the PM made. */
export interface FlowEntry {
  /** ISO time the tool call was seen. */
  at: string
  tool: 'Agent' | 'SendMessage' | 'Workflow'
  /** A crew slug, or null. */
  to: string | null
  /** At most 200 characters. */
  summary: string
}

export type TranscriptRole = 'user' | 'assistant' | 'error'

export interface TranscriptEntry {
  n: number
  role: TranscriptRole
  text: string
  ts: string
  /** A user entry carries the id of the message that made it; others have null. */
  id?: string | null
  /** What the user meant the message as. */
  intent?: Intent
}

export type RequestStatus = 'open' | 'answered' | 'cancelled'
export type CancelReason = 'aborted' | 'superseded' | 'ended' | null

export interface RequestBase {
  id: string
  status: RequestStatus
  createdAt: string
  answeredAt: string | null
  cancelReason: CancelReason
}

export interface QuestionOption {
  label: string
  description: string
  recommended: boolean
}

export interface Question {
  question: string
  header: string
  multiSelect: boolean
  options: QuestionOption[]
}

export interface QuestionRequest extends RequestBase {
  kind: 'question'
  questions: Question[]
  answers: Record<string, string> | null
}

export interface PermissionRequest extends RequestBase {
  kind: 'permission'
  toolName: string
  title: string
  summary: string
  input: Record<string, unknown>
  decisionReason: string | null
  blockedPath: string | null
  decision: 'allow' | 'deny' | null
  message: string | null
}

export interface ReplyRequest extends RequestBase {
  kind: 'reply'
  text: string
  isError: boolean
  backgroundTasks: number
  decision: 'allow' | 'deny' | 'message' | null
  message: string | null
  /** True when the turn asks for approval; absent or false means it does not. */
  approvalAsk?: boolean
}

export type Request = QuestionRequest | PermissionRequest | ReplyRequest
export type Requests = Request[]

export type MemberState = 'spawned' | 'stalled' | 'tagged' | 'reported' | 'allowance-spent' | 'fetched'

export interface Member {
  name: string
  type: string | null
  model: string | null
  effort: string | null
  state: MemberState
  detail: string | null
  ts: string
  /** The spawn line's agentId. */
  agentId?: string | null
  /** The first sentence of the agent file's description. */
  purpose?: string | null
  /** The latest task description for this agent. */
  task?: string | null
  /** The agent's latest tool call, `<Tool>: <short>`. */
  activity?: string | null
}

export type ActivityEvent =
  | 'spawn'
  | 'stall'
  | 'tag'
  | 'report'
  | 'allowance-spent'
  | 'fetch'
  | 'incomplete'
  | 'message'

export interface Activity {
  ts: string
  agent: string
  event: ActivityEvent
  text: string
}

export interface CrewQc {
  verdict: 'PASS' | 'FAIL' | null
  file: string
}

export type CrewStatus = 'planned' | 'running' | 'merged' | 'dropped' | null

export interface Crew {
  slug: string
  stage: number | null
  verdict: string | null
  status: CrewStatus
  goal: string | null
  owns: string[]
  projectManager: Member | null
  members: Member[]
  latest: Activity | null
  qc: CrewQc | null
  /** Plan.json's crew estAgents, or null for a crew not in plan.json. */
  estAgents?: number | null
  /** Null, or the crew's latest stall while it lasts. */
  stuck?: CrewStuck | null
  /** The count of this crew's event lines skipped for version. */
  eventsUnread?: number
}

export interface CrewStuck {
  kind: 'stalled' | 'idle-project-manager'
  since: string
  minutes: number
  detail: string
}

/** One goal of the run; the first is id run. */
export interface RunGoal {
  id: string
  goal: string | null
  approval: 'auto' | 'client' | null
  approvedAt: string | null
}

export interface Skipped {
  file: string
  line: number
  reason: 'json' | 'version'
}

export interface RunInfo {
  goal: string | null
  version: number | null
  approval: 'auto' | 'client' | null
  approvedAt: string | null
  crews: Crew[]
  /** The run's first goal as id run, then plan.json's goals in order. */
  goals?: RunGoal[]
  /** The newest recorded message of each (from, to) pair of messages.jsonl, oldest first. */
  messages?: RunMessage[]
  skipped: Skipped[]
}

export interface RunMessage {
  ts: string
  from: string
  to: string
  summary: string
}

export type Run = RunInfo | null

export interface Decision {
  n: number
  run: string | null
  text: string
}
export type Decisions = Decision[]

export interface Adr {
  file: string
  title: string
  status: string | null
  // Optional: older snapshots and fixtures lack them; the server always sends all five.
  number?: number | null
  date?: string | null
  decidedBy?: string | null
  links?: AdrLink[]
  summary?: string | null
}
export interface AdrLink {
  kind: 'amends' | 'supersedes' | 'superseded-by'
  n: number
}
export type Adrs = Adr[]

export interface DesignArchitecture {
  path: string
  markdown: string
}

export interface DesignImage {
  ref: string
  path: string
}

export interface Design {
  planMd: string | null
  architecture: DesignArchitecture | null
  images: DesignImage[]
}

export interface Notice {
  id: string
  text: string
}
export type Notices = Notice[]

export type RetroStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface RetroStep {
  status: RetroStepStatus
  at: string | null
  detail: string | null
}

export interface RetroInfo {
  v: 1
  updatedAt: string
  steps: {
    extract: RetroStep
    judges: RetroStep
    triage: RetroStep
    fixGoal: RetroStep
    applied: RetroStep
  }
}

export type Retro = RetroInfo | null

/** The server's cost block of a state (state.schema.json `cost`). */
export interface CostSnapshot {
  run: { since: string | null; tokens: number; usd: number | null }
  session: { tokens: number; usd: number | null }
  crews: { crew: string; tokens: number; usd: number | null; why?: string }[]
  models: { model: string; tokens: number; usd: number | null }[]
  unpriced: string[]
}

export interface RunState {
  v: 1
  repo: string
  ankurDir: AnkurDir
  session: Session
  requests: Requests
  transcript: TranscriptEntry[]
  run: Run
  decisions: Decisions
  adrs: Adrs
  design: Design
  notices: Notices
  retro?: Retro
  /** Priced usage from the run dir's usage.jsonl; null when it has none. Absent from a server that predates workspaces. */
  cost?: CostSnapshot | null
}

export interface Snapshot {
  type: 'snapshot'
  instance: Instance
  seq: number
  state: RunState
}

export interface DeltaSet {
  ankurDir?: AnkurDir
  session?: Session
  requests?: Requests
  run?: Run
  decisions?: Decisions
  adrs?: Adrs
  design?: Design
  notices?: Notices
  retro?: Retro
}

export interface Delta {
  type: 'delta'
  seq: number
  set?: DeltaSet
  append?: { transcript: TranscriptEntry[] }
}

export type WireMessage = Snapshot | Delta

/** null on success; http, network, timeout, or the server's own error string. */
export type PostError = null | 'http' | 'network' | 'timeout' | (string & {})

export interface PostResult {
  status: number
  error: PostError
  /** The 202 body's message id, present only when the server gave one. */
  id?: string
}

/** The link to /api/events: connecting until the first message, reconnecting after an error. */
export type Connection = 'connecting' | 'live' | 'reconnecting'

/** The wire values of a workspace status; the page owns the words. */
export type WorkspaceStatus = 'stopping' | 'failed' | 'stopped' | 'finished' | 'waiting' | 'idle' | 'not-started' | 'working'

/** One row of GET /api/workspaces. */
export interface WorkspaceItem {
  id: string
  name: string
  path: string
  status: WorkspaceStatus
  reason: string | null
  openRequests: number
  session?: boolean // absent in the open answer when no session process exists
}

export type OpenError = 'path' | 'relative' | 'missing' | 'notgit' | 'timeout' | 'network'

/** The answer to opening a directory: the workspace, and whether it was already open; or the refusal. */
export type OpenResult =
  | { ok: true; workspace: WorkspaceItem; existed: boolean }
  | { ok: false; error: OpenError | (string & {}); status: number }

/** The answer to a workspace list request. expired is true on 401 or 403 (the page link is gone): no retry. */
export type ListResult =
  | { ok: true; workspaces: WorkspaceItem[] }
  | { ok: false; status: number; expired: boolean }

export type StopResult = { ok: true; workspace: WorkspaceItem } | { ok: false; status: number; error: string }
