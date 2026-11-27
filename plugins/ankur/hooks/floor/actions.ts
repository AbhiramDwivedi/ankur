// What the floor's actions say and check. A stuck-crew action is a message (the stuck-crew texts); an inbox action is a
// `/ankur:inbox` line. Every action only fills the prompt box, after a preview and a confirm: the plugin never submits,
// so the line reaches the gate as the client's own typed prompt. Lines are built here and nowhere else.
// This file holds no JSX and no `claude-code` import, so `node --test` loads it.
import type { CrewView, NeedView } from './types.ts'
import type { FillView } from '../../types/index.d.ts'
import type { Fs } from './load.ts'

// The live proof's branch (checks/real-cli-floor-fill.e2e.ts): whether a line the floor filled and the client sent with
// Enter passes the inbox gate's typed-prompt check with its code inside. `floor roundtrip: fill-proof.json holds fillProof`
// pins this equal to tests/fixtures/floor/fill-proof.json. When it is false the floor fills the line without the code and
// shows the code for the client to type.
export const fillProof: { ok: boolean; claudeVersion: string } = { ok: true, claudeVersion: '2.1.332 (Claude Code)' }

export type Verb = 'approve' | 'reject' | 'answer'

// How long a confirm waits for its checks before it says it could not finish them.
export const CHECK_MS = 5000

export function stuckActions(c: CrewView): { key: string; label: string; text: string }[] {
  if (!c.stuck) return []
  const lead = `Crew ${c.slug} is stuck: ${c.stuck.detail}.`
  const role = c.stuck.agent.split('-').pop() ?? 'agent'
  const first = c.stuck.kind === 'idle-project-manager'
    ? { key: 'successor', label: 'Start a successor project manager', text: `${lead} Start a successor project manager for it.` }
    : { key: 'restart', label: `Restart ${role}`, text: `${lead} Restart its ${role}.` }
  return [
    first,
    { key: 'replan', label: 'Re-plan crew', text: `${lead} Re-plan this crew.` },
    { key: 'ask', label: 'Ask Claude', text: `${lead} What is happening, and what do you suggest?` },
  ]
}

// The line a verb fills. With the code: `/ankur:inbox <verb> <id> <code>`, and for an answer a trailing space where the client's
// words go. Without it the line ends where the code goes and the client types the code (and an answer's words) after it.
const lineOf = (verb: Verb, a: { id: string; code: string }, withCode: boolean): string => {
  const head = `/ankur:inbox ${verb} ${a.id} `
  if (!withCode) return head
  return verb === 'answer' ? `${head}${a.code} ` : `${head}${a.code}`
}

export const approveLine = (a: { id: string; code: string }, withCode: boolean = fillProof.ok): string => lineOf('approve', a, withCode)
export const rejectLine = (a: { id: string; code: string }, withCode: boolean = fillProof.ok): string => lineOf('reject', a, withCode)
export const answerLine = (a: { id: string; code: string }, withCode: boolean = fillProof.ok): string => lineOf('answer', a, withCode)

const BUILD: Record<Verb, typeof approveLine> = { approve: approveLine, reject: rejectLine, answer: answerLine }

// The line for a verb on an item: with the code only when the live proof allows it and this session holds the code.
export const inboxLine = (verb: Verb, id: string, code: string | null): string => BUILD[verb]({ id, code: code ?? '' }, code !== null && fillProof.ok)

// What the client types after the filled line: the code when the line leaves it out (and, for an answer, the words after it),
// or null when the line is whole. `missing`: this session holds no code for the item.
export function typesCode(f: FillView): { kind: 'code' | 'answer'; code: string } | { kind: 'missing' } | null {
  if (f.verb === null) return null
  if (f.code === null) return { kind: 'missing' }
  if (fillProof.ok) return null
  return { kind: f.verb === 'answer' ? 'answer' : 'code', code: f.code }
}

// The inbox actions the floor offers for an item's kind: a plan approval is approved or rejected, a question is answered
// in the client's own words. Any other kind is resolved in the session.
export function inboxActions(n: NeedView): Verb[] {
  return n.kind === 'client-trigger' ? ['approve', 'reject'] : n.kind === 'client-question' ? ['answer'] : []
}

// ---- what is read at preview and confirm time -----------------------------------------------------------------------

