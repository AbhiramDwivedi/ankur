// The inbox (contract-025 section 3): escalate, inbox, resolve and mark-applied over S/inbox.jsonl, plus the gate helpers
// blockingFor and budgetRaises. Imports node: builtins and relative paths only, and never factory.ts (its top-level await would make an import cycle).

import { spawnSync } from 'node:child_process'
import { createHash, randomInt } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliError, commonDir, configOf, flat, listOf, readText, refuse, sharedDir, str, usage, need } from './core.ts'
import { CODE_WORDS } from './inbox-words.ts'
import { readJsonl, withLock, writeJsonAtomic } from './lock.ts'
import { proofTranscriptRoot, readProofFile } from './transcripts.ts'
import type { Flags, Obj } from './core.ts'

export type EscalateInput = { kind: string; title: string; detail?: string; crews?: string[]; ref?: string | null; blocking?: boolean; ownSession?: boolean; risk?: string; onYes?: string; onNo?: string }
export type EscalateOut = { id: string; kind: string; deduped: boolean; code: string; notified: boolean | null; notifyError?: string; message?: string }

// The plain summary of an item: what it costs or risks, what happens on a yes, what happens on a no.
type Summary = { risk: string; onYes: string; onNo: string }

// kind -> who may resolve it, whether it always blocks, whether a --by pm resolve needs --note (graded by risk), and the plain summary
// shown when the caller passes none (every client kind has one).
const KINDS: Record<string, { by: 'client' | 'any'; blocking: boolean; evidence?: true; text?: Summary }> = {
  'client-question': { by: 'client', blocking: false, text: { risk: 'None; the crew only needs your answer', onYes: 'The crew takes your answer and goes on', onNo: 'The crew goes on without it, or stops if it cannot' } },
  'scope-change': { by: 'client', blocking: true, text: { risk: 'The goal grows or changes, so the work takes longer and costs more', onYes: 'The crew builds the changed scope', onNo: 'The crew keeps to the scope you approved' } },
  'pm-question': { by: 'any', blocking: true },
  'client-trigger': { by: 'client', blocking: true, text: { risk: 'The run goes ahead and its agents start spending', onYes: 'The run goes ahead as planned', onNo: 'The run stays stopped until the plan changes' } },
  'long-term-cost': { by: 'client', blocking: true, text: { risk: 'A choice that costs more to keep or undo later', onYes: 'The crew keeps the choice and goes on', onNo: 'The crew picks another approach' } },
  budget: { by: 'client', blocking: true, text: { risk: 'The run has spent its spend limit, and going on adds to the bill', onYes: 'The run goes on with the allowance you add: type raise <usd> with the amount in dollars', onNo: 'The run stays stopped at its limit' } },
  'allowance-spent': { by: 'any', blocking: true, evidence: true },
  'doctor-bundle': { by: 'client', blocking: true, text: { risk: 'A set of setup changes to your project files', onYes: 'The changes are applied to the project', onNo: 'Your project files stay as they are' } },
  blocked: { by: 'any', blocking: true },
  'stall-unrecovered': { by: 'any', blocking: true },
  'push-pr': { by: 'client', blocking: false, text: { risk: 'Your code is published on the remote and may be seen by others', onYes: 'You push and open the pull request, then mark it done', onNo: 'Nothing is published' } },
  'prod-deploy': { by: 'client', blocking: false, text: { risk: 'A change goes live for real users and may be hard to undo', onYes: 'You deploy it, then mark it done', onNo: 'Nothing is deployed' } },
  'intake-triage': { by: 'client', blocking: false, text: { risk: 'Work you did not ask for is sorted into your plan', onYes: 'The crew takes the sorted work into the plan', onNo: 'The crew leaves the work out' } },
}
const FALLBACK_TEXT: Summary = { risk: 'See the title and detail of this item', onYes: 'The run goes on as the title says', onNo: 'The run goes on without it, or stops if it cannot' }
const DECISIONS = ['approve', 'reject', 'answer', 'done', 'dismiss']
const SUMMARY_MAX = 300
const NAME_WORDS = 5
const NAME_CHARS = 40
const SLUG_RE = /^[A-Za-z0-9._-]+$/

const sessionOf = (dir: string): string => path.posix.basename(flat(dir).replace(/\/+$/, ''))
const codeHashOf = (id: string, code: string): string => createHash('sha256').update(id + code).digest('hex')

// An item folded from its ops, in file order. resolve is the first resolve row that counts, or the client's later correction of a
// reply-proved one (see verifiedItems), else null; a row that did not
// count leaves reopened (why, and the row's by, ts and decision); a client resolve counted by proof carries the typed text as its note; noteUnbound marks one whose stored note differed.
export type Item = { open: Obj; crews: string[]; blocking: boolean; held: Set<string>; resolve: Obj | null; applied: string[]; reopened?: { reason: string; by: unknown; ts: unknown; decision: unknown }; noteUnbound?: boolean }
// rows: the resolve rows in file order; ranBefore[i]: an applied op comes before rows[i] in the file (a correction after it never counts)
type RawItem = Item & { rows: Obj[]; ranBefore: boolean[] }
const heldKey = (session: string, slug: string): string => `${session}\n${slug}`

function fold(rows: Obj[]): Map<string, RawItem> {
  const items = new Map<string, RawItem>()
  for (const r of rows) {
    if (typeof r.id !== 'string') continue
    if (r.op === 'open') {
      if (items.has(r.id)) continue
      const crews: string[] = Array.isArray(r.crews) ? r.crews.map(String) : []
      const it: RawItem = { open: r, crews: [...crews], blocking: r.blocking === true, held: new Set(), resolve: null, applied: [], rows: [], ranBefore: [] }
      if (it.blocking) for (const c of crews) it.held.add(heldKey(String(r.session), c))
      items.set(r.id, it)
      continue
    }
    const it = items.get(r.id)
    if (it === undefined) continue
    if (r.op === 'link') {
      const crews: string[] = Array.isArray(r.crews) ? r.crews.map(String) : []
      for (const c of crews) if (!it.crews.includes(c)) it.crews.push(c)
      if (r.blocking === true) {
        it.blocking = true
        for (const c of crews) it.held.add(heldKey(String(r.session), c))
      }
    } else if (r.op === 'resolve') {
      it.rows.push(r)
      it.ranBefore.push(it.applied.length > 0)
    } else if (r.op === 'applied') {
      it.applied.push(String(r.session))
    }
  }
  return items
}

// ---- the verified fold: the one reading of the inbox ----

// A candidate typed row of a main transcript: the row, its typed text, and whether its parentUuid resolves to an earlier row.
type Cand = { row: Obj; text: string; at: number; chain: boolean }
type FileScan = { sig: string; ids: Set<string>; cands: Map<string, Cand[]> }
// One scan per file and process, keyed on path; valid while path, size, mtime, ctime and inode are the same. Nothing is kept on disk.
const scans = new Map<string, FileScan>()

// Every typed candidate row that names one of `ids`, from a byte search for each id before any line is parsed. The file is read once.
function scanFile(main: string, session: string, ids: Set<string>): FileScan | null {
  let st: { size: number; mtimeMs: number; ctimeMs: number; ino: number }
  try {
    st = statSync(main)
  } catch {
    return null
  }
  const sig = `${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.ino}`
  const had = scans.get(main)
  if (had !== undefined && had.sig === sig && [...ids].every((i) => had.ids.has(i))) return had
  const want = new Set(ids)
  if (had !== undefined && had.sig === sig) for (const i of had.ids) want.add(i)
  let buf: Buffer
  try {
    buf = readProofFile(main)
  } catch {
    return null // unreadable, or over the size a Buffer holds: the row does not count
  }
  const cands = new Map<string, Cand[]>()
  const typed = Buffer.from('"type":"user"')
  for (const id of want) {
    const list: Cand[] = []
    const needle = Buffer.from(id)
    let seenLine = -1
    for (let p = buf.indexOf(needle); p !== -1; p = buf.indexOf(needle, p + needle.length)) {
      const ls = buf.lastIndexOf(10, p) + 1
      if (ls === seenLine) continue
      seenLine = ls
      let le = buf.indexOf(10, p)
      if (le === -1) le = buf.length
      const t = buf.indexOf(typed, ls)
      if (t === -1 || t >= le) continue
      let row: any
      try {
        row = JSON.parse(buf.toString('utf8', ls, le))
      } catch {
        continue
      }
      if (row === null || typeof row !== 'object' || typeof row.uuid !== 'string' || row.sessionId !== session) continue
      const text = typedText(row)
      if (text === null) continue
      list.push({ row, text, at: Date.parse(row.timestamp), chain: chainOk(buf, ls, row) })
    }
    cands.set(id, list)
  }
  const scan: FileScan = { sig, ids: want, cands }
  scans.set(main, scan)
  return scan
}

// The row's parentUuid resolves to an earlier row of the same file; null only when no user or assistant row comes before it.
function chainOk(buf: Buffer, ls: number, row: Obj): boolean {
  const parent = row.parentUuid
  if (parent === null) {
    const before = buf.subarray(0, ls)
    return before.indexOf('"type":"user"') === -1 && before.indexOf('"type":"assistant"') === -1
  }
  if (typeof parent !== 'string' || parent === '') return false
  return rowBefore(buf, ls, parent) !== null
}

