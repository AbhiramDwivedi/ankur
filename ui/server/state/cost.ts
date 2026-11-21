// ui-state cost side: per run, per crew and per model, in tokens and dollars, read from
// <run dir>/usage.jsonl and the `pricing` key of the project config. Read-only: no sweep, no lock, no write, no price fetched.
// The rules are copies of plugins/ankur/bin/cost.ts (sumOf, ratesFor, attributor, startedDirectly) and core.ts (parseLabel);
// ui/ never imports plugin code (Decision 1). Node built-ins only; erasable TypeScript.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfigPath } from './names.ts'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface Cost {
  run: { since: string | null; tokens: number; usd: number | null }
  session: { tokens: number; usd: number | null }
  crews: { crew: string; tokens: number; usd: number | null; why?: string }[]
  models: { model: string; tokens: number; usd: number | null }[]
  unpriced: string[]
}

const MAIN = 'main'
const UNATTRIBUTED = 'unattributed'
const CREW_NAME_PREFIXES = ['ankur-', 'truss-'] // ankur-allow-truss
const RECHECK_MS = 5000 // late agent meta files change attribution without touching usage.jsonl

const count = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

const RATES = ['inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'cacheWrite5mPerMTok', 'cacheWrite1hPerMTok'] as const
type Rates = Record<(typeof RATES)[number], number>
const ratesOk = (v: unknown): v is Rates => isObj(v) && RATES.every((k) => typeof v[k] === 'number' && Number.isFinite(v[k]) && (v[k] as number) >= 0)

// The longest pricing key that is a prefix of the model id; fast rows take `fast`; a row over longContext.abovePromptTokens takes those rates.
function ratesFor(pricing: unknown, model: string, fast: boolean, prompt: number): Rates | null {
  if (!isObj(pricing)) return null
  let best: string | undefined
  for (const k of Object.keys(pricing)) if (model.startsWith(k) && (best === undefined || k.length > best.length)) best = k
  if (best === undefined) return null
  const p = pricing[best]
  const long = !fast && isObj(p) && isObj(p.longContext) ? p.longContext : undefined
  if (long !== undefined) {
    const above = long.abovePromptTokens
    if (typeof above !== 'number' || !Number.isFinite(above) || above < 0) return null
    if (prompt > above) return ratesOk(long) ? long : null
  }
  const r = fast && isObj(p) ? p.fast : p
  return ratesOk(r) ? r : null
}

// usd is null (never 0) when any row's model has no price, and for no rows at all.
function sumOf(rows: Obj[], pricing: unknown): { usd: number | null; tokens: number; unpriced: string[] } {
  let usd = 0
  let tokens = 0
  const unpriced = new Set<string>()
  for (const r of rows) {
    tokens += count(r.in) + count(r.out) + count(r.think) + count(r.cr) + count(r.cw5m) + count(r.cw1h) + count(r.web)
    const fast = r.speed === 'fast'
    const p = ratesFor(pricing, String(r.model), fast, count(r.in) + count(r.cr) + count(r.cw5m) + count(r.cw1h))
    if (p === null) {
      unpriced.add(fast ? `${r.model} (fast)` : String(r.model))
      continue
    }
    usd += (count(r.in) * p.inputPerMTok + count(r.out) * p.outputPerMTok + count(r.cr) * p.cacheReadPerMTok + count(r.cw5m) * p.cacheWrite5mPerMTok + count(r.cw1h) * p.cacheWrite1hPerMTok) / 1e6
  }
  return { usd: unpriced.size > 0 || rows.length === 0 ? null : usd, tokens, unpriced: [...unpriced].sort() }
}

// A Workflow label as {slug}: strip a trailing -<n> (n >= 2), the last segment is the role, the rest the slug.
function labelSlug(label: unknown): string | undefined {
  if (typeof label !== 'string') return undefined
  let rest = label
  const m = /-(\d+)$/.exec(rest)
  if (m) {
    if (Number(m[1]) < 2) return undefined
    rest = rest.slice(0, m.index)
  }
  const cut = rest.lastIndexOf('-')
  return cut <= 0 || cut === rest.length - 1 ? undefined : rest.slice(0, cut)
}

const NAME_RE = /^[A-Za-z0-9._-]{1,80}$/
function nameOfMeta(meta: unknown): string | undefined {
  if (!isObj(meta)) return undefined
  for (const v of [meta.name, meta.description]) if (typeof v === 'string' && NAME_RE.test(v)) return v
  return undefined
}
const HOTFIX_NAME = /^(?:hotfix|fix)(?:-|$)/
const startedDirectly = (name: unknown, slugs: string[]): boolean => typeof name === 'string' && name !== '' && !HOTFIX_NAME.test(name) && !slugs.some((s) => name.startsWith(`${s}-`))

const flat = (p: string): string => p.replace(/\\/g, '/')

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch {
    return null
  }
}
function rowsOf(file: string): Obj[] {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out: Obj[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const o: unknown = JSON.parse(line)
      if (isObj(o)) out.push(o)
    } catch {
      // a torn or bad line is skipped, as the plugin does
    }
  }
  return out
}
function sigOf(file: string): string {
  try {
    const s = fs.statSync(file)
    return `${s.size}:${s.mtimeMs}`
  } catch {
    return '-'
  }
}