const slash = (p: string): string => p.replace(/\\/g, '/')
const trim = (p: string): string => slash(p).replace(/(.)\/+$/, '$1')
const parent = (p: string): string => trim(p).replace(/\/[^/]*$/, '') || '/'
const INBOX_TAIL = 2 * 1024 * 1024
// an item id is a lowercase slug; anything else never becomes part of a path
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i

export type ItemRead = { state: 'open'; code: string | null } | { state: 'resolved'; decision: string }

const text = async (fs: Fs, path: string, options?: { offset?: number; length?: number }): Promise<string> => {
  const got = await fs.read(path, options)
  return typeof got === 'string' ? got : ''
}

// An item as the shared inbox holds it: the session of its last `open` row, and the decision of a `resolve` row after it.
async function rowsOf(fs: Fs, file: string, id: string): Promise<{ session: string | null; decision: string | null }> {
  const size = (await fs.stat(file)).size
  const offset = Math.max(0, size - INBOX_TAIL)
  let session: string | null = null
  let decision: string | null = null
  for (const line of (await text(fs, file, { offset, length: size - offset })).split('\n')) {
    let o: Record<string, unknown>
    try { o = JSON.parse(line) } catch { continue }
    if (o?.id !== id) continue
    if (o.op === 'open') { session = typeof o.session === 'string' ? o.session : null; decision = null }
    else if (o.op === 'resolve') decision = typeof o.decision === 'string' && o.decision !== '' ? o.decision : 'resolved'
  }
  return { session, decision }
}

// One item as it stands now: resolved in the shared inbox, or open with the code of its own session's sidecar
// `<run dir>/escalate-code-<id>.json`. The sidecar is read only for an item whose open row names the Claude session the floor runs in (an item
// of another session has its code in that session's dir, never this one's). Nothing is written. A read that fails is a
// code not held (null), never a guess; a fixture (no run dir) holds no code.
export async function readItem(fs: Fs, source: string, dir: string | null, id: string, session: string): Promise<ItemRead> {
  if (source !== 'run' || dir === null || !ID_RE.test(id)) return { state: 'open', code: null }
  try {
    const row = await rowsOf(fs, `${parent(dir)}/shared/inbox.jsonl`, id)
    if (row.decision !== null) return { state: 'resolved', decision: row.decision }
    if (row.session !== session) return { state: 'open', code: null }
  } catch {
    // no readable inbox: the item cannot be shown resolved, and its session is unknown, so no code is read
    return { state: 'open', code: null }
  }
  try {
    const side = JSON.parse(await text(fs, `${trim(dir)}/escalate-code-${id}.json`))
    return { state: 'open', code: side?.id === id && typeof side.code === 'string' && side.code !== '' ? side.code : null }
  } catch {
    return { state: 'open', code: null }
  }
}

// The first preview of an inbox action, from what is known before the sidecar is read.
export const openFill = (verb: Verb, item: string, code: string | null): FillView =>
  ({ state: 'ready', line: inboxLine(verb, item, code), item, verb, code, refusal: null, decision: null })

// The preview of a stuck-crew message.
export const crewFill = (slug: string, line: string): FillView =>
  ({ state: 'ready', line, item: slug, verb: null, code: null, refusal: null, decision: null })

// The fill after a re-read of its item and of the prompt box. A resolved item is `resolved`. A code that is not the one the
// client was shown is `changed`: the line is redrawn and the client confirms again, so the floor never fills a line the client
// did not see. `opening` skips that comparison (the first read has nothing to compare). Text in the box is `draft`.
export function inspected(f: FillView, item: ItemRead | null, draft: string, opening: boolean): FillView {
  if (item?.state === 'resolved') return { ...f, state: 'resolved', decision: item.decision }
  if (item !== null && f.verb !== null) {
    const code = item.code
    if (!opening && code !== f.code) return { ...f, state: 'changed', code, line: inboxLine(f.verb, f.item, code) }
    if (opening) f = { ...f, code, line: inboxLine(f.verb, f.item, code) }
  }
  return { ...f, state: draft !== '' ? 'draft' : 'ready' }
}

// How the prompt box answered a fill that did not take the line.
export const refusedBy = (cause: 'dialog' | 'no_composer' | undefined): 'dialog' | 'no_composer' | 'hook' => cause ?? 'hook'
