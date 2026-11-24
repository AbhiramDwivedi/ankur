// A repository's earlier Claude Code sessions, read-only and in memory only: the transcripts under
// <claudeDir>/projects/<project key>/<session id>.jsonl and the run dirs under <git common dir>/ankur/<session id>/.
// Also the sessions another process holds right now, from <claudeDir>/sessions/<pid>.json (Claude Code's own
// registry of its running processes). Every reader here never throws; any doubt gives "not there".
// Node built-ins only; erasable TypeScript.
import fs from 'node:fs'
import path from 'node:path'
import { projectKeyOf } from './transcript.ts'

export interface PriorSession {
  id: string
  /** ISO time of the newest write to the transcript or the run dir. */
  lastActive: string
  /** The first prompt line, else the run's goal; null when neither was recorded. */
  title: string | null
  transcript: boolean
  ankurDir: boolean
  /** Another live process holds this session (a terminal `claude --resume`, another UI). */
  live: boolean
}

export interface ConversationEntry {
  role: 'user' | 'assistant'
  text: string
  ts: string
}

/** A session id is one plain path segment: the SDK's uuid, never a path. */
export const isSessionId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(s) && s !== '.' && s !== '..'

const HEAD = 256 * 1024
const TAIL = 8 * 1024 * 1024
const TITLE_MAX = 160
const KEEP = 500

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

function readRange(file: string, from: number, len: number): string | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(len)
    let n = 0
    while (n < len) {
      const got = fs.readSync(fd, buf, n, len - n, from + n)
      if (got === 0) break
      n += got
    }
    return buf.subarray(0, n).toString('utf8')
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        // nothing left to do
      }
    }
  }
}

/** The plain text of a user or assistant line, or null for tool traffic, meta lines and sub-agent lines. */
export function textOfLine(line: string): { role: 'user' | 'assistant'; text: string; ts: string } | null {
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    return null
  }
  if (o === null || typeof o !== 'object' || o.isMeta === true || o.isSidechain === true) return null
  if (o.type !== 'user' && o.type !== 'assistant') return null
  const c = o.message?.content
  let text = ''
  if (typeof c === 'string') text = c
  else if (Array.isArray(c)) text = c.filter((b: any) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n')
  text = text.trim()
  if (text === '') return null
  // Claude Code's own wrappers (command echoes, caveats, reminders) are not something the client typed.
  if (o.type === 'user' && text.startsWith('<')) return null
  return { role: o.type, text, ts: typeof o.timestamp === 'string' ? o.timestamp : '' }
}

const oneLine = (s: string): string => (s.split('\n').find((l) => l.trim() !== '') ?? '').trim()

/** The first user prompt of the transcript, one line, cut to TITLE_MAX. */
export function firstPrompt(file: string): string | null {
  const text = readRange(file, 0, HEAD)
  if (text === null) return null
  for (const l of text.split('\n')) {
    const t = textOfLine(l)
    if (t !== null && t.role === 'user') return oneLine(t.text).slice(0, TITLE_MAX) || null
  }
  return null
}

function planGoal(dir: string): string | null {
  try {
    const s = safeStat(path.join(dir, 'plan.json'))
    if (s === null || s.size > 1024 * 1024) return null
    const v = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8')) as { goal?: unknown } | null
    return v !== null && typeof v.goal === 'string' ? oneLine(v.goal).slice(0, TITLE_MAX) || null : null
  } catch {
    return null
  }
}

/** The last KEEP user and assistant texts of a session's transcript, oldest first; [] when there is none. */
export function readConversation(file: string): ConversationEntry[] {
  const st = safeStat(file)
  if (st === null || !st.isFile()) return []
  const from = Math.max(0, st.size - TAIL)
  const text = readRange(file, from, st.size - from)
  if (text === null) return []
  const lines = text.split('\n')
  if (from > 0) lines.shift() // a cut first line
  const out: ConversationEntry[] = []
  for (const l of lines) {
    const t = textOfLine(l)
    if (t !== null) out.push(t)
  }
  return out.slice(-KEEP)
}