// The sessions of the run: the run dir's own name, then each recorded <dir>/sessions/<sid>.json.
function sessionsOf(dir: string): string[] {
  const out = [path.basename(dir)]
  try {
    for (const n of fs.readdirSync(path.join(dir, 'sessions')).sort()) {
      const s = n.endsWith('.json') ? n.slice(0, -5) : ''
      if (/^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && s !== '..' && !out.includes(s)) out.push(s)
    }
  } catch {
    // no sessions dir
  }
  return out
}

// agentId -> {path, meta} for every agent transcript of the run's sessions under <claudeDir>/projects/*/<sid>/subagents.
function agentsOf(claudeDir: string | undefined, dir: string): Map<string, { path: string; meta: unknown }> {
  const out = new Map<string, { path: string; meta: unknown }>()
  if (claudeDir === undefined) return out
  const root = path.join(claudeDir, 'projects')
  let projects: string[]
  try {
    projects = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  } catch {
    return out
  }
  const walk = (d: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (/^agent-.+\.jsonl$/.test(e.name)) {
        const id = e.name.replace(/^agent-/, '').replace(/\.jsonl$/, '')
        out.set(id, { path: full, meta: readJson(full.replace(/\.jsonl$/, '.meta.json')) })
      }
    }
  }
  for (const sid of sessionsOf(dir)) for (const proj of projects) walk(path.join(root, proj, sid, 'subagents'))
  return out
}

function attributor(dir: string, repo: string, slugs: string[], claudeDir: string | undefined): (row: Obj) => string {
  const plan = new Set(slugs)
  const norm = (p: string): string => {
    const f = flat(p).replace(/\/+$/, '')
    return process.platform === 'win32' ? f.toLowerCase() : f
  }
  const trees = new Map(slugs.flatMap((s) => CREW_NAME_PREFIXES.map((p): [string, string] => [norm(path.join(repo, '.claude', 'worktrees', `${p}${s}`)), s])))
  const spawns = new Map<string, string>()
  for (const e of rowsOf(path.join(dir, 'events.jsonl'))) if (e.event === 'spawn' && typeof e.agentId === 'string' && typeof e.crew === 'string') spawns.set(e.agentId, e.crew)
  const agents = agentsOf(claudeDir, dir)
  const slugOfLabel = (d: unknown): string | undefined => {
    const s = labelSlug(d)
    return s !== undefined && plan.has(s) ? s : undefined
  }
  return (row) => {
    if (row.agentId === null || row.agentId === undefined) return MAIN
    const id = String(row.agentId)
    const a = agents.get(id)
    const meta = isObj(a?.meta) ? a.meta : undefined
    if (a !== undefined && flat(a.path).includes('/subagents/workflows/')) {
      const s = slugOfLabel(meta?.description)
      if (s !== undefined) return s
    }
    const spawned = spawns.get(id)
    if (spawned !== undefined) return spawned
    if (typeof meta?.worktreePath === 'string') {
      const s = trees.get(norm(meta.worktreePath))
      if (s !== undefined) return s
    }
    const s = slugOfLabel(meta?.description)
    if (s !== undefined) return s
    return startedDirectly(nameOfMeta(meta) ?? row.agent, slugs) ? MAIN : UNATTRIBUTED
  }
}

