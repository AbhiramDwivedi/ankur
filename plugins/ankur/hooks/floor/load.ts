// Reads an ankur run dir through the engine's $.fs (the module has no Node) and folds it into the
// FloorView the band and the pane draw. events.jsonl is read by byte ranges from where the last poll
// stopped, so a poll costs one stat when nothing changed and only the new lines when something did.
import { createReducer, type Plan, type PlanCrew, type Reducer, type Crew } from './reduce.ts'
import { renderMermaidAscii } from './vendor/zombie-mermaid.js'
import type { AdrView, CrewView, DecisionView, DiagramView, FloorView, NeedView } from './types.ts'

// The slice of $.fs the loader uses; the hook hands it `$.fs`.
export interface Fs {
  read(path: string, options?: { offset?: number; length?: number }): Promise<unknown>
  stat(path: string): Promise<{ kind: string; size: number; mtimeMs: number }>
  list(path?: string): Promise<readonly { name: string; kind: string; size: number; mtimeMs: number }[]>
  exists(path: string): Promise<boolean>
}

const CHUNK = 1024 * 1024
const DECISIONS_TAIL = 256 * 1024
const INBOX_TAIL = 2 * 1024 * 1024

export const emptyView = (error: string | null = null): FloorView => ({
  source: 'none', dir: null, goal: null, loadedAt: 0, eventLines: 0,
  crews: [], needs: [], decisions: [], adrs: [], diagrams: [], error,
})