// The row whose uuid is `uuid` on a line before the line starting at `ls`, with its line start; null when there is none.
function rowBefore(buf: Buffer, ls: number, uuid: string): { row: any; ls: number } | null {
  const needle = Buffer.from(`"uuid":${JSON.stringify(uuid)}`)
  let from = ls - needle.length
  while (from >= 0) {
    const p = buf.lastIndexOf(needle, from)
    if (p === -1) return null
    const s = buf.lastIndexOf(10, p) + 1
    let e = buf.indexOf(10, p)
    if (e === -1) e = buf.length
    try {
      const row = JSON.parse(buf.toString('utf8', s, e))
      if (row !== null && typeof row === 'object' && row.uuid === uuid) return { row, ls: s }
    } catch {
      // a match inside a line that is not a row
    }
    from = p - 1
  }
  return null
}

// ---- the reply proof: a typed reply to an assistant message that showed the item ----

// A typed row of a main transcript and the assistant text of the turn just before it (each part with its time): the rows its parentUuid
// chain passes through back to the previous typed row. What the client read on screen when they typed the reply. shown is null when
// the chain breaks: the row is still the client's newest typed row, so it still hides every reply before it.
type Reply = { row: Obj; text: string; at: number; shown: { text: string; at: number }[] | null }
type ReplyScan = { sig: string; after: number; replies: Reply[] }
// One reply scan per file and process, like scans: valid while the file signature is the same and it covers rows from `after` on.
const replyScans = new Map<string, ReplyScan>()
// How many rows the walk back from a reply may pass; a longer turn proves nothing (fails closed).
const WALK_MAX = 20000

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// `id` as a whole name in `text`: not inside a longer name (`foo` is not named by `foo-2` or `x-foo`).
const namesId = (text: string, id: string): boolean => new RegExp(`(?<![A-Za-z0-9]|[A-Za-z0-9]-)${escRe(id)}(?![A-Za-z0-9]|-[A-Za-z0-9])`).test(text)
// The parts of the turn before reply `k` that show `open`: newer than the item, naming its id.
const showsItem = (k: Reply, open: Obj): { text: string; at: number }[] => (k.shown ?? []).filter((s) => s.at > Date.parse(open.ts) && namesId(s.text, String(open.id)))
// The dollar amounts the message proposed for `open`, distinct: `$20`, `$ 7.50`, `20 USD` on a line that names the item. A bare "ok"
// approves a budget raise at the amount the client read, so the amount comes from the message, never from the agent's flag alone.
function shownAmounts(k: Reply, open: Obj): number[] {
  const out = new Set<number>()
  for (const s of showsItem(k, open)) {
    for (const line of s.text.split('\n')) {
      if (!namesId(line, String(open.id))) continue
      for (const m of line.matchAll(/\$\s?(\d+(?:\.\d+)?)(?![\d.]*\d)|(?<![\d.])(\d+(?:\.\d+)?)\s?(?:USD|usd|dollars)\b/g)) {
        const n = Number(m[1] ?? m[2])
        if (Number.isFinite(n) && n > 0) out.add(n)
      }
    }
  }
  return [...out]
}

// The assistant text of the turn before the typed row at `ls`: walk its parentUuid chain back until the previous typed row or the start
// of the chain. Null when the chain breaks or runs past WALK_MAX rows. Only main-thread assistant text blocks count; tool input,
// thinking, tool results and task notifications are passed over.
function shownBefore(buf: Buffer, ls: number, row: Obj): { text: string; at: number }[] | null {
  const parts: { text: string; at: number }[] = []
  let parent = row.parentUuid
  let from = ls
  for (let step = 0; step < WALK_MAX; step++) {
    if (parent === null) return parts
    if (typeof parent !== 'string' || parent === '') return null
    const found = rowBefore(buf, from, parent)
    if (found === null) return null
    const r = found.row
    if (r.type === 'user' && typedText(r) !== null) return parts
    if (r.type === 'assistant' && !r.isSidechain && Array.isArray(r.message?.content)) {
      const text = r.message.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n')
      if (text !== '') parts.push({ text, at: Date.parse(r.timestamp) })
    }
    parent = r.parentUuid
    from = found.ls
  }
  return null
}

// Every typed row of `session` in `main` newer than `after`, with the text shown before it. The file is read once.
function replyScanFile(main: string, session: string, after: number): ReplyScan | null {
  let st: { size: number; mtimeMs: number; ctimeMs: number; ino: number }
  try {
    st = statSync(main)
  } catch {
    return null
  }
  const sig = `${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.ino}`
  const had = replyScans.get(main)
  if (had !== undefined && had.sig === sig && had.after <= after) return had
  let buf: Buffer
  try {
    buf = readProofFile(main)
  } catch {
    return null
  }
  const replies: Reply[] = []
  const typed = Buffer.from('"type":"user"')
  let seenLine = -1
  for (let p = buf.indexOf(typed); p !== -1; p = buf.indexOf(typed, p + typed.length)) {
    const ls = buf.lastIndexOf(10, p) + 1
    if (ls === seenLine) continue
    seenLine = ls
    let le = buf.indexOf(10, p)
    if (le === -1) le = buf.length
    const line = buf.subarray(ls, le)
    if (!line.includes('"promptSource":"') && !line.includes('<command-name>')) continue // no typed row lacks both
    let row: any
    try {
      row = JSON.parse(line.toString('utf8'))
    } catch {
      continue
    }
    if (row === null || typeof row !== 'object' || typeof row.uuid !== 'string' || row.sessionId !== session) continue
    const at = Date.parse(row.timestamp)
    if (!Number.isFinite(at) || !(at > after)) continue
    const text = typedText(row)
    if (text === null) continue
    replies.push({ row, text, at, shown: shownBefore(buf, ls, row) })
  }
  replies.sort((x, y) => x.at - y.at)
  const scan: ReplyScan = { sig, after, replies }
  replyScans.set(main, scan)
  return scan
}

// Why `k` does not prove a --reply resolve of `open` with `c`, or '' when it does.
function replyFails(repo: string, open: Obj, c: { decision: unknown; raiseUsd?: unknown; quote?: unknown }, k: Reply): string {
  const id = String(open.id)
  const after = Date.parse(open.ts)
  if (!(k.at > after)) return `the reply is older than ${id}`
  if (k.shown === null) return "the client's reply does not follow a message in this transcript (its parentUuid chain breaks)"
  if (c.quote !== undefined && !(typeof c.quote === 'string' && c.quote !== '' && (k.text.startsWith(c.quote) || String(maskCode(k.text, open.id, open.codeHash)).startsWith(c.quote)))) return 'the reply is not the stored quote'
  if (showsItem(k, open).length === 0) return `the message just before the client's reply does not show ${id}`
  if (String(open.kind) === 'budget' && c.decision === 'approve' && c.raiseUsd === undefined) return `a budget approve by reply needs the amount the message that showed ${id} proposed`
  if (c.raiseUsd !== undefined && !shownAmounts(k, open).includes(Number(c.raiseUsd))) return `the message that showed ${id} does not propose the amount $${String(c.raiseUsd)} on the line that names it`
  if (!ownsCwd(repo, k.row.cwd)) return 'the reply was typed in another repo'
  return ''
}

// The client's newest typed reply at or before `before` (ms): the only one a --reply resolve made then could rest on. An older reply
// answered an older message, so a reply the client has since typed past ("what else?") never proves a later resolve.
const newestReply = (replies: Reply[], before: number): Reply | null => {
  let found: Reply | null = null
  for (const k of replies) if (k.at <= before) found = k
  return found
}

// Why a --reply resolve of `open` with `c`, made at `before`, is not proved by the client's newest reply then, or '' when it is.
function replyProof(repo: string, open: Obj, c: { decision: unknown; raiseUsd?: unknown; quote?: unknown }, replies: Reply[], before: number): { k: Reply | null; why: string } {
  if (typeof c.decision !== 'string' || !DECISIONS.includes(c.decision)) return { k: null, why: 'the decision is not one of ' + DECISIONS.join(', ') }
  if (c.raiseUsd !== undefined && typeof c.raiseUsd !== 'number') return { k: null, why: 'raiseUsd is not a number' }
  const k = newestReply(replies, before)
  if (k === null || !(k.at > Date.parse(open.ts))) return { k: null, why: `the client has typed no reply since ${String(open.id)} was opened` }
  const why = replyFails(repo, open, c, k)
  return why === '' ? { k, why } : { k: null, why }
}

// The note a reply-proved row carries: the stored note when it is the client's own words (a part of the reply), else the whole reply.
const replyNote = (reply: string, note: unknown): { note: string; unbound: boolean } => {
  const n = norm(String(note ?? ''))
  const all = norm(reply).slice(0, 4000)
  if (n === '') return { note: all, unbound: false }
  return norm(reply).includes(n) ? { note: n.slice(0, 4000), unbound: false } : { note: all, unbound: true }
}

// ---- the card proof: the client's answer to a question card (AskUserQuestion) the main session showed ----

