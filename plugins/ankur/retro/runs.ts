// The run-counting retro trigger (R-194): run end does the scripted counts only, and the full retro (judges, triage, fix
// goal) starts once FULL_RETRO_EVERY runs have finished since the last full retro, or when a counted run holds a RECURRED
// line. `due` reads the run dirs under <git common dir>/truss/*/ and <git common dir>/ankur/*/ and prints no text of its // ankur-allow-truss
// own: retro/cli.ts `due` wraps `dueOf`. Erasable TypeScript, Node standard library only (P19).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** How many finished runs since the last full retro make the full retro due, when `.claude/ankur.json` sets no `fullRetroEvery`. */
export const FULL_RETRO_EVERY = 5

export type Due = { due: boolean | null; why: string; every?: number; runs?: string[] }
export type Run = { dir: string; start: number }

const flat = (p: string): string => p.replace(/\\/g, '/')

const json = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** The `judges.at` of a run's retro/state.json when its judges are done (a full retro ran in that run), else null. */
const judgedAt = (dir: string): number | null => {
  const s = json(join(dir, 'retro', 'state.json')) as { steps?: { judges?: { status?: unknown; at?: unknown } } } | null
  const j = s?.steps?.judges
  if (j?.status !== 'done' || typeof j.at !== 'string') return null
  const at = Date.parse(j.at)
  return Number.isFinite(at) ? at : null
}

/** A run is finished when its plan has crews and every one is merged or dropped. A run with a planned or running crew is in progress. */
const finished = (dir: string): boolean => {
  const p = json(join(dir, 'plan.json')) as { crews?: unknown } | null
  if (!Array.isArray(p?.crews) || p.crews.length === 0) return false
  return p.crews.every((c: { status?: unknown } | null) => c?.status === 'merged' || c?.status === 'dropped')
}

/** The latest `## Run <ISO>` heading of a run's decisions.md, as epoch ms, or null when it has none. */
const startOf = (dir: string): number | null => {
  let text: string
  try {
    text = readFileSync(join(dir, 'decisions.md'), 'utf8')
  } catch {
    return null
  }
  const starts = [...text.matchAll(/^## Run (\S+)/gm)].map((m) => Date.parse(m[1] ?? '')).filter((n) => Number.isFinite(n))
  return starts.length === 0 ? null : Math.max(...starts)
}

/** Every run dir under the two run roots of a git common dir. */
const runDirs = (common: string): string[] => {
  const out: string[] = []
  for (const root of ['truss', 'ankur']) { // ankur-allow-truss
    const base = join(common, root)
    if (!existsSync(base)) continue
    let names: string[] = []
    try {
      names = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    } catch { /* an unreadable root has no runs */ }
    for (const n of names) out.push(flat(join(base, n)))
  }
  return out
}

/** The finished runs that started after the last full retro (every finished run when there is none), oldest start first. */
export function countedRuns(common: string): string[] {
  const dirs = runDirs(common)
  let last = -Infinity
  for (const d of dirs) {
    const at = judgedAt(d)
    if (at !== null && at > last) last = at
  }
  const runs: Run[] = []
  for (const dir of dirs) {
    if (!finished(dir)) continue
    const start = startOf(dir)
    if (start !== null && start > last) runs.push({ dir, start })
  }
  runs.sort((a, b) => a.start - b.start || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
  return runs.map((r) => r.dir)
}

/** Whether the full retro is due. `recurred` says whether a counted run holds a RECURRED line. */
export function dueOf(common: string, mode: string | undefined, every: number, recurred: (dir: string) => boolean): Due {
  if (mode === 'pm') return { due: null, why: 'pm decides' }
  if (mode === 'off') return { due: false, why: 'off' }
  const runs = countedRuns(common)
  if (runs.length >= every) return { due: true, why: 'count', every, runs }
  if (runs.some(recurred)) return { due: true, why: 'recurred', every, runs }
  return { due: false, why: 'not due', every, runs }
}