const text = async (fs: Fs, path: string, options?: { offset?: number; length?: number }): Promise<string> => {
  const got = await fs.read(path, options)
  return typeof got === 'string' ? got : ''
}
const sigOf = async (fs: Fs, path: string): Promise<string | null> => {
  try {
    const s = await fs.stat(path)
    return `${s.size}:${s.mtimeMs}`
  } catch {
    return null
  }
}
// Paths are kept in forward-slash form, which every platform's file calls accept: on Windows the
// engine hands `C:\work\app`, and the helpers below split only on '/'.
export const slash = (p: string): string => p.replace(/\\/g, '/')
const trim = (p: string): string => slash(p).replace(/(.)\/+$/, '$1')
const parent = (p: string): string => trim(p).replace(/\/[^/]*$/, '') || '/'
const base = (p: string): string => trim(p).replace(/^.*\//, '')

// `p` made absolute against `from`, with `.` and `..` folded; keeps a leading `C:` or `/`.
function resolve(from: string, p: string): string {
  const abs = /^([A-Za-z]:)?\//.test(slash(p)) ? slash(p) : `${trim(from)}/${slash(p)}`
  const [head = '', ...rest] = abs.split('/')
  const out: string[] = []
  for (const seg of rest) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return `${head}/${out.join('/')}`
}

// The repo's git common dir, where ankur keeps its runs: `<repo>/.git` in a normal checkout; in a
// linked worktree (or a submodule) `.git` is a file naming the gitdir, whose `commondir` file points
// back at the shared one. Null outside git.
export async function gitCommonDir(fs: Fs, repo: string): Promise<string | null> {
  const dotgit = `${trim(repo)}/.git`
  let kind: string
  try {
    kind = (await fs.stat(dotgit)).kind
  } catch {
    return null
  }
  if (kind === 'dir') return dotgit
  if (kind !== 'file') return null
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(await text(fs, dotgit))
  if (!m?.[1]) return null
  const gitdir = resolve(trim(repo), m[1])
  try {
    const common = (await text(fs, `${gitdir}/commondir`)).trim()
    if (common !== '') return resolve(gitdir, common)
  } catch {
    // no commondir: a submodule's gitdir is its own common dir
  }
  return gitdir
}

// UTF-8 byte length of a JS string, to turn the consumed part of a text read back into a byte offset.
function utf8Len(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}
const s = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function planOf(raw: Record<string, unknown>): Plan {
  const crews: PlanCrew[] = (Array.isArray(raw.crews) ? raw.crews : []).flatMap((c: Record<string, unknown>) =>
    typeof c?.slug === 'string'
      ? [{
          slug: c.slug,
          stage: num(c.stage),
          verdict: s(c.verdict),
          status: (['planned', 'running', 'merged', 'dropped'].includes(c.status as string) ? c.status : null) as PlanCrew['status'],
          goal: s(c.goal),
          owns: Array.isArray(c.owns) ? c.owns.filter((o): o is string => typeof o === 'string') : [],
          estAgents: num(c.estAgents),
        }]
      : [])
  return {
    goal: s(raw.goal), version: num(raw.version),
    approval: raw.approval === 'auto' || raw.approval === 'client' ? raw.approval : null,
    approvedAt: s(raw.approvedAt), crews, goals: [],
  }
}

// work, QC, runner and retry agents of a crew, the project manager apart: runner by type, else a second or later
// attempt (<slug>-<role>-<n>, n >= 2), else QC by type, else work.
function countsOf(c: Crew): CrewView['counts'] {
  const counts = { work: 0, qc: 0, runner: 0, retry: 0 }
  for (const m of c.members) {
    const n = /^.+-(\d+)$/.exec(m.name.startsWith(`${c.slug}-`) ? m.name.slice(c.slug.length + 1) : '')?.[1]
    if (m.type === 'ankur:runner') counts.runner++
    else if (n !== undefined && Number(n) >= 2) counts.retry++
    else if (m.type === 'ankur:qc-engineer') counts.qc++
    else counts.work++
  }
  return counts
}

function crewView(c: Crew, qc: CrewView['qc'] = null): CrewView {
  const members = [...(c.projectManager ? [c.projectManager] : []), ...c.members].map(m => ({
    name: m.name, type: m.type, model: m.model, effort: m.effort, state: m.state, detail: m.detail,
  }))
  return {
    slug: c.slug, stage: c.stage, status: c.status, goal: c.goal, estAgents: c.estAgents, members, qc, counts: countsOf(c),
    latest: c.latest?.text ?? null, latestTs: c.latest?.ts ?? null,
    stuck: c.stuck === null ? null : {
      kind: c.stuck.kind, minutes: c.stuck.minutes, detail: c.stuck.detail,
      agent: c.stuck.detail.replace(/ stalled .*$/, ''),
    },
  }
}

export function parseDecisions(md: string): DecisionView[] {
  const out: DecisionView[] = []
  let run = ''
  for (const line of md.split('\n')) {
    const h = /^## Run (.*)$/.exec(line)
    if (h) { run = h[1] ?? ''; continue }
    const d = /^- (\d\d:\d\d) \| ([^|]*)\|?([^|]*)/.exec(line)
    if (d) out.push({ run, time: d[1] ?? '', text: (d[2] ?? '').trim(), why: (d[3] ?? '').trim() })
  }
  return out.slice(-200)
}

export function diagramsOf(md: string): DiagramView[] {
  const out: DiagramView[] = []
  let heading = ''
  const lines = md.split('\n')
  const at = (i: number) => lines[i] ?? ''
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,4} (.*)$/.exec(at(i))
    if (h) heading = h[1] ?? ''
    if (at(i).trim() !== '```mermaid') continue
    const body: string[] = []
    for (i++; i < lines.length && at(i).trim() !== '```'; i++) body.push(at(i))
    const source = body.join('\n')
    let drawn: string[] | null = null
    try {
      const art = renderMermaidAscii(source, { useAscii: false, colorMode: 'none', paddingY: 1 })
      drawn = art.split('\n').map(l => l.trimEnd())
      while (drawn.length > 0 && drawn[drawn.length - 1] === '') drawn.pop()
      if (drawn.length === 0) drawn = null
    } catch {
      drawn = null
    }
    out.push({ heading, lines: drawn, source })
  }
  return out
}

// The newest run dir under <git common dir>/ankur that has a plan.json.
export async function newestRunDir(fs: Fs, repo: string): Promise<string | null> {
  const common = await gitCommonDir(fs, repo)
  if (common === null) return null
  const root = `${common}/ankur`
  let entries: Awaited<ReturnType<Fs['list']>>
  try {
    entries = await fs.list(root)
  } catch {
    return null
  }
  let best: { dir: string; t: number } | null = null
  for (const e of entries) {
    if (e.kind !== 'dir' || e.name === 'shared') continue
    try {
      const st = await fs.stat(`${root}/${e.name}/events.jsonl`)
      if (!(await fs.exists(`${root}/${e.name}/plan.json`))) continue
      if (best === null || st.mtimeMs > best.t) best = { dir: `${root}/${e.name}`, t: st.mtimeMs }
    } catch {
      // no events yet
    }
  }
  return best?.dir ?? null
}