// One question of a card: its text and header, the labels it offered, and the client's answer (an offered label, or their own words
// typed into the card's free-text field), or undefined when the client gave none.
type CardQuestion = { question: string; header: string; labels: string[]; answer: string | undefined }
// An answered card: the tool_use id, the answer row's time, the answer row, and its questions as the main session asked them.
type Card = { id: string; at: number; row: Obj; questions: CardQuestion[] }
type CardScan = { sig: string; cards: Card[] }
// One card scan per file and process, like scans: valid while the file signature is the same.
const cardScans = new Map<string, CardScan>()

/**
 * Every answered card of `session` in `main`, in file order. A card counts only on the main chain: an AskUserQuestion tool_use in a
 * main-thread (not sidechain) assistant row of this session, and a later main-thread user row of this session whose tool_result answers
 * that tool_use, is not an error (a declined or denied card is), names its assistant row in sourceToolAssistantUUID and carries the answers
 * in toolUseResult. Claude Code offers the tool only to an interactive main session or an SDK host that answers it (canUseTool): `claude -p`
 * and a subagent do not have it, so an answered card is a human's click or words, or an SDK host's (the card amendment of the shared-store ADR).
 */
function cardScanFile(main: string, session: string): CardScan | null {
  let st: { size: number; mtimeMs: number; ctimeMs: number; ino: number }
  try {
    st = statSync(main)
  } catch {
    return null
  }
  const sig = `${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.ino}`
  const had = cardScans.get(main)
  if (had !== undefined && had.sig === sig) return had
  let buf: Buffer
  try {
    buf = readProofFile(main)
  } catch {
    return null
  }
  const asked = new Map<string, { uuid: string; questions: any[] }>()
  const cards: Card[] = []
  const tool = Buffer.from('"AskUserQuestion"')
  const answered = Buffer.from('"toolUseResult":{')
  for (let ls = 0; ls < buf.length; ) {
    let le = buf.indexOf(10, ls)
    if (le === -1) le = buf.length
    const line = buf.subarray(ls, le)
    const next = le + 1
    const isAsk = line.includes(tool)
    if (!isAsk && !line.includes(answered)) {
      ls = next
      continue
    }
    let row: any
    try {
      row = JSON.parse(line.toString('utf8'))
    } catch {
      ls = next
      continue
    }
    ls = next
    if (row === null || typeof row !== 'object' || row.isSidechain || row.sessionId !== session || typeof row.uuid !== 'string') continue
    const content = row.message?.content
    if (!Array.isArray(content)) continue
    if (row.type === 'assistant') {
      for (const b of content) if (b?.type === 'tool_use' && b.name === 'AskUserQuestion' && typeof b.id === 'string' && Array.isArray(b.input?.questions)) asked.set(b.id, { uuid: row.uuid, questions: b.input.questions })
      continue
    }
    if (row.type !== 'user' || row.isMeta) continue
    const results = content.filter((b: any) => b?.type === 'tool_result')
    if (results.length !== 1 || results[0].is_error === true) continue
    const ask = asked.get(String(results[0].tool_use_id))
    if (ask === undefined || row.sourceToolAssistantUUID !== ask.uuid) continue
    const answers = row.toolUseResult?.answers
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) continue
    const at = Date.parse(row.timestamp)
    if (!Number.isFinite(at)) continue
    const questions: CardQuestion[] = ask.questions
      .filter((q: any) => q !== null && typeof q === 'object' && typeof q.question === 'string')
      .map((q: any) => ({
        question: q.question,
        header: typeof q.header === 'string' ? q.header : '',
        labels: (Array.isArray(q.options) ? q.options : []).map((o: any) => o?.label).filter((l: unknown): l is string => typeof l === 'string'),
        answer: typeof answers[q.question] === 'string' && answers[q.question].trim() !== '' ? answers[q.question] : undefined,
      }))
    cards.push({ id: String(results[0].tool_use_id), at, row, questions })
  }
  const scan: CardScan = { sig, cards }
  cardScans.set(main, scan)
  return scan
}

// An offered label without a trailing "(Recommended)", lowercased: a card for approve, reject, done or dismiss counts only when this is the
// decision word itself.
const labelWord = (label: string): string => label.replace(/\s*\(recommended\)\s*$/i, '').trim().toLowerCase()
// The two options a card for each decision offers, no more: the PM writes the card, so a third option or a longer label could approve
// something narrower than the item.
const CARD_PAIRS: Record<string, readonly [string, string]> = { approve: ['approve', 'reject'], reject: ['approve', 'reject'], done: ['done', 'dismiss'], dismiss: ['done', 'dismiss'] }
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Why the card `card` does not prove a --card resolve of `open` with `c`, or the question and answer that do. The card is newer than the
 * item; one of its questions names the item's id (in its text or header) and was answered; for approve, reject, done and dismiss the question
 * quotes the item's title (case and runs of whitespace aside), the options are exactly Approve and Reject (or Done and Dismiss), one of them
 * perhaps marked "(Recommended)", and the answer is the option that is the decision word (free text the client typed into the card is their
 * reply, never an approval); for answer, any options and any answer count. A budget approve takes the amount the question proposed.
 */
function cardFails(repo: string, open: Obj, c: { decision: unknown; raiseUsd?: unknown }, card: Card): { why: string } | { q: CardQuestion; answer: string; raiseUsd?: number } {
  const id = String(open.id)
  if (!(card.at > Date.parse(open.ts))) return { why: `the card is older than ${id}` }
  const q = card.questions.find((x) => (namesId(x.question, id) || namesId(x.header, id)) && x.answer !== undefined)
  if (q === undefined) return { why: `the client's newest card answer names no question about ${id}` }
  const answer = q.answer as string
  if (c.decision !== 'answer') {
    const title = squash(String(open.title ?? ''))
    if (title === '' || !squash(q.question).includes(title)) return { why: `the card's question about ${id} does not quote its title ${JSON.stringify(String(open.title ?? ''))}: ask a card whose question holds the id and the title word for word` }
    const pair = CARD_PAIRS[String(c.decision)]
    const words = q.labels.map(labelWord)
    const recommended = q.labels.filter((l) => /\(recommended\)\s*$/i.test(l)).length
    if (words.length !== 2 || !pair.every((w) => words.includes(w)) || recommended > 1) {
      return { why: `the card's options were ${JSON.stringify(q.labels)}, not exactly ${pair.map((w) => w[0].toUpperCase() + w.slice(1)).join(' and ')}` }
    }
    if (!q.labels.includes(answer)) return { why: `the client typed their own words into the card (${JSON.stringify(answer.slice(0, 200))}), not an option: read them as their reply and ask again` }
    if (labelWord(answer) !== c.decision) return { why: `the client chose ${JSON.stringify(answer)} on the card, not ${String(c.decision)}` }
  }
  let usd = c.raiseUsd as number | undefined
  if (String(open.kind) === 'budget' && c.decision === 'approve') {
    const shown = shownAmounts({ row: {}, text: '', at: card.at, shown: [{ text: `${q.header}\n${q.question}`.replace(/^\n/, ''), at: card.at }] }, open)
    if (usd === undefined) {
      if (shown.length !== 1) return { why: `a budget approve by card needs the one amount the card's question about ${id} proposed, on the line that names it` }
      usd = shown[0]
    } else if (!shown.includes(usd)) return { why: `the card's question about ${id} does not propose the amount $${usd}` }
  }
  if (!ownsCwd(repo, card.row.cwd)) return { why: 'the card was answered in another repo' }
  return { q, answer, ...(usd === undefined ? {} : { raiseUsd: usd }) }
}

/**
 * The card behind a --card resolve of `open`: the one with tool_use id `cardId` when the row names it (the fold re-verifies a stored row),
 * else the client's newest answered card at or before `before` that names the item. Its proof, or why it does not prove the resolve.
 */
function cardProof(repo: string, open: Obj, c: { decision: unknown; raiseUsd?: unknown }, cards: Card[], before: number, cardId?: unknown): { card: Card; q: CardQuestion; answer: string; raiseUsd?: number } | { why: string } {
  if (typeof c.decision !== 'string' || !DECISIONS.includes(c.decision)) return { why: 'the decision is not one of ' + DECISIONS.join(', ') }
  if (c.raiseUsd !== undefined && typeof c.raiseUsd !== 'number') return { why: 'raiseUsd is not a number' }
  const id = String(open.id)
  let card: Card | undefined
  if (cardId !== undefined) card = cards.find((k) => k.id === cardId && k.at <= before)
  else for (const k of cards) if (k.at <= before && k.at > Date.parse(open.ts) && k.questions.some((x) => (namesId(x.question, id) || namesId(x.header, id)) && x.answer !== undefined)) card = k
  if (card === undefined) return { why: `the client has answered no card about ${id} since it was opened` }
  const p = cardFails(repo, open, c, card)
  return 'why' in p ? p : { card, ...p }
}

// The quote a card-proved row stores: the question the client read and the answer they gave.
const cardQuote = (q: CardQuestion, answer: string): string => `${q.question} -> ${answer}`.slice(0, 1000)

// The main transcript of `session` under the proof root, or null.
function proofMain(session: string): string | null {
  if (!SLUG_RE.test(session) || session === '.' || session === '..') return null
  const root = proofTranscriptRoot()
  let projects: string[]
  try {
    projects = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  } catch {
    return null
  }
  for (const proj of projects) {
    const main = `${root}/${proj}/${session}.jsonl`
    if (existsSync(main)) return main
  }
  return null
}

