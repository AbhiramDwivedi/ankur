// Leaf module: the one rule for "a base rule file changed only in its bookkeeping". owns-check (crew.ts knowledgeDocs) and
// knowledge-commit (decisions.ts) both use it, so the workflow's knowledge step and the owns gate never disagree.
import { run } from './cli.ts'

// the YAML frontmatter block of a markdown text (fences included), or '' when it has none
export function frontmatter(text: string): string {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return ''
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  return (end < 0 ? lines : lines.slice(0, end + 1)).join('\n')
}

// a frontmatter without its `verified` stamp and `sources` list (an indented line under `sources:` belongs to it); a frontmatter
// left with only its fences counts as none
export function withoutBookkeeping(fm: string): string {
  let skip = false
  const rest = fm.split('\n').filter((l) => {
    if (/^\S/.test(l)) skip = /^(verified|sources)\s*:/.test(l)
    return !skip
  })
  return rest.every((l) => l.trim() === '---' || l.trim() === '') ? '' : rest.join('\n')
}

function contentAt(cwd: string, rev: string, file: string): string {
  const r = run(cwd, ['show', `${rev}:${file}`])
  return r.status === 0 ? r.out : ''
}

// The crew's own stamp fragment: exactly `<rulesDir>.d/<area>/<slug>.md` (one area segment of [A-Za-z0-9._-], not . or .., the
// crew's slug matched case-sensitively) whose text is only a frontmatter of `sources` and `verified` keys and no body. Any
// committer may write it: it carries no rule text, and stitchDoc merges it into the rule's own frontmatter.
export function ownStampFragment(file: string, text: string, rulesDir: string, slug: string): boolean {
  const rd = rulesDir.replace(/\/+$/, '')
  if (!file.startsWith(`${rd}.d/`) || slug === '' || !/^[A-Za-z0-9._-]+$/.test(slug)) return false
  const rest = file.slice(rd.length + 3).split('/')
  const [area = '', name = ''] = rest
  if (rest.length !== 2 || !/^[A-Za-z0-9._-]+$/.test(area) || area === '.' || area === '..' || name !== `${slug}.md`) return false
  const fm = frontmatter(text)
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const body = clean.slice(fm.length)
  return fm !== '' && withoutBookkeeping(fm) === '' && body.trim() === '' && /^\s*sources\s*:|^\s*verified\s*:/m.test(fm)
}

// A base rule file (under rulesDir itself, not a fragment) that exists at `base` and whose change to `head` touches only the
// `verified` and `sources` frontmatter keys: bookkeeping, not rule text. The body and every other key must be unchanged.
export function ruleBookkeepingOnly(cwd: string, base: string, head: string, file: string, rulesDir: string): boolean {
  if (!file.startsWith(`${rulesDir}/`)) return false
  const was = contentAt(cwd, base, file)
  const now = contentAt(cwd, head, file)
  const bodyOf = (t: string): string => t.slice(frontmatter(t).length)
  return was !== '' && withoutBookkeeping(frontmatter(was)) === withoutBookkeeping(frontmatter(now)) && bodyOf(was) === bodyOf(now)
}