// Where the loader is in one rolled log: the highest rolled n folded, the byte offset into the live file, the lines folded.
// `mirrored`: the live file was a copy of the newest rolled file at the last poll, so none of its lines were folded.
interface Log { name: string; last: number; offset: number; lines: number; mirrored: boolean }
const newLog = (name: string): Log => ({ name, last: 0, offset: 0, lines: 0, mirrored: false })

// Whether two files hold the same bytes, `size` being the first one's size; read a chunk at a time.
async function sameFile(fs: Fs, a: string, b: string, size: number): Promise<boolean> {
  try {
    if (size === 0 || (await fs.stat(b)).size !== size) return false
    for (let offset = 0; offset < size; offset += CHUNK) {
      const length = Math.min(CHUNK, size - offset)
      if ((await text(fs, a, { offset, length })) !== (await text(fs, b, { offset, length }))) return false
    }
    return true
  } catch {
    return false
  }
}

// The verdict of a message summary: its first non-empty line is `VERDICT: PASS` or `VERDICT: FAIL`; the template line
// `VERDICT: PASS | ...` is none.
function verdictOf(summary: string): 'PASS' | 'FAIL' | null {
  const first = summary.split('\n').find(l => l.trim() !== '')?.trimStart() ?? ''
  if (/^VERDICT: (PASS|FAIL) \| /.test(first)) return null
  if (first.startsWith('VERDICT: PASS')) return 'PASS'
  if (first.startsWith('VERDICT: FAIL')) return 'FAIL'
  return null
}

interface RunState {
  dir: string
  repo: string
  reducer: Reducer
  events: Log
  messages: Log
  verdicts: Map<string, 'PASS' | 'FAIL'>
  planSig: string | null
  plan: Plan | null
  decisionsSig: string | null
  decisions: DecisionView[]
  inboxSig: string | null
  needs: NeedView[]
  adrs: AdrView[] | null
  diagrams: DiagramView[] | null
}