const commonOf = (dir: string): string | null => {
  try {
    return commonDir(dir)
  } catch {
    return null // not a git repo: commonDir throws a usage error
  }
}

/**
 * A typed line proves a resolve only for the repo its session ran in: inbox.jsonl is forgeable, so an open row copied from another repo
 * would otherwise be proved by that repo's typed line. The transcript row's cwd is the only repo binding the client's file holds. A cwd under
 * the repo (its worktrees included) or in the same git common dir passes; an existing cwd of another repo is refused. A row with no cwd, or
 * a cwd that no longer exists and is not under the repo, cannot be shown foreign and passes.
 */
function ownsCwd(repo: string, cwd: unknown): boolean {
  if (typeof cwd !== 'string' || cwd === '') return true
  const c = flat(cwd).replace(/\/+$/, '')
  const r = flat(repo).replace(/\/+$/, '')
  if (c === r || c.startsWith(r + '/')) return true
  if (!existsSync(c)) return true
  const theirs = commonOf(c)
  const ours = commonOf(r)
  return ours === null || (theirs !== null && theirs === ours)
}

const norm = (s: string): string => s.trim().split(/\s+/).filter(Boolean).join(' ')

// A quote shown to anyone: the item's code token becomes [code]. A reopened item makes its spent code live again, so no listing prints it.
const maskCode = (quote: unknown, id: string, codeHash: unknown): unknown =>
  typeof quote === 'string' ? quote.replace(/\S+/g, (tok) => (codeHashOf(id, tok) === codeHash ? '[code]' : tok)) : quote

// The typed line that proves a resolve of `open` (decision, raise, and the stored quote when the row has one): its newest candidate when
// `last`, else its first. rest is what follows `<decision> <id> <code> [raise <usd>]`, whitespace normalised.
function proof(repo: string, open: Obj, c: { decision: unknown; raiseUsd?: unknown; quote?: unknown }, cands: Cand[], last: boolean): { text: string; rest: string; at: number } | null {
  if (typeof c.decision !== 'string' || !DECISIONS.includes(c.decision)) return null
  if (c.raiseUsd !== undefined && typeof c.raiseUsd !== 'number') return null
  const after = Date.parse(open.ts)
  let found: { text: string; rest: string; at: number } | null = null
  for (const k of cands) {
    if (!k.chain || !Number.isFinite(k.at) || !(k.at > after)) continue
    if (c.quote !== undefined && !(typeof c.quote === 'string' && c.quote !== '' && (k.text.startsWith(c.quote) || String(maskCode(k.text, open.id, open.codeHash)).startsWith(c.quote)))) continue
    const t = argsOf(k.text).split(/\s+/)
    if (t[0] !== c.decision || t[1] !== open.id || t[2] === undefined || codeHashOf(open.id, t[2]) !== open.codeHash) continue
    let from = 3
    if (c.raiseUsd !== undefined) {
      if (t[3] !== 'raise' || !/^\d+(\.\d+)?$/.test(t[4] ?? '') || Number(t[4]) !== c.raiseUsd) continue
      from = 5
    } else if (t[3] === 'raise' && /^\d+(\.\d+)?$/.test(t[4] ?? '')) continue // a typed raise is never dropped: a row without raiseUsd cannot stand for it
    if (!ownsCwd(repo, k.row.cwd)) continue
    found = { text: k.text, rest: t.slice(from).join(' '), at: k.at }
    if (!last) break
  }
  return found
}

// The time (ms) of the client's typed line behind a counted resolve row, keyed by the row object verifiedItems returns.
const TYPED_AT = new WeakMap<object, number>()
export const typedAtOf = (resolve: Obj): number | undefined => TYPED_AT.get(resolve)

/**
 * The items of the shared inbox with their resolve rows verified at read time. A resolve row counts when its kind allows `by: any` and the
 * row says pm or client, or when the row is `by: client` and a typed row of the main transcript of the session it names proves it (see
 * proof). An unverified row counts as absent: the item is open, with `reopened` saying why. The first verified row wins, except that a
 * reply-proved winner is replaced by a later reply-proved row on a newer reply written before any applied op (the client's correction).
 */
export function verifiedItems(repo: string): Map<string, Item> {
  // (the time of the typed line behind a counted resolve row is kept in typedAtOf, never in the row)
  const items = fold(readJsonl(`${sharedDir(repo)}/inbox.jsonl`).rows)
  const ask = new Map<string, Set<string>>() // session -> ids whose client rows need a transcript
  const askReply = new Map<string, number>() // session -> the oldest open time of an item a reply row of it resolves
  const askCard = new Set<string>() // sessions a card-proved row names
  for (const [id, it] of items) {
    for (const r of it.rows) {
      if (r.by !== 'client' || typeof r.session !== 'string') continue
      if (r.proof === 'reply') {
        const after = Date.parse(it.open.ts)
        if (Number.isFinite(after)) askReply.set(r.session, Math.min(askReply.get(r.session) ?? Infinity, after))
      } else if (r.proof === 'card') askCard.add(r.session)
      else (ask.get(r.session) ?? ask.set(r.session, new Set()).get(r.session)!).add(id)
    }
  }
  const carded = new Map<string, { scan: CardScan | null; main: string | null }>()
  for (const session of askCard) {
    const main = proofMain(session)
    carded.set(session, { main, scan: main === null ? null : cardScanFile(main, session) })
  }
  const scanned = new Map<string, { scan: FileScan | null; main: string | null }>()
  for (const [session, ids] of ask) {
    const main = proofMain(session)
    scanned.set(session, { main, scan: main === null ? null : scanFile(main, session, ids) })
  }
  const replied = new Map<string, { scan: ReplyScan | null; main: string | null }>()
  for (const [session, after] of askReply) {
    const main = proofMain(session)
    replied.set(session, { main, scan: main === null ? null : replyScanFile(main, session, after) })
  }
  for (const it of items.values()) {
    const kind = String(it.open.kind)
    // the winning row's typed reply time when it is reply-proved: only a later reply-proved row on a newer reply, written before any
    // applied op, replaces it (a correction); any other counted row is final
    let wonReplyAt: number | null = null
    let won = false
    for (const [i, r] of it.rows.entries()) {
      if (won && (wonReplyAt === null || r.proof !== 'reply' || r.by !== 'client' || it.ranBefore[i])) continue
      let unbound = false
      let why = ''
      let proven: string | null = null
      let typedAt: number | null = null
      if (r.by !== 'client' && r.by !== 'pm') why = `the row says by ${JSON.stringify(r.by)}, not client or pm`
      else if (r.by === 'pm' && KINDS[kind]?.by !== 'any') why = `${kind} is resolved by the client, not by pm`
      else if (r.by === 'pm') why = ''
      else {
        const anyKind = KINDS[kind]?.by === 'any' // the row counts either way; an unproven note is flagged, never shown as the client's
        const s = typeof r.session === 'string' ? (r.proof === 'reply' ? replied : r.proof === 'card' ? carded : scanned).get(r.session) : undefined
        if (s === undefined) why = 'the row names no session'
        else if (r.proof === 'card') {
          // a card-proved row is re-verified against the card it names: answered on the main chain before the row was written
          const cs = s.scan as CardScan | null
          const at = Date.parse(String(r.ts))
          const p = cs === null || !Number.isFinite(at) || typeof r.card !== 'string' ? null : cardProof(repo, it.open, r, cs.cards, at, r.card)
          if (s.main === null) why = `no transcript of session ${r.session} under ${proofTranscriptRoot()}`
          else if (cs === null) why = `the transcript of session ${r.session} cannot be read`
          else if (p === null || 'why' in p) why = `no card answered by the client in session ${r.session} backs this ${String(r.decision)}${p !== null && 'why' in p ? `: ${p.why}` : ''}`
          else {
            proven = p.answer.slice(0, 4000)
            typedAt = p.card.at
          }
        }
        else if (r.proof === 'reply') {
          // a reply-proved row is re-verified the same way: the client's newest typed reply when the row was written answers a message
          // that showed the item, and its quote is the stored one
          const rs = s.scan as ReplyScan | null
          const at = Date.parse(String(r.ts))
          const k = rs === null || !Number.isFinite(at) ? null : replyProof(repo, it.open, r, rs.replies, at).k
          if (s.main === null) why = `no transcript of session ${r.session} under ${proofTranscriptRoot()}`
          else if (rs === null) why = `the transcript of session ${r.session} cannot be read`
          else if (k === null) why = `no reply typed by the client in session ${r.session} to a message that showed ${String(it.open.id)} backs this ${String(r.decision)}`
          else {
            const n = replyNote(k.text, r.note)
            proven = n.note
            typedAt = k.at
            unbound = n.unbound
          }
        }
        else if (s.main === null) why = `no transcript of session ${r.session} under ${proofTranscriptRoot()}`
        else if (s.scan === null) why = `the transcript of session ${r.session} cannot be read`
        else {
          const p = proof(repo, it.open, r, (s.scan as FileScan).cands.get(String(it.open.id)) ?? [], false)
          if (p === null) why = `no line typed by the client in session ${r.session} backs this ${String(r.decision)}`
          else {
            proven = p.rest.slice(0, 4000)
            typedAt = p.at
            if (norm(String(r.note ?? '')) !== '' && norm(String(r.note)).slice(0, 4000) !== proven) unbound = true
          }
        }
        if (anyKind && why !== '') {
          why = ''
          if (norm(String(r.note ?? '')) !== '') unbound = true
        }
      }
      if (won) {
        // a correction counts only on its own proof, on a reply newer than the one behind the row it replaces (one use per reply)
        if (why !== '' || proven === null || typedAt === null || !(typedAt > (wonReplyAt as number))) continue
      }
      if (why === '') {
        // a row counted by proof carries the client's typed text as its note, never the stored one, for every reader of the fold
        it.resolve = proven === null ? r : { ...r, note: proven }
        if (typedAt !== null) TYPED_AT.set(it.resolve, typedAt)
        if (unbound) it.noteUnbound = true
        else delete it.noteUnbound
        it.reopened = undefined
        won = true
        wonReplyAt = r.proof === 'reply' && r.by === 'client' && proven !== null && typedAt !== null ? typedAt : null
        continue
      }
      it.reopened ??= { reason: why, by: r.by, ts: r.ts, decision: r.decision }
    }
  }
  return items
}