function costOf(dir: string, repo: string, claudeDir: string | undefined): Cost | null {
  if (!fs.existsSync(path.join(dir, 'usage.jsonl'))) return null
  const rows = rowsOf(path.join(dir, 'usage.jsonl')).filter((r) => typeof r.msgId === 'string')
  const cfg = readJson(resolveConfigPath(repo))
  const pricing = isObj(cfg) ? cfg.pricing : undefined
  const plan = readJson(path.join(dir, 'plan.json'))
  const slugs = isObj(plan) && Array.isArray(plan.crews) ? plan.crews.filter(isObj).map((c) => c.slug).filter((s): s is string => typeof s === 'string') : []
  const approved = isObj(plan) && typeof plan.approvedAt === 'string' && Number.isFinite(Date.parse(plan.approvedAt)) ? plan.approvedAt : null
  const of = attributor(dir, repo, slugs, claudeDir)
  const session = sumOf(rows, pricing)
  const sinceMs = approved === null ? NaN : Date.parse(approved)
  const run = approved === null ? { usd: null, tokens: 0 } : sumOf(rows.filter((r) => Date.parse(String(r.ts)) >= sinceMs), pricing)
  const mine = new Map<string, Obj[]>()
  for (const r of rows) {
    const c = of(r)
    mine.set(c, [...(mine.get(c) ?? []), r])
  }
  const crews: Cost['crews'] = []
  for (const s of [...slugs, MAIN, UNATTRIBUTED]) {
    const rs = mine.get(s) ?? []
    if (rs.length === 0) {
      if (slugs.includes(s)) crews.push({ crew: s, tokens: 0, usd: null, why: 'not recorded' })
      continue
    }
    const x = sumOf(rs, pricing)
    crews.push(x.usd === null ? { crew: s, tokens: x.tokens, usd: null, why: `not priced: ${x.unpriced.join(', ')}` } : { crew: s, tokens: x.tokens, usd: x.usd })
  }
  const byModel = new Map<string, Obj[]>()
  for (const r of rows) byModel.set(String(r.model), [...(byModel.get(String(r.model)) ?? []), r])
  const models = [...byModel.keys()].sort().map((m) => {
    const x = sumOf(byModel.get(m)!, pricing)
    return { model: m, tokens: x.tokens, usd: x.usd }
  })
  return { run: { since: approved, tokens: run.tokens, usd: run.usd }, session: { tokens: session.tokens, usd: session.usd }, crews, models, unpriced: session.unpriced }
}

// Reads on every call but recomputes only when usage.jsonl, events.jsonl, plan.json or the config changed (or every RECHECK_MS).
export function createCostReader(repo: string, claudeDir: string | undefined): (dir: string | null) => Cost | null {
  let last: { key: string; at: number; value: Cost | null } | null = null
  return (dir) => {
    if (dir === null) return null
    const key = [dir, ...['usage.jsonl', 'events.jsonl', 'plan.json'].map((f) => sigOf(path.join(dir, f))), sigOf(resolveConfigPath(repo))].join('|')
    const now = Date.now()
    if (last !== null && last.key === key && now - last.at < RECHECK_MS) return last.value
    const value = costOf(dir, repo, claudeDir)
    last = { key, at: now, value }
    return value
  }
}