export function createLoader() {
  let st: RunState | null = null

  function reset(dir: string): RunState {
    // <repo>/.git/ankur/<session>: the repo is three levels up (for a worktree's run, the main checkout)
    st = {
      dir, repo: parent(parent(parent(dir))), reducer: createReducer(), events: newLog('events'), messages: newLog('messages'), verdicts: new Map(),
      planSig: null, plan: null, decisionsSig: null, decisions: [], inboxSig: null, needs: [],
      adrs: null, diagrams: null,
    }
    return st
  }

  // Reads `file` from byte `from` to `size`, whole lines only; returns the offset it reached.
  async function readLines(fs: Fs, file: string, from: number, size: number, onLine: (line: string) => void, onBig: () => void): Promise<number> {
    let offset = from
    while (offset < size) {
      const length = Math.min(CHUNK, size - offset)
      const chunk = await text(fs, file, { offset, length })
      const cut = chunk.lastIndexOf('\n')
      if (cut < 0) {
        if (length < CHUNK) return offset // a partial last line: wait for its newline
        onBig() // a line over 1 MiB: skip its bytes
        offset += length
        continue
      }
      const whole = chunk.slice(0, cut + 1)
      for (const line of whole.split('\n')) if (line.trim() !== '') onLine(line)
      offset += utf8Len(whole)
    }
    return offset
  }

  // A log the engine rolls: <name>.jsonl is live, rolled files <name>.<n>.jsonl hold older lines, n ascending. The live file's
  // bytes at the roll are the new rolled file's, so the first new rolled file is read from where the live read stopped, any
  // further one from its start, then the live file from its start.
  async function readLog(fs: Fs, r: RunState, log: Log, onLine: (line: string, no: number) => void, onBig: (no: number) => void, reset: () => void): Promise<void> {
    const live = `${r.dir}/${log.name}.jsonl`
    let rolled: number[] = []
    try {
      const re = new RegExp(`^${log.name}\\.(\\d+)\\.jsonl$`)
      rolled = (await fs.list(r.dir)).flatMap(e => (e.kind === 'file' && re.test(e.name) ? [Number(re.exec(e.name)![1])] : [])).sort((a, b) => a - b)
    } catch {
      return // no run dir listing: skip this poll; a guess would read a roll as a truncation and lose or double lines
    }
    let size = 0
    let hasLive = true
    try {
      size = (await fs.stat(live)).size
    } catch {
      hasLive = false
    }
    const fresh = rolled.filter(n => n > log.last)
    if (fresh.length === 0 && size < log.offset) { // truncated: start over
      reset()
      log.offset = 0
      log.last = 0
      log.lines = 0
      for (const n of rolled) await foldRolled(fs, r, log, n, onLine, onBig, 0)
      log.last = rolled[rolled.length - 1] ?? 0
    } else {
      for (const [i, n] of fresh.entries()) await foldRolled(fs, r, log, n, onLine, onBig, i === 0 ? log.offset : 0)
      if (fresh.length > 0) { log.last = fresh[fresh.length - 1]!; log.offset = 0 }
    }
    if (!hasLive) return
    // Between the roll copy and the live rewrite the live file still equals the newest rolled file, whose lines are folded.
    const newest = rolled[rolled.length - 1]
    if (newest !== undefined && (fresh.length > 0 || log.mirrored) && log.offset === 0) {
      log.mirrored = await sameFile(fs, live, `${r.dir}/${log.name}.${newest}.jsonl`, size)
      if (log.mirrored) return
    }
    log.offset = await readLines(fs, live, log.offset, size, line => onLine(line, ++log.lines), () => onBig(log.lines + 1))
  }

  async function foldRolled(fs: Fs, r: RunState, log: Log, n: number, onLine: (line: string, no: number) => void, onBig: (no: number) => void, from: number): Promise<void> {
    const file = `${r.dir}/${log.name}.${n}.jsonl`
    let size = 0
    try {
      size = (await fs.stat(file)).size
    } catch {
      return
    }
    await readLines(fs, file, Math.min(from, size), size, line => onLine(line, ++log.lines), () => onBig(log.lines + 1))
  }

  async function readEvents(fs: Fs, r: RunState): Promise<void> {
    await readLog(
      fs, r, r.events,
      (line, no) => {
        try {
          if (r.reducer.event(JSON.parse(line)) === 'version') r.reducer.skip('events.jsonl', no, 'version')
        } catch {
          r.reducer.skip('events.jsonl', no, 'json')
        }
      },
      no => r.reducer.skip('events.jsonl', no, 'json'),
      () => { r.reducer = createReducer() },
    )
  }

  // The newest line of each crew that starts with a verdict (the rule of the UI's verdictOf: the template
  // `VERDICT: PASS | ...` is none), in write order.
  async function readMessages(fs: Fs, r: RunState): Promise<void> {
    await readLog(
      fs, r, r.messages,
      line => {
        try {
          const o = JSON.parse(line)
          const v = verdictOf(typeof o?.summary === 'string' ? o.summary : '')
          if (v !== null && typeof o.from === 'string') r.verdicts.set(o.from, v)
        } catch {
          // a bad line carries no verdict
        }
      },
      () => {},
      () => r.verdicts.clear(),
    )
  }

  async function readPlan(fs: Fs, r: RunState): Promise<void> {
    const file = `${r.dir}/plan.json`
    const sig = await sigOf(fs, file)
    if (sig === r.planSig) return
    r.planSig = sig
    try {
      r.plan = planOf(JSON.parse(await text(fs, file)))
    } catch {
      // keep the last good plan while the file is mid-write
    }
  }

  async function readDecisions(fs: Fs, r: RunState): Promise<void> {
    const file = `${r.dir}/decisions.md`
    const sig = await sigOf(fs, file)
    if (sig === r.decisionsSig || sig === null) return
    r.decisionsSig = sig
    const size = Number(sig.split(':')[0])
    const offset = Math.max(0, size - DECISIONS_TAIL)
    const body = await text(fs, file, { offset, length: size - offset })
    // a tail read starts mid-section: carry the last heading before it
    let head = ''
    if (offset > 0) {
      const before = await text(fs, file, { length: Math.min(offset, 8192) })
      head = before.split('\n').find(l => l.startsWith('## Run ')) ?? ''
    }
    r.decisions = parseDecisions(`${head}\n${offset > 0 ? body.slice(body.indexOf('\n') + 1) : body}`)
  }

  async function readInbox(fs: Fs, r: RunState): Promise<void> {
    const file = `${parent(r.dir)}/shared/inbox.jsonl`
    const sig = await sigOf(fs, file)
    if (sig === r.inboxSig) return
    r.inboxSig = sig
    if (sig === null) { r.needs = []; return }
    const size = Number(sig.split(':')[0])
    const offset = Math.max(0, size - INBOX_TAIL)
    const session = base(r.dir)
    const opened = new Map<string, NeedView>()
    const resolved = new Set<string>()
    for (const line of (await text(fs, file, { offset, length: size - offset })).split('\n')) {
      let o: Record<string, unknown>
      try { o = JSON.parse(line) } catch { continue }
      if (typeof o?.id !== 'string') continue
      if (o.op === 'open' && o.session === session && !opened.has(o.id)) {
        opened.set(o.id, { id: o.id, kind: s(o.kind) || 'decision', title: s(o.title) ?? '', session, onYes: s(o.onYes) ?? '', onNo: s(o.onNo) ?? '' })
      } else if (o.op === 'resolve') resolved.add(o.id)
    }
    r.needs = [...opened.values()].filter(n => !resolved.has(n.id))
  }

  async function config(fs: Fs, r: RunState): Promise<{ adr: string | null; architecture: string | null }> {
    try {
      const c = JSON.parse(await text(fs, `${r.repo}/.claude/ankur.json`))
      return { adr: s(c.adr), architecture: s(c.architecture) }
    } catch {
      return { adr: null, architecture: null }
    }
  }

  async function readDocs(fs: Fs, r: RunState): Promise<void> {
    if (r.adrs !== null && r.diagrams !== null) return
    const c = await config(fs, r)
    r.adrs = []
    if (c.adr !== null) {
      const dir = `${r.repo}/${trim(c.adr)}`
      try {
        const files = (await fs.list(dir)).filter(f => /^\d{4}-.*\.md$/.test(f.name)).map(f => f.name).sort()
        for (const file of files) {
          const head = await text(fs, `${dir}/${file}`, { length: 2048 })
          const title = /^# (.*)$/m.exec(head)?.[1] ?? file
          const status = /^Status: *([A-Za-z-]+)/m.exec(head)?.[1] ?? ''
          r.adrs.push({ file, title, status })
        }
      } catch {
        // no ADR dir
      }
    }
    r.diagrams = []
    const arch = c.architecture !== null ? `${r.repo}/${slash(c.architecture)}` : `${r.dir}/design/architecture.md`
    try {
      r.diagrams = diagramsOf(await text(fs, arch))
    } catch {
      // no architecture doc
    }
  }

  return {
    get dir() { return st?.dir ?? null },
    async poll(fs: Fs, rawDir: string, now: number): Promise<FloorView> {
      const dir = trim(rawDir)
      const r = st !== null && st.dir === dir ? st : reset(dir)
      await readPlan(fs, r)
      await readEvents(fs, r)
      await readMessages(fs, r)
      await readDecisions(fs, r)
      await readInbox(fs, r)
      await readDocs(fs, r)
      const run = r.reducer.build(r.plan, () => null)
      return {
        source: 'run', dir, goal: run.goal, loadedAt: now, eventLines: r.events.lines,
        crews: run.crews.map(c => crewView(c, r.verdicts.get(c.slug) ?? null)), needs: r.needs, decisions: r.decisions,
        adrs: r.adrs ?? [], diagrams: r.diagrams ?? [], error: null,
      }
    },
  }
}