const codeFile = (sessionDir: string, id: string): string => `${sessionDir}/escalate-code-${id}.json`

// Three random words: 1024^3 or more codes, as hard to guess as the six letters they replace.
const codeOf = (): string => Array.from({ length: 3 }, () => CODE_WORDS[randomInt(CODE_WORDS.length)]).join('-')

// The item name: the title in lowercase ASCII (accents folded), runs of other characters as one hyphen, at most NAME_WORDS words and NAME_CHARS
// characters cut at a word boundary (one longer word is cut hard). Nothing left of the title gives the kind.
function nameOf(title: string, kind: string): string {
  const words = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '')
  let name = ''
  for (const w of words.slice(0, NAME_WORDS)) {
    const next = name === '' ? w : `${name}-${w}`
    if (next.length > NAME_CHARS) break
    name = next
  }
  if (name === '' && words.length > 0) name = words[0].slice(0, NAME_CHARS)
  return name === '' ? kind : name
}

// One line of at most SUMMARY_MAX characters, and never the inbox command: every summary line stays before the first line that holds it.
const oneLine = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim().replaceAll('/ankur:inbox', 'ankur:inbox').slice(0, SUMMARY_MAX).trim()

// The six-line message the client reads: the title, the plain summary, then the two commands.
const messageOf = (title: string, s: Summary, id: string, code: string, kind = ''): string =>
  [oneLine(title), `Cost or risk: ${s.risk}`, `If you approve: ${s.onYes}`, `If you reject: ${s.onNo}`, `To approve, type: /ankur:inbox approve ${id} ${code}${kind === 'budget' ? ' raise <usd>' : ''}`, `To reject, type: /ankur:inbox reject ${id} ${code}`].join('\n')

// Same {v:1, ts, ...} line as factory.ts appendEvent. Ids and kinds only: never a title, detail, note, quote or code.
function event(dir: string, obj: Obj): void {
  mkdirSync(dir, { recursive: true })
  appendFileSync(`${flat(dir)}/events.jsonl`, JSON.stringify({ v: 1, ts: new Date().toISOString(), ...obj }) + '\n')
}

/** Raises an item to the inbox of the session `dir` names. */
export function escalate(repo: string, dir: string, input: EscalateInput): EscalateOut {
  const spec = KINDS[input.kind]
  if (spec === undefined) throw usage(`unknown kind: ${input.kind}; kinds: ${Object.keys(KINDS).join(', ')}`)
  const title = String(input.title ?? '').trim().slice(0, 200)
  if (title === '') throw usage('missing --title')
  const detail = String(input.detail ?? '').slice(0, 4000)
  const crews = (input.crews ?? []).map(String)
  for (const c of crews) if (!SLUG_RE.test(c)) throw usage(`bad crew slug: ${c}`)
  const ref = input.ref === undefined || input.ref === null || input.ref === '' ? null : String(input.ref)
  const blocking = spec.blocking || input.blocking === true
  const session = sessionOf(dir)
  const S = sharedDir(repo)
  const file = `${S}/inbox.jsonl`
  const code = codeOf()
  const dflt = spec.text ?? FALLBACK_TEXT
  const summary: Summary = { risk: oneLine(input.risk) || dflt.risk, onYes: oneLine(input.onYes) || dflt.onYes, onNo: oneLine(input.onNo) || dflt.onNo }
  // Everything that can throw but the append runs before it: a bad ankur.json or an unwritable session dir leaves no item whose code was never shown.
  const notifies = typeof configOf(repo).notify === 'string'
  mkdirSync(dir, { recursive: true })
  let open: Obj | null = null
  let out: EscalateOut | null = null
  // one lock: the dedupe read, the check and the single append
  withLock(S, 'inbox', () => {
    const ts = new Date().toISOString()
    if (ref !== null) {
      for (const [id, it] of verifiedItems(repo)) {
        if (it.resolve === null && it.open.kind === input.kind && it.open.ref === ref && (input.ownSession !== true || it.open.session === session)) {
          const link: Obj = { v: 1, op: 'link', id, ts, session, crews }
          if (blocking) link.blocking = true
          appendFileSync(file, JSON.stringify(link) + '\n')
          out = { id, kind: input.kind, deduped: true, code: '', notified: null }
          return
        }
      }
    }
    // two items can share a name: count up (-2, -3, ...) while the id is already in the shared file (read under the lock)
    const taken = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const base = nameOf(title, input.kind)
    let id = base
    for (let n = 2; taken.includes(`"id":"${id}"`); n++) id = `${base}-${n}`
    open = { v: 1, op: 'open', id, ts, kind: input.kind, session, crews, ref, blocking, title, detail, risk: summary.risk, onYes: summary.onYes, onNo: summary.onNo, codeHash: codeHashOf(id, code) }
    // the code outlives a process that dies after the append; removed when the item resolves, listed only by `inbox --recover-codes`
    writeJsonAtomic(codeFile(flat(dir), id), { id, code }, { mode: 0o600 })
    appendFileSync(file, JSON.stringify(open) + '\n')
    out = { id, kind: input.kind, deduped: false, code, notified: null, message: messageOf(title, summary, id, code, input.kind) }
  })
  const res = out as unknown as EscalateOut
  if (res.deduped) return { ...res, code: '' }
  const row = open as unknown as Obj
  const crew = crews[0] ?? 'main' // the schema requires a crew; 'main' is the run itself
  // the item exists and the code is in res: nothing below may throw it away
  const safeEvent = (obj: Obj): void => {
    try {
      event(dir, obj)
    } catch {
      // the event log is best effort here
    }
  }
  safeEvent({ event: 'escalate', crew, id: row.id, kind: row.kind, blocking })
  if (notifies) {
    const n = notify(repo, { ...row, code, message: res.message })
    res.notified = n.ok
    if (!n.ok) {
      res.notifyError = n.error
      safeEvent({ event: 'notify-error', crew, id: row.id, error: n.error })
    }
  }
  return res
}

// notify-run.ts in a child, after the lock is released: ok, or the failure text (at most 200 characters).
function notify(repo: string, row: Obj): { ok: boolean; error: string } {
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), 'notify-run.ts')
  const r = spawnSync(process.execPath, [bin], { input: JSON.stringify({ repo, row }), encoding: 'utf8', timeout: 15000, windowsHide: true })
  if (r.error) return { ok: false, error: `notify did not run: ${r.error.message}`.slice(0, 200) }
  if (r.status === 0) return { ok: true, error: '' }
  let error = ''
  try {
    const j = JSON.parse((r.stdout ?? '').trim().split('\n').pop() ?? '')
    if (typeof j?.error === 'string') error = j.error
  } catch {
    error = ''
  }
  return { ok: false, error: (error || `notify exited ${r.status}`).slice(0, 200) }
}

/** The ids of the open blocking items that hold the crew `slug` of `session`. */
export function blockingFor(repo: string, session: string, slug: string): string[] {
  const key = heldKey(session, slug)
  const ids: string[] = []
  for (const [id, it] of verifiedItems(repo)) if (it.resolve === null && it.held.has(key)) ids.push(id)
  return ids
}

/** The raises of the approved budget resolves of `session`: [{ref, raiseUsd}]. The session is the one the ref names (budget:<open-session>:...), whichever session resolved it. */
export function budgetRaises(repo: string, session: string): { ref: string; raiseUsd: number }[] {
  const out: { ref: string; raiseUsd: number }[] = []
  for (const it of verifiedItems(repo).values()) {
    const r = it.resolve
    if (r === null || it.open.kind !== 'budget' || r.decision !== 'approve') continue
    if (typeof r.raiseUsd !== 'number' || !(r.raiseUsd > 0) || typeof it.open.ref !== 'string' || !it.open.ref.startsWith(`budget:${session}:`)) continue
    out.push({ ref: it.open.ref, raiseUsd: r.raiseUsd })
  }
  return out
}