export const isAlivePid = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' // it exists; we may not signal it
  }
}

/** The session ids a running Claude Code process holds, from <claudeDir>/sessions/<pid>.json. */
export function liveSessionIds(claudeDir: string, alive: (pid: number) => boolean = isAlivePid): Set<string> {
  const out = new Set<string>()
  let names: string[]
  try {
    names = fs.readdirSync(path.join(claudeDir, 'sessions'))
  } catch {
    return out
  }
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    try {
      const v = JSON.parse(fs.readFileSync(path.join(claudeDir, 'sessions', n), 'utf8')) as { pid?: unknown; sessionId?: unknown } | null
      if (v !== null && typeof v.pid === 'number' && typeof v.sessionId === 'string' && alive(v.pid)) out.add(v.sessionId)
    } catch {
      // a file being written, or not ours
    }
  }
  return out
}

export const transcriptFile = (claudeDir: string, repo: string, id: string): string => path.join(claudeDir, 'projects', projectKeyOf(repo), `${id}.jsonl`)

/**
 * The repository's earlier sessions, newest first. `runRoot` is <git common dir>/ankur (null outside git).
 * `exclude` is the workspace's own current session.
 */
export function listPriorSessions(opts: {
  repo: string
  claudeDir: string
  runRoot: string | null
  exclude?: string | null
  alive?: (pid: number) => boolean
}): PriorSession[] {
  const found = new Map<string, { at: number; transcript: boolean; dir: string | null }>()
  const note = (id: string, at: number, kind: 'transcript' | 'dir', dir: string | null) => {
    const cur = found.get(id) ?? { at: 0, transcript: false, dir: null }
    found.set(id, { at: Math.max(cur.at, at), transcript: cur.transcript || kind === 'transcript', dir: kind === 'dir' ? dir : cur.dir })
  }
  const projectDir = path.join(opts.claudeDir, 'projects', projectKeyOf(opts.repo))
  try {
    for (const n of fs.readdirSync(projectDir)) {
      const m = /^(.+)\.jsonl$/.exec(n)
      if (m === null || !isSessionId(m[1])) continue
      const s = safeStat(path.join(projectDir, n))
      if (s !== null && s.isFile()) note(m[1], s.mtimeMs, 'transcript', null)
    }
  } catch {
    // no project dir: no transcripts
  }
  if (opts.runRoot !== null) {
    try {
      for (const n of fs.readdirSync(opts.runRoot)) {
        if (n === 'shared' || !isSessionId(n)) continue
        const dir = path.join(opts.runRoot, n)
        const s = safeStat(dir)
        if (s === null || !s.isDirectory()) continue
        // The run's own files say when it was last active; the dir's mtime only moves when a file is created.
        const files = ['events.jsonl', 'plan.json'].map((f) => safeStat(path.join(dir, f))?.mtimeMs ?? 0)
        note(n, Math.max(...files) || s.mtimeMs, 'dir', dir)
      }
    } catch {
      // no run root: no run dirs
    }
  }
  const live = liveSessionIds(opts.claudeDir, opts.alive)
  const out: PriorSession[] = []
  for (const [id, f] of found) {
    if (id === opts.exclude) continue
    const title = (f.transcript ? firstPrompt(path.join(projectDir, `${id}.jsonl`)) : null) ?? (f.dir !== null ? planGoal(f.dir) : null)
    out.push({ id, lastActive: new Date(f.at).toISOString(), title, transcript: f.transcript, ankurDir: f.dir !== null, live: live.has(id) })
  }
  return out.sort((a, b) => (a.lastActive < b.lastActive ? 1 : a.lastActive > b.lastActive ? -1 : a.id < b.id ? 1 : -1))
}