// A ui/contract fixture snapshot (state.json): the server's built state, for the states a finished run can't show.
export async function fixtureView(fs: Fs, file: string, now: number): Promise<FloorView> {
  const snap = JSON.parse(await text(fs, file))
  const run = snap.run ?? {}
  const needs: NeedView[] = (snap.requests ?? [])
    .filter((q: Record<string, unknown>) => q.status === 'open')
    .map((q: Record<string, any>) => ({ id: q.id, kind: q.kind, title: q.questions?.[0]?.question ?? q.title ?? q.kind, session: String(q.session ?? ''), onYes: String(q.onYes ?? ''), onNo: String(q.onNo ?? '') }))
  const decisions: DecisionView[] = (snap.decisions ?? []).map((d: Record<string, any>) => {
    const [time = '', what = '', why = ''] = String(d.text).split(' | ')
    return { run: String(d.run ?? ''), time, text: what, why }
  })
  return {
    source: 'fixture', dir: file, goal: run.goal ?? null, loadedAt: now, eventLines: 0,
    crews: (run.crews ?? []).map((c: Crew) => crewView({ ...c, projectManager: c.projectManager ?? null, members: c.members ?? [] })),
    needs, decisions, adrs: snap.adrs ?? [],
    diagrams: typeof snap.design?.architecture === 'string' ? diagramsOf(snap.design.architecture) : [],
    error: null,
  }
}