// The text of a main-thread line a human typed, or null: not isMeta, not isSidechain, string content or text blocks with no tool_result.
function typedText(row: Obj): string | null {
  if (row.type !== 'user' || row.isMeta || row.isSidechain || row.isCompactSummary || row.isVisibleInTranscriptOnly) return null
  if (row.origin !== undefined && row.origin?.kind !== 'human') return null
  // A /loop wakeup line has no origin and no isMeta but its text is what the agent passed to ScheduleWakeup.
  if (row.wakeupSource !== undefined || row.scheduledTaskId !== undefined || row.scheduledFireId !== undefined) return null
  // A prompt an SDK host sent (turnOrigin sdk, promptSource sdk, entrypoint sdk-*) is a program's line, like `claude -p`: never typed. A client
  // in the ankur UI approves by clicking a question card instead (see cardScanFile).
  if (row.turnOrigin !== undefined && row.turnOrigin !== 'human') return null
  // A plain prompt typed while the agent was busy is recorded as promptSource queued, with origin human: it counts like a typed one.
  const source = row.promptSource === 'queued' && row.origin?.kind === 'human' ? 'typed' : row.promptSource
  if (source !== undefined && source !== 'typed') return null
  const c = row.message?.content
  let text: string
  if (typeof c === 'string') text = c
  else if (!Array.isArray(c) || c.length === 0) return null
  else if (c.some((b: any) => b?.type === 'tool_result')) return null
  else if (!c.every((b: any) => b?.type === 'text' && typeof b.text === 'string')) return null
  else text = c.map((b: any) => b.text).join('\n')
  if (OUTPUT_TAG.test(text)) return null
  // A plain typed prompt carries origin human and promptSource typed. Without that, only the slash-command shape counts: the /ankur:inbox
  // rows on this machine's real transcripts have origin human and no promptSource, or no origin at all, and promptId is not always there.
  if (row.origin !== undefined && source === 'typed') return text
  return source === undefined || source === 'typed' ? (SLASH_SHAPE.test(text) ? text : null) : null
}

// Claude Code records the output of a bash-mode or local command, and an agent's return, as a user line; that text is not typed.
const OUTPUT_TAG = /<(bash-input|bash-stdout|bash-stderr|local-command-stdout|local-command-stderr|local-command-caveat|task-notification)>/
const SLASH_SHAPE = /^\s*(<command-message>[^<]*<\/command-message>\s*)?<command-name>\/(?:ankur|truss):inbox<\/command-name>\s*<command-args>[\s\S]*<\/command-args>\s*$/ // ankur-allow-truss

// What the client typed after the command name: the <command-args> text of a slash command, else the whole prompt without a leading /ankur:inbox.
function argsOf(text: string): string {
  const m = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)
  return (m === null ? text.replace(/^\s*\/(?:ankur|truss):inbox(?=\s)/, '') : m[1]).trim() // ankur-allow-truss
}

// The newest typed prompt of this session's main transcript, newer than the open op, holding the id, the code and the decision word right before the id.
// With a raise, the typed line is `<decision> <id> <code> raise <usd> [note]`: the amount is the one the client typed, not the agent's flag.
// The decision is the first word the client typed, directly before the id; the code is the token after it (see proof).
function typedProof(repo: string, session: string, open: Obj, decision: string, raiseUsd?: number): { quote: string; rest: string } | { missing: string; raiseTyped?: string } {
  const main = proofMain(session)
  if (main === null) return { missing: `no transcript of session ${session} under ${proofTranscriptRoot()}` }
  const scan = scanFile(main, session, new Set([String(open.id)]))
  const p = scan === null ? null : proof(repo, open, { decision, raiseUsd }, scan.cands.get(String(open.id)) ?? [], true)
  if (p !== null) return { quote: String(maskCode(p.text, open.id, open.codeHash)).slice(0, 1000), rest: p.rest }
  if (raiseUsd === undefined && scan !== null) {
    // the client typed a raise but the agent left out --raise-usd: the flag is the cause, not a missing prompt
    for (const k of scan.cands.get(String(open.id)) ?? []) {
      const t = argsOf(k.text).split(/\s+/)
      if (k.chain && t[0] === decision && t[1] === open.id && t[2] !== undefined && codeHashOf(open.id, t[2]) === open.codeHash && t[3] === 'raise' && /^\d+(\.\d+)?$/.test(t[4] ?? '')) {
        return { missing: '', raiseTyped: t[4] }
      }
    }
  }
  return { missing: '' }
}

// The client's newest typed reply in this session, when it proves a --reply resolve of `open` (see replyFails): its quote (the whole
// reply, the code masked, at most 1000 characters) and text; else why it does not.
// A budget approve with no --raise-usd takes the one amount that message proposed for the item.
function replyTypedProof(repo: string, session: string, open: Obj, decision: string, raiseUsd?: number): { quote: string; text: string; at: number; raiseUsd?: number } | { missing: string } {
  const main = proofMain(session)
  if (main === null) return { missing: `no transcript of session ${session} under ${proofTranscriptRoot()}` }
  const scan = replyScanFile(main, session, Date.parse(open.ts))
  if (scan === null) return { missing: `the transcript of session ${session} cannot be read` }
  let usd = raiseUsd
  const newest = newestReply(scan.replies, Infinity)
  if (usd === undefined && String(open.kind) === 'budget' && decision === 'approve' && newest !== null) {
    const amounts = shownAmounts(newest, open)
    if (amounts.length === 1) usd = amounts[0]
    else if (amounts.length > 1) return { missing: `the message that showed ${String(open.id)} proposes several amounts (${amounts.map((a) => `$${a}`).join(', ')}): pass --raise-usd with the one the client approved` }
  }
  const { k, why } = replyProof(repo, open, { decision, raiseUsd: usd }, scan.replies, Infinity)
  if (k !== null) return { quote: String(maskCode(k.text, open.id, open.codeHash)).slice(0, 1000), text: k.text, at: k.at, ...(usd === undefined ? {} : { raiseUsd: usd }) }
  return { missing: why }
}

// Why the action an approved item stood for has already run, so a correcting reply cannot undo it; '' when nothing ran. Applied
// (mark-applied, or a confirmed plan approval), the plan this dir's approval item approved, or the persona its approve installed.
function actionRan(repo: string, dir: string, it: Item, session: string): string {
  const id = String(it.open.id)
  if (it.applied.length > 0) return `the approved action already ran: ${id} was applied`
  const r = it.resolve
  if (r === null || r.decision !== 'approve') return ''
  const ref = String(it.open.ref ?? '')
  if (it.open.kind === 'client-trigger' && ref === 'run' && it.open.session === session) {
    try {
      const plan = JSON.parse(readFileSync(`${dir}/plan.json`, 'utf8'))
      if (plan !== null && typeof plan === 'object' && typeof plan.approvedAt === 'string') return `the approved action already ran: the plan ${id} approved is approved (${plan.approvedAt})`
    } catch {
      // no plan, or unreadable: nothing was approved through it
    }
  }
  const persona = /^persona:([A-Za-z0-9._-]+)$/.exec(ref)
  if (persona !== null) {
    try {
      if (statSync(`${repo}/.claude/agents/${persona[1]}.md`).mtimeMs >= Math.floor(Date.parse(String(r.ts)))) return `the approved action already ran: the persona ${persona[1]} is installed`
    } catch {
      // not installed
    }
  }
  return ''
}

/**
 * The typed client proof `approve --by client` needs: null when `item` is a client-trigger item of this session (`dir`) whose ref is
 * `run`, resolved approve by the client in this same session with a typed line that verifiedItems holds, and not superseded by a later
 * open row of the same kind, session and ref. Else the reason it does not count. Fails closed: a stored row alone proves nothing.
 */
export function approvalProof(repo: string, dir: string, item: string | undefined, approved = false): string | null {
  if (item === undefined || item === '') return 'approve --by client needs --item <item>: the client-trigger item for this plan, which the client approves by picking Approve on a question card that holds the item id and title (or, in a terminal, by typing /ankur:inbox approve <item> <code>)'
  const items = verifiedItems(repo)
  const it = items.get(item)
  if (it === undefined) return `no such item: ${item}`
  const session = sessionOf(dir)
  if (it.open.kind !== 'client-trigger') return `${item} is a ${String(it.open.kind)} item, not the client-trigger item that approves a plan`
  if (it.open.session !== session) return `${item} was opened for another ankur dir, not ${session}`
  const ref = it.open.ref
  if (ref !== 'run') return `${item} is for ${JSON.stringify(ref ?? null)}, not the run goal: only a run item approves a plan`
  let later = false
  for (const [id, o] of items) {
    if (id === item) later = true
    else if (later && o.open.kind === it.open.kind && o.open.session === it.open.session && o.open.ref === it.open.ref) return `${item} is superseded by ${id}`
  }
  const r = it.resolve
  if (r === null) return `no prompt typed or card answered by the client approves ${item}: ask them with a question card (AskUserQuestion) whose question holds ${item} and its title word for word, with exactly the options Approve and Reject, and resolve it with --card; or the client types /ankur:inbox approve ${item} <code>`
  if (r.by !== 'client' || r.decision !== 'approve') return `${item} was resolved ${String(r.decision)}, not approve`
  if (r.session !== session) return `${item} was approved in another session (${String(r.session)}), not ${session}: the client never saw this plan`
  // the client's approve must come after the plan was written: a resolve older than plan-write approved a plan the client never saw (replayed proof)
  if (approved) return null // approving rewrote plan.json, so its mtime is past the resolve; the staleness was checked when the plan was approved
  const wrote = [`${dir}/plan.md`, `${dir}/plan.json`].map((p) => { try { return statSync(p).mtimeMs } catch { return null } }).find((m) => m !== null)
  const at = Date.parse(String(r.ts))
  if (wrote === undefined || wrote === null || !(at >= Math.floor(wrote))) return `${item} was resolved before the current plan was written, so the client never approved this plan: open a new client-trigger item for it`
  return null
}

