// rule-quote: tells the QC step whether a quote is a written rule: a whole numbered item under a Principles heading of the
// architecture doc or under ## Standards of a persona file, or whole sentences of one item. The files are read from the crew's
// worktree on disk. The matching is a pure function, so the stage holds no second copy of it.
import { readdirSync, readFileSync } from 'node:fs'
import { CliError, flat, isObj, listOf, need, readJson, usage } from '../core.ts'
import type { Flags } from '../core.ts'
import { archPath, crewWorktree, dirOf, repoOf } from './cli.ts'
import { loadPlan } from './plan-file.ts'

export type RuleMatch = { match: boolean; item: string | null }

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

// The numbered items under every heading whose text starts with `title`, each collapsed to one line without its "N. " prefix.
// A section ends at the next heading of the same or a shallower depth.
export function numberedItemsUnder(text: string, title: string): string[] {
  const start = new RegExp(`^${title}`, 'i')
  const items: string[] = []
  let depth = 0
  let cur: number | null = null
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h !== null) {
      cur = null
      if (depth > 0 && h[1].length <= depth) depth = 0
      if (depth === 0 && start.test(h[2].trim())) depth = h[1].length
      continue
    }
    if (depth === 0) continue
    const n = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (n !== null) {
      cur = items.length
      items.push(n[1])
    } else if (line.trim() === '') cur = null
    else if (cur !== null) items[cur] += ` ${line}`
  }
  return items.map(collapse)
}

// Pure: the quote, whitespace collapsed, equals a whole item or one or more whole sentences of one item in a row.
// Returns the matching item (collapsed) or null.
export function matchRule(quote: string, items: string[]): RuleMatch {
  const q = collapse(quote)
  if (q === '') return { match: false, item: null }
  for (const item of items) {
    if (item === q) return { match: true, item }
    const parts = item.split(/(?<=[.!?])\s+/)
    for (let i = 0; i < parts.length; i++) {
      let s = parts[i]
      if (s === q) return { match: true, item }
      for (let j = i + 1; j < parts.length; j++) {
        s = `${s} ${parts[j]}`
        if (s === q) return { match: true, item }
      }
    }
  }
  return { match: false, item: null }
}

// The command: node factory.ts rule-quote --dir D --repo R --slug S --quote TEXT [--file REPO-RELATIVE-PATH]...
// With one or more --file arguments only those files are read, each for the heading it has (Principles, Standards); with none, the
// architecture doc and every persona file under .claude/agents are read.
export type RuleQuoteResult = { ok: true; match: boolean; file: string | null; item: string | null; skipped: string[] }
export async function cmdRuleQuote(f: Flags): Promise<RuleQuoteResult> {
  const dir = dirOf(f)
  const repo = repoOf(f)
  const slug = need(f, 'slug')
  const quoteFlag = f.quote
  if (typeof quoteFlag !== 'string' || collapse(quoteFlag) === '') throw new CliError(2, { ok: false, error: 'missing --quote' })
  const plan = loadPlan(dir)
  if (!plan.crews.some((c: unknown) => isObj(c) && c.slug === slug)) throw new CliError(2, { ok: false, error: `unknown slug ${slug}` })
  const tree = crewWorktree(repo, slug)
  const skipped: string[] = []
  const sources: { file: string; headings: string[] }[] = []
  const named = listOf(f, 'file')
  if (named.length > 0) {
    for (const rel of named) sources.push({ file: flat(`${tree}/${rel}`), headings: ['Principles', 'Standards'] })
  } else {
    let archRel = 'docs/architecture.md'
    try {
      const cfg = readJson(`${tree}/.claude/ankur.json`)
      if (isObj(cfg) && typeof cfg.architecture === 'string' && cfg.architecture !== '') archRel = cfg.architecture
    } catch (err) {
      skipped.push(`.claude/ankur.json: ${(err as Error).message}`)
    }
    sources.push({ file: flat(archPath(tree, archRel)), headings: ['Principles'] })
    try {
      for (const name of readdirSync(`${tree}/.claude/agents`).sort()) if (name.endsWith('.md')) sources.push({ file: `${tree}/.claude/agents/${name}`, headings: ['Standards'] })
    } catch (err) {
      skipped.push(`.claude/agents: ${(err as Error).message}`)
    }
  }
  for (const s of sources) {
    let text: string
    try {
      text = readFileSync(s.file, 'utf8')
    } catch (err) {
      skipped.push(`${s.file.startsWith(`${tree}/`) ? s.file.slice(tree.length + 1) : s.file}: ${(err as Error).message}`)
      continue
    }
    const r = matchRule(quoteFlag, s.headings.flatMap((h) => numberedItemsUnder(text, h)))
    if (r.match) return { ok: true, match: true, file: s.file.startsWith(`${tree}/`) ? s.file.slice(tree.length + 1) : s.file, item: r.item, skipped }
  }
  return { ok: true, match: false, file: null, item: null, skipped }
}
