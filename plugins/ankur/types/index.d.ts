// the five-hour limit reset a wake is armed for, and whether that wake has gone out
export type LimitReset = { resetsAt: string; fired: boolean }

// The factory floor's view model, built from an ankur run dir and trimmed to what the band and the pane draw.
// The contract must be self-contained (no import), so the floor's types live here and hooks/floor/types.ts re-exports them.
export type Status = 'planned' | 'running' | 'merged' | 'dropped' | null

export type StuckView = {
  kind: 'stalled' | 'idle-project-manager'
  minutes: number
  detail: string
  agent: string
}

export type MemberView = {
  name: string
  type: string | null
  model: string | null
  effort: string | null
  state: string
  detail: string | null
}

export type CrewView = {
  slug: string
  stage: number | null
  status: Status
  goal: string | null
  estAgents: number | null
  members: MemberView[]
  qc: 'PASS' | 'FAIL' | null
  counts: { work: number; qc: number; runner: number; retry: number }
  latest: string | null
  latestTs: string | null
  stuck: StuckView | null
}

export type NeedView = { id: string; kind: string; title: string; session: string; onYes: string; onNo: string }
export type DecisionView = { run: string; time: string; text: string; why: string }
export type AdrView = { file: string; title: string; status: string }
export type DiagramView = { heading: string; lines: string[] | null; source: string }

export type FloorView = {
  source: 'run' | 'fixture' | 'none'
  dir: string | null
  goal: string | null
  loadedAt: number
  eventLines: number
  crews: CrewView[]
  needs: NeedView[]
  decisions: DecisionView[]
  adrs: AdrView[]
  diagrams: DiagramView[]
  error: string | null
}

export type Tab = 'crews' | 'move' | 'decisions' | 'adrs' | 'design'

// The action preview the floor has open: the exact line to put in the prompt box and where the check of it stands.
// `item` is an inbox item's id, or a stuck crew's slug when `verb` is null (a stuck-crew message). `code` is what the
// item's sidecar held when the preview was last checked (null: this session holds none). `refusal` is set only in the
// `refused` state: the engine's cause, or `hook` when a hook kept the line out. `decision` is set only in `resolved`.
export type FillState = 'ready' | 'checking' | 'stuck' | 'draft' | 'resolved' | 'changed' | 'refused' | 'filled'
export type FillView = {
  state: FillState
  line: string
  item: string
  verb: 'approve' | 'reject' | 'answer' | null
  code: string | null
  refusal: 'dialog' | 'no_composer' | 'hook' | null
  decision: string | null
}

// what ankur keeps in the session's $.state, so it survives a hot reload of the hooks module;
// the floor's keys hold what its band and pane show
declare module 'claude-code' {
  interface PluginState {
    ankur: {
      limitReset: LimitReset
      view: Shaped<FloorView>
      tab: Shaped<Tab>
      expanded: Shaped<string | null>
      showDone: Shaped<boolean>
      diagram: Shaped<number>
      diagramX: Shaped<number>
      selected: Shaped<string | null>
      preview: Shaped<string | null>
      fill: Shaped<FillView | null>
    }
  }
}