/**
 * The typed client proof a mid-run persona install needs: null when `item` is a client-question item of this session (`dir`) whose ref is
 * `persona:<name>`, resolved approve by the client in this same session with a typed line that verifiedItems holds, opened by this session, not superseded by a later
 * open row of the same kind and ref (any session), and resolved no earlier than the draft was written (`draftedMs`, its mtime: a yes for an older draft
 * is not a yes for this one). Else the reason it does not count. Fails closed: a stored row alone proves nothing.
 */
export function personaInstallProof(repo: string, dir: string, item: string | undefined, name: string, draftedMs: number): string | null {
  if (item === undefined || item === '') return `needs --item <item>: the client-question item persona:${name}`
  const items = verifiedItems(repo)
  const it = items.get(item)
  if (it === undefined) return `no such item: ${item}`
  const session = sessionOf(dir)
  if (it.open.kind !== 'client-question') return `${item} is a ${String(it.open.kind)} item, not the client-question item that approves a persona`
  // the item names this session's draft in its detail: another session's item shows the client another draft, so its yes is not a yes for this one
  if (it.open.session !== session) return `${item} was opened for another ankur dir, not ${session}: its draft is not this session's draft`
  if (it.open.ref !== `persona:${name}`) return `${item} is for ${JSON.stringify(it.open.ref ?? null)}, not persona:${name}`
  let later = false
  for (const [id, o] of items) {
    if (id === item) later = true
    else if (later && o.open.kind === it.open.kind && o.open.ref === it.open.ref) return `${item} is superseded by ${id}` // any session: the latest item for the draft holds the client's latest answer
  }
  const r = it.resolve
  if (r === null) return `no prompt typed or card answered by the client approves ${item}: ask them with a question card (AskUserQuestion) whose question holds ${item} and its title word for word, with exactly the options Approve and Reject, and resolve it with --card; or the client types /ankur:inbox approve ${item} <code>`
  if (r.by !== 'client' || r.decision !== 'approve') return `${item} was resolved ${String(r.decision)}, not approve`
  if (r.session !== session) return `${item} was approved in another session (${String(r.session)}), not ${session}: the client never saw this draft`
  const at = typedAtOf(r) ?? Date.parse(String(r.ts)) // the typed line's time, not the time the row was stored: a stored row can come long after the typing
  if (!(at >= Math.floor(draftedMs))) return `${item} was resolved before the draft ${name} was written, so the client never approved this draft: open a new client-question item for it`
  return null
}

/**
 * A plan the client's typed approve already approved (see onPlanApprove): the first `approve --by client --item <id>` with the same proof
 * confirms it, once, by marking the item applied for this session; any later call finds it applied and refuses. True when it confirmed.
 */
export function confirmApproval(repo: string, dir: string, item: string | undefined): boolean {
  if (approvalProof(repo, dir, item, true) !== null) return false
  const session = sessionOf(dir)
  const S = sharedDir(repo)
  let confirmed = false
  withLock(S, 'inbox', () => {
    const it = verifiedItems(repo).get(String(item))
    if (it === undefined || it.resolve === null || it.applied.includes(session)) return
    appendFileSync(`${S}/inbox.jsonl`, JSON.stringify({ v: 1, op: 'applied', id: item, ts: new Date().toISOString(), session }) + '\n')
    confirmed = true
  })
  return confirmed
}

// factory.ts registers the plan approval here (this module never imports factory.ts): called after a client's typed approve of a `run` item.
let planApprover: ((repo: string, dir: string, item: string) => Obj) | null = null
export function onPlanApprove(fn: (repo: string, dir: string, item: string) => Obj): void {
  planApprover = fn
}

/** --dir as factory.ts dirOf reads it: a relative one is a usage error, so sessionOf never sees a relative basename. */
export function absDirOf(d: string): string {
  if (!path.isAbsolute(d)) throw usage(`--dir must be an absolute path, got ${d}`)
  return d
}

function resolveItem(f: Flags): Obj {
  const repo = flat(need(f, 'repo'))
  const dir = absDirOf(need(f, 'dir'))
  const id = need(f, 'id')
  const decision = need(f, 'decision')
  const by = need(f, 'by')
  // --reply: the client answered in their own words, in a typed reply to a message that showed the item; no code is typed
  const reply = f.reply === true || f.reply === 'true'
  if (f.reply !== undefined && !reply) throw usage('--reply takes no value: put the item id first, as resolve <id> --reply ...')
  if (reply && by !== 'client') throw usage('--reply is for --by client')
  if (reply && f.code !== undefined) throw usage('--reply takes no --code: the reply proves the item without one')
  // --card: the client answered a question card (AskUserQuestion) that named the item; no code is typed
  const card = f.card === true || f.card === 'true'
  if (f.card !== undefined && !card) throw usage('--card takes no value: put the item id first, as resolve <id> --card ...')
  if (card && reply) throw usage('--card and --reply are two proofs: pass one')
  if (card && by !== 'client') throw usage('--card is for --by client')
  if (card && f.code !== undefined) throw usage('--card takes no --code: the card answer proves the item without one')
  const code = reply || card ? '' : need(f, 'code')
  if (!DECISIONS.includes(decision)) throw usage(`--decision must be one of ${DECISIONS.join(', ')}`)
  if (by !== 'client' && by !== 'pm') throw usage('--by must be client or pm')
  const noteGiven = textOf(f, 'note')
  const note = (noteGiven ?? '').slice(0, 4000)
  const rawRaise = str(f, 'raise-usd')
  let raiseUsd: number | undefined
  if (rawRaise !== undefined) {
    raiseUsd = Number(rawRaise)
    if (!Number.isFinite(raiseUsd) || raiseUsd <= 0) throw usage('--raise-usd must be a number above 0')
  }
  const session = sessionOf(dir)
  const S = sharedDir(repo)
  const file = `${S}/inbox.jsonl`
  let quote: string | null = null
  let firstCrew = 'main'
  let planItem = false as boolean
  let corrects: string | null = null
  let cardId: string | null = null
  withLock(S, 'inbox', () => {
    const it = verifiedItems(repo).get(id)
    if (it === undefined) throw refuse({ error: `no such item: ${id}` })
    // a reply-proved resolve can be corrected by a later reply to a later message that names the item, until its action runs
    const before = it.resolve
    if (before !== null && !(reply && before.proof === 'reply' && before.by === 'client' && typedAtOf(before) !== undefined)) throw refuse({ error: `${id} is already resolved` })
    if (before !== null) {
      const ran = actionRan(repo, dir, it, session)
      if (ran !== '') throw refuse({ error: `${id} cannot be corrected: ${ran}` })
      corrects = String(before.decision)
    }
    const kind = String(it.open.kind)
    planItem = kind === 'client-trigger' && it.open.ref === 'run' && it.open.session === session
    firstCrew = it.crews[0] ?? 'main'
    if (by === 'pm' && KINDS[kind]?.by !== 'any') throw refuse({ error: `${kind} is resolved by the client, not by pm` })
    if (by === 'pm' && KINDS[kind]?.evidence === true && note.trim() === '') throw refuse({ error: `a --by pm resolve of ${kind} needs its evidence in --note` })
    if (raiseUsd !== undefined && kind !== 'budget') throw refuse({ error: '--raise-usd is for the budget kind only' })
    if (reply) {
      const p = replyTypedProof(repo, session, it.open, decision, raiseUsd)
      if ('missing' in p) throw refuse({ error: `no reply typed by the client resolves ${id}: ${p.missing || 'no reply proves it'}. Show the client the item by its name in your message, and resolve it from the reply they type next; or ask with a question card that names ${id} and resolve it with --card` })
      // one typed reply resolves an item once: a correction needs a newer reply, to a newer message that names the item
      if (before !== null && !(p.at > (typedAtOf(before) as number))) throw refuse({ error: `${id} is already resolved from the client's reply ${JSON.stringify(String(before.quote ?? '').slice(0, 200))}: a correction needs a newer reply, to a message of yours that names ${id} again` })
      raiseUsd = p.raiseUsd
      // a note the agent passes must be the client's own words: a part of the reply
      if (noteGiven !== undefined && norm(note) !== '' && !norm(p.text).includes(norm(note))) throw refuse({ error: `--note is not part of what the client typed (${JSON.stringify(norm(p.text).slice(0, 200))}): pass a part of that text as the note, or none` })
      quote = p.quote
    } else if (card) {
      const main = proofMain(session)
      if (main === null) throw refuse({ error: `no card answered by the client resolves ${id}: no transcript of session ${session} under ${proofTranscriptRoot()}` })
      const scan = cardScanFile(main, session)
      if (scan === null) throw refuse({ error: `no card answered by the client resolves ${id}: the transcript of session ${session} cannot be read` })
      const p = cardProof(repo, it.open, { decision, raiseUsd }, scan.cards, Infinity)
      if ('why' in p) throw refuse({ error: `no card answered by the client resolves ${id}: ${p.why}. Ask the client with AskUserQuestion: a question that holds ${id} and its title word for word, with exactly the options Approve and Reject (Done and Dismiss for done or dismiss)` })
      raiseUsd = p.raiseUsd
      // a note the agent passes must be the client's own words: a part of the answer
      if (noteGiven !== undefined && norm(note) !== '' && !norm(p.answer).includes(norm(note))) throw refuse({ error: `--note is not part of the client's card answer (${JSON.stringify(norm(p.answer).slice(0, 200))}): pass a part of it as the note, or none` })
      cardId = p.card.id
      quote = cardQuote(p.q, p.answer)
    } else if (codeHashOf(id, code) !== it.open.codeHash) throw refuse({ error: 'wrong code' })
    if (by === 'client' && !reply && !card) {
      const p = typedProof(repo, session, it.open, decision, raiseUsd)
      if ('missing' in p) {
        if (p.raiseTyped !== undefined) throw refuse({ error: `the client typed raise ${p.raiseTyped} for ${id}: pass --raise-usd ${p.raiseTyped}, a resolve without it cannot stand for a typed raise` })
        const line = `${decision} ${id} <code>${raiseUsd === undefined ? '' : ` raise ${raiseUsd}`}`
        const cfg = process.env.CLAUDE_CONFIG_DIR // read for this message only, never as a root
        const why = p.missing !== '' && cfg && flat(path.join(cfg, 'projects')) !== proofTranscriptRoot() ? `; CLAUDE_CONFIG_DIR is set to ${flat(cfg)} but the proof reads transcripts only under ${proofTranscriptRoot()}` : ''
        throw refuse({ error: `no prompt typed by the client resolves ${id}: the client types this as a plain prompt in this session: ${line}${why}; or ask with a question card that names ${id} and resolve it with --card` })
      }
      // a note the agent passes is the client's typed words after the code, or empty when none were typed
      if (noteGiven !== undefined && norm(note) !== p.rest.slice(0, 4000)) throw refuse({ error: `--note differs from what the client typed after the code (${p.rest === '' ? 'nothing' : JSON.stringify(p.rest.slice(0, 200))}): pass that text as the note, or none` })
      quote = p.quote
    }
    const op: Obj = { v: 1, op: 'resolve', id, ts: new Date().toISOString(), session, decision, by, note, quote }
    if (raiseUsd !== undefined) op.raiseUsd = raiseUsd
    if (reply) op.proof = 'reply'
    if (card) {
      op.proof = 'card'
      op.card = cardId
    }
    appendFileSync(file, JSON.stringify(op) + '\n')
    // the resolving session may differ from the one that raised the item: its sidecar is under the open row's session
    const raised = String(it.open.session)
    if (SLUG_RE.test(raised)) {
      try {
        unlinkSync(codeFile(`${path.posix.dirname(S)}/${raised}`, id))
      } catch {
        // no sidecar, or it is already gone
      }
    }
  })
  event(dir, { event: 'resolve', crew: firstCrew, id, decision, by })
  const out: Obj = { id, state: 'resolved', decision, quote }
  if ((reply || card) && raiseUsd !== undefined) out.raiseUsd = raiseUsd // the amount the reply or card approved, read from what showed it
  if (corrects !== null) out.corrects = corrects // the decision this reply replaced
  // the client's typed approve of this dir's plan-approval item approves the plan itself, outside the inbox lock. A refusal
  // (open long-term cost, already approved) leaves the resolve standing and rides in the output.
  if (by === 'client' && decision === 'approve' && planItem && planApprover !== null) {
    try {
      out.approved = planApprover(repo, dir, id)
    } catch (e) {
      if (!(e instanceof CliError)) throw e
      out.approveRefused = e.body
    }
  }
  return out
}

