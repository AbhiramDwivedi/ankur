// Words of the resume panel. No imports: runs under plain `node --test`.

export const TWO_WRITERS =
  'Two writers diverge: if this session is also open in a terminal, whatever each side says next is not seen by the other. Close the terminal one first.'

export const NO_PROMPT = 'No prompt recorded'

/** The refusal of POST /resume, in words. */
export function resumeErrorWords(error: string): string {
  if (error === 'busy') return 'This workspace already has a session going. Stop it first, then resume.'
  if (error === 'session') return 'That session is no longer in this repository. The list below is refreshed.'
  if (error === 'transcript') return 'That session has no conversation on disk, so there is nothing to resume.'
  if (error === 'live') return 'Another Claude Code process holds that session right now.'
  if (error === 'timeout' || error === 'network') return 'The server did not answer. Try again.'
  return `Could not resume (${error}).`
}

export const shortId = (id: string): string => id.slice(0, 8)

/** `title` of a row's time: the full ISO stamp. The text itself is the browser's local time. */
export function whenWords(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'unknown time' : d.toLocaleString()
}
