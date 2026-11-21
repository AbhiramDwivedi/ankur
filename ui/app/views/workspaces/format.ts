// Pure helpers of the workspace rail: the path as shown, the count chip, the stage of a run. Type imports only,
// so `node --test` runs them without a build.
import type { RunState } from '../../store/types.ts'

/** The longest path the rail shows whole: a 248 px rail holds about this many mono 11 px characters. */
export const PATH_MAX = 28

/** A home directory shown as "~": /home/<user>, /Users/<user> and <drive>:\Users\<user>. Any other path is unchanged. */
export function homeRelative(path: string): string {
  const unix = /^\/(?:home|Users)\/[^/]+(?=\/|$)/.exec(path)
  if (unix) return '~' + path.slice(unix[0].length)
  const win = /^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/.exec(path)
  if (win) return '~' + path.slice(win[0].length)
  return path
}

/**
 * Middle truncation: the root and the first segment, "…", and the last two segments. A path within `max`, or one with
 * nothing to cut between those pieces, is returned whole.
 */
export function formatPath(path: string, max: number = PATH_MAX): string {
  if (path.length <= max) return path
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const parts = path.split(sep)
  if (parts.length <= 4) return path
  return `${parts.slice(0, 2).join(sep)}${sep}…${sep}${parts.slice(-2).join(sep)}`
}

/**
 * The path as the rail draws it: formatPath, and when that is still longer than `max`, the root, the first segment cut
 * to fit (with "…" at the cut) and the last segment whole, so the folder that tells two repos apart is never clipped.
 */
export function fitPath(path: string, max: number = PATH_MAX): string {
  const out = formatPath(path, max)
  if (out.length <= max) return out
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const parts = path.split(sep)
  if (parts.length < 3) return out
  const last = parts[parts.length - 1]!
  const root = parts[0]!
  const first = parts[1]!
  const whole = `${root}${sep}${first}${sep}…${sep}${last}`
  if (whole.length <= max) return whole
  const room = max - (root.length + sep.length + 1 + sep.length + last.length)
  const cut = room > 0 ? first.slice(0, room) : ''
  return `${root}${sep}${cut}…${sep}${last}`
}

export interface CountChip {
  text: string
  /** The screen-reader text that follows the number. */
  sr: string
}

/** The open-request chip of a row: hidden at 0, "99+" above 99. */
export function countChip(n: number): CountChip | null {
  if (n <= 0) return null
  return { text: n > 99 ? '99+' : String(n), sr: n === 1 ? ' needs you' : ' need you' }
}

/** One open item of the run's shared inbox (state.schema.json `inbox`). */
export interface InboxItem {
  id: string
  title: string
  kind: string
}

export interface InboxState {
  open: number
  items: InboxItem[]
}

/** The inbox of a snapshot: the server sends it as an optional key, and types.ts does not name it yet. */
export function inboxOf(state: RunState | null): InboxState | null {
  const inbox = (state as (RunState & { inbox?: InboxState | null }) | null)?.inbox
  return inbox ?? null
}

/** "long-term-cost" as "Long-term cost". */
export function kindWord(kind: string): string {
  const words = kind.replace(/[-_]+/g, ' ').trim()
  return words === '' ? kind : words[0]!.toUpperCase() + words.slice(1)
}

/** The stage a run is in and how many it has, counting from 1: the first stage that still has a crew at work, else the last. */
export function stageOf(state: RunState | null): { i: number; n: number } | null {
  const crews = (state?.run?.crews ?? []).filter((c): c is typeof c & { stage: number } => typeof c.stage === 'number')
  if (crews.length === 0) return null
  const stages = [...new Set(crews.map((c) => c.stage))].sort((a, b) => a - b)
  const open = crews.filter((c) => c.status !== 'merged' && c.status !== 'dropped').map((c) => c.stage)
  const at = open.length > 0 ? stages.indexOf(Math.min(...open)) : stages.length - 1
  return { i: at + 1, n: stages.length }
}