function markApplied(f: Flags): Obj {
  const repo = flat(need(f, 'repo'))
  const id = need(f, 'id')
  const session = sessionOf(absDirOf(need(f, 'dir')))
  const S = sharedDir(repo)
  const file = `${S}/inbox.jsonl`
  withLock(S, 'inbox', () => {
    const it = verifiedItems(repo).get(id)
    if (it === undefined) throw refuse({ error: `no such item: ${id}` })
    if (it.resolve === null) throw refuse({ error: `${id} is not resolved` })
    if (it.applied.includes(session)) return
    appendFileSync(file, JSON.stringify({ v: 1, op: 'applied', id, ts: new Date().toISOString(), session }) + '\n')
  })
  return { id }
}

function listItems(f: Flags): Obj {
  const repo = flat(need(f, 'repo'))
  if (f['recover-codes'] === true) return recoverCodes(repo)
  const dirGiven = str(f, 'dir')
  const dirFlag = dirGiven === undefined || dirGiven === '' ? dirGiven : absDirOf(dirGiven)
  const sidFlag = f.unapplied === true ? str(f, 'session') : undefined
  const session = sidFlag ?? (dirFlag === undefined ? null : sessionOf(dirFlag))
  const kind = str(f, 'kind')
  const crew = str(f, 'crew')
  const all = verifiedItems(repo)
  const items: Obj[] = []
  let open = 0
  for (const [id, it] of all) {
    const state = it.resolve === null ? 'open' : 'resolved'
    if (state === 'open') open++
    const applied = session === null ? it.applied.length > 0 : it.applied.includes(session)
    if (f.open === true && state !== 'open') continue
    if (f.unapplied === true && (state !== 'resolved' || applied)) continue
    if (sidFlag !== undefined && it.open.session !== sidFlag) continue
    if (kind !== undefined && it.open.kind !== kind) continue
    if (crew !== undefined && !it.crews.includes(crew)) continue
    const row: Obj = { id, ts: it.open.ts, kind: it.open.kind, session: it.open.session, crews: it.crews, ref: it.open.ref ?? null, blocking: it.blocking, title: it.open.title, state }
    for (const k of ['risk', 'onYes', 'onNo']) if (it.open[k] !== undefined) row[k] = it.open[k]
    if (it.resolve !== null) {
      row.decision = it.resolve.decision
      row.by = it.resolve.by
      row.note = it.resolve.note
      row.quote = maskCode(it.resolve.quote ?? null, id, it.open.codeHash)
      if (it.resolve.raiseUsd !== undefined) row.raiseUsd = it.resolve.raiseUsd
      if (it.resolve.proof === 'card') row.proof = 'card' // its quote is the card's question and answer, not a typed prompt
      if (it.noteUnbound === true) row.noteUnbound = true
    } else if (it.reopened !== undefined) row.reopened = it.reopened
    row.applied = applied
    items.push(row)
  }
  return { items, open }
}

// The surviving codes of open items, from the escalate sidecars of every session dir under <common>/ankur/. A code alone lifts nothing:
// a resolve still needs the typed line.
function recoverCodes(repo: string): Obj {
  const items = verifiedItems(repo)
  const root = path.posix.dirname(sharedDir(repo))
  const codes: Obj[] = []
  let sessions: string[] = []
  try {
    sessions = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'shared').map((d) => d.name).sort()
  } catch {
    // no session dirs yet
  }
  for (const session of sessions) {
    let names: string[] = []
    try {
      names = readdirSync(`${root}/${session}`).filter((n) => /^escalate-code-[A-Za-z0-9._-]+\.json$/.test(n)).sort()
    } catch {
      continue
    }
    for (const name of names) {
      try {
        const j = JSON.parse(readFileSync(`${root}/${session}/${name}`, 'utf8'))
        const it = items.get(j?.id)
        if (it !== undefined && it.resolve === null && typeof j.code === 'string' && codeHashOf(j.id, j.code) === it.open.codeHash) codes.push({ id: j.id, code: j.code, session })
      } catch {
        // a torn or foreign file is not a code
      }
    }
  }
  return { codes }
}

const textOf = (f: Flags, key: string): string | undefined => {
  const file = str(f, `${key}-file`)
  if (file !== undefined) return readText(file).replace(/\s+$/, '')
  return str(f, key)
}

export const INBOX_COMMANDS: Record<string, (f: Flags) => Obj> = {
  escalate: (f) => {
    const kind = need(f, 'kind')
    const title = textOf(f, 'title')
    if (title === undefined || title === '') throw usage('missing --title or --title-file')
    const ref = str(f, 'ref')
    const out = escalate(flat(need(f, 'repo')), absDirOf(need(f, 'dir')), { kind, title, detail: textOf(f, 'detail'), crews: listOf(f, 'crew'), ref: ref === undefined ? null : ref, blocking: f.blocking === true || f.blocking === 'true', risk: textOf(f, 'risk'), onYes: textOf(f, 'on-yes'), onNo: textOf(f, 'on-no') })
    const body: Obj = { id: out.id, kind: out.kind, deduped: out.deduped }
    body.code = out.deduped ? null : out.code
    body.message = out.deduped ? null : (out.message ?? null)
    body.notified = out.notified
    if (out.notifyError !== undefined) body.notifyError = out.notifyError
    return body
  },
  inbox: listItems,
  resolve: resolveItem,
  'mark-applied': markApplied,
}
