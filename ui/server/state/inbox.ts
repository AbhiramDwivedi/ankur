// ui-state inbox side: the open items of <run root>/shared/inbox.jsonl whose open row's `session` is the
// basename of the run dir. An item is open when no `resolve` row names its id. Read-only; the plugin's transcript proof
// (verifiedItems) is not re-run. The fold is a copy of `fold` in plugins/ankur/bin/inbox.ts (ui/ never imports plugin code).
// Node built-ins only; erasable TypeScript.
import fs from 'node:fs'
import path from 'node:path'

export interface Inbox {
  open: number
  items: { id: string; title: string; kind: string }[]
}

export function createInboxReader(): (dir: string | null) => Inbox | null {
  let last: { key: string; value: Inbox } | null = null
  return (dir) => {
    if (dir === null) return null
    const file = path.join(path.dirname(dir), 'shared', 'inbox.jsonl')
    let sig = '-'
    try {
      const s = fs.statSync(file)
      sig = `${s.size}:${s.mtimeMs}`
    } catch {
      // no inbox yet: nothing is open
    }
    const key = `${dir}|${sig}`
    if (last !== null && last.key === key) return last.value
    const session = path.basename(dir)
    const opened = new Map<string, Record<string, unknown>>()
    const resolved = new Set<string>()
    if (sig !== '-') {
      let text = ''
      try {
        text = fs.readFileSync(file, 'utf8')
      } catch {
        // unreadable this poll: an empty read, retried when the signature changes
      }
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        let r: unknown
        try {
          r = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof r !== 'object' || r === null || Array.isArray(r)) continue
        const o = r as Record<string, unknown>
        if (typeof o.id !== 'string') continue
        if (o.op === 'open') {
          if (!opened.has(o.id)) opened.set(o.id, o)
        } else if (o.op === 'resolve' && opened.has(o.id)) resolved.add(o.id)
      }
    }
    const items: Inbox['items'] = []
    for (const [id, o] of opened) {
      if (resolved.has(id) || o.session !== session) continue
      items.push({ id, title: typeof o.title === 'string' ? o.title : '', kind: typeof o.kind === 'string' && o.kind !== '' ? o.kind : 'decision' })
    }
    const value = { open: items.length, items }
    last = { key, value }
    return value
  }
}
