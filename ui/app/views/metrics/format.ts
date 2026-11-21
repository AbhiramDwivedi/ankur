// Formatters for Run metrics. Pure, no React.
import type { CostSnapshot, Member, RunState } from '../../store/types.ts'
import { agentStatus, runStatus } from '../status/status.ts'
import { crewAgents, modelKey } from '../crews/format.ts'
import { goalGroups, goalLastMs, goalStartMs } from '../crews/goals.ts'

const MIN = 60_000
const NUM = new Intl.NumberFormat('en-US')
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 0m, 42m, 3h 05m, 2d 4h. */
export function formatRunTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MIN))
  if (total < 60) return `${total}m`
  const hours = Math.floor(total / 60)
  if (hours < 24) return `${hours}h ${String(total % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** A session is hosted when the server has a sessionId for it. */
export const isHosted = (state: RunState): boolean => state.session.sessionId != null

/** Start of the run from the first decisions[].run heading ("<RFC 3339> | goal"), as ms, or null. */
function headingStartMs(state: RunState): number | null {
  const heading = state.decisions.find((d) => d.run)?.run
  if (!heading) return null
  const t = Date.parse(heading.split(' | ')[0]!)
  return Number.isNaN(t) ? null : t
}

/** Latest parseable ts across every crew's project manager and members, or null. */
function lastActivityMs(state: RunState): number | null {
  let latest: number | null = null
  for (const c of state.run?.crews ?? []) {
    for (const m of c.projectManager ? [c.projectManager, ...c.members] : c.members) {
      const t = Date.parse(m.ts ?? '')
      if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t
    }
  }
  return latest
}

/** With more than one goal, the latest goal's own span: its approval (else its first agent) to now while it works,
 *  else to its last agent activity. Null for a single-goal run or a goal with no usable start. */
function goalSpan(state: RunState, now: number): { start: number; end: number; live: boolean } | null {
  const groups = goalGroups(state.run)
  if (groups.length < 2) return null
  const g = groups[groups.length - 1]!
  const start = goalStartMs(g)
  if (start === null) return null
  const last = goalLastMs(g) ?? start
  const live = runStatus(state) !== 'finished' && g.crews.some((c) => c.status === 'running')
  return { start, end: Math.max(start, live ? now : last), live }
}

/** Run time in ms. With a transcript: first entry to now, or to the last entry once finished. With none: the first
 *  run heading to now (hosted and working) or to the latest crew ts. Null with neither. */
export function runTimeMs(state: RunState, now: number): number | null {
  const span = goalSpan(state, now)
  if (span) return Math.max(0, span.end - span.start)
  const first = Date.parse(state.transcript[0]?.ts ?? '')
  if (!Number.isNaN(first)) {
    let end = now
    if (runStatus(state) === 'finished') {
      const last = Date.parse(state.transcript.at(-1)?.ts ?? '')
      if (!Number.isNaN(last)) end = last
    }
    return Math.max(0, end - first)
  }
  if (state.transcript.length > 0) return null
  const start = headingStartMs(state)
  if (start === null) return null
  const live = isHosted(state) && runStatus(state) !== 'finished'
  const end = live ? now : (lastActivityMs(state) ?? start)
  return Math.max(0, end - start)
}

/** Start and end stamps (ms) of the heading fallback, for the tile sub-line; null when the transcript is used or absent. */
export function headingSpan(state: RunState): { start: number; end: number | null; live: boolean } | null {
  const g = goalSpan(state, Date.now())
  if (g) return { start: g.start, end: g.end, live: g.live }
  if (state.transcript.length > 0) return null
  const start = headingStartMs(state)
  if (start === null) return null
  return { start, end: lastActivityMs(state) ?? start, live: isHosted(state) && runStatus(state) !== 'finished' }
}

/** A run exists: run.json, or any decisions[] entry with a run heading. */
const hasRun = (state: RunState): boolean => state.run !== null || state.decisions.some((d) => !!d.run)

/** usage: a cost figure. not-recorded: a run with no cost and no transcript. none: everything else. */
export function costState(state: RunState): 'usage' | 'not-recorded' | 'none' {
  if (typeof state.session.usage?.costUsd === 'number') return 'usage'
  // A hosted run may still receive usage, so it reads "No usage yet" rather than "Not recorded".
  if (hasRun(state) && state.transcript.length === 0 && !isHosted(state)) return 'not-recorded'
  return 'none'
}

/** Dollars; null (an unpriced model, or a run with no approved plan) is an en dash, never $0.00. */
export const formatUsd = (n: number | null): string => (n === null ? '–' : USD.format(n))

/** A cost cell: the text, and the screen-reader note that says why a dash is there. */
export function costCell(n: number | null): { text: string; sr: string | null } {
  return n === null ? { text: formatUsd(null), sr: 'not priced' } : { text: formatUsd(n), sr: null }
}

export const formatCount = (n: number | null | undefined): string => (n == null ? '—' : NUM.format(n))

/** Elapsed time in words for the header badge and the Usage cell: `53 min`, `3 h 05 min`, `2 d 4 h`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MIN))
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  if (hours < 24) return `${hours} h ${String(total % 60).padStart(2, '0')} min`
  return `${Math.floor(hours / 24)} d ${hours % 24} h`
}

export type { CostSnapshot }

/** The state's cost block. With none (the run dir has no usage.jsonl), the session's own usage stands in: its dollars,
 *  and its tokens per model with no per-model dollars. Null before the first answer or with neither. */
export function costOf(state: RunState | null): CostSnapshot | null {
  const block = state?.cost
  if (block) return block
  const usage = state?.session.usage
  if (!usage) return null
  const models = Object.entries(usage.models).map(([model, m]) => ({
    model,
    tokens: m.inputTokens + m.outputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens,
    usd: null,
  }))
  const tokens = models.reduce((n, m) => n + m.tokens, 0)
  return { run: { since: null, tokens, usd: usage.costUsd }, session: { tokens, usd: usage.costUsd }, crews: [], models, unpriced: [] }
}

/** Tokens in words: `1.92M` from 100,000 up, `12.3k` from 1,000, else the count. Null and 0 (nothing recorded) are a dash. */
export function formatTokens(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—'
  if (n >= 100_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** Dollars for the Usage cell and the Spend table: a dash for null (an unpriced model, or no cost block), never $0.00. */
export const formatDollars = (n: number | null | undefined): string => (n == null ? '—' : USD.format(n))

/** Every agent of the run's crews: each crew's project manager, then its members. */
export const runAgents = (state: RunState): Member[] => (state.run?.crews ?? []).flatMap((c) => crewAgents(c))

export interface SpendRow {
  model: string
  agents: number
  running: number
  tokens: number
  usd: number | null
}

/** One row per model of the cost block, with how many of the run's agents use that model and how many of them work now. */
export function spendRows(state: RunState): SpendRow[] {
  const cost = costOf(state)
  if (cost === null) return []
  // An agent waiting on the client is still running.
  const pairs = (state.run?.crews ?? []).flatMap((c) => crewAgents(c).map((m) => ({ m, active: ['active', 'waiting'].includes(agentStatus(m, c)) })))
  return cost.models.map((row) => {
    const mine = pairs.filter((p) => modelKey(p.m.model) === modelKey(row.model))
    return { model: row.model, agents: mine.length, running: mine.filter((p) => p.active).length, tokens: row.tokens, usd: row.usd }
  })
}

/** hh:mm in the viewer's zone, or null for a stamp that does not parse. */
export function clockOf(iso: string | null | undefined): string | null {
  const t = Date.parse(iso ?? '')
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
