// brief-rules: prints the SHELL, FOREGROUND, REFUSAL and PKILL block the stage prompts carry, for a hand-written worktree brief to paste.
// The one source is the const literals in the built stage bundle, so a hand-written brief never drifts from a stage prompt.
// The dispatcher prints `text` as it is, with no JSON framing (an exception to the one-JSON-line rule that this command alone has).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CliError } from '../core.ts'
import type { Flags } from '../core.ts'

export const BRIEF_RULE_NAMES = ['SHELL', 'FOREGROUND', 'REFUSAL', 'PKILL']

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r' }

// The value of a single- or double-quoted string literal that holds no template substitution.
function unquote(lit: string, name: string): string {
  const q = lit[0]
  if ((q !== '"' && q !== "'") || lit[lit.length - 1] !== q || lit.length < 2) throw new CliError(1, { ok: false, error: `brief-rules: const ${name} in the stage bundle is not a plain string literal` })
  return lit.slice(1, -1).replace(/\\(.)/g, (_m, c: string) => ESCAPES[c] ?? c)
}

// Pure: the block for the source text of the bundle.
export function briefRulesText(bundle: string): string {
  const parts = BRIEF_RULE_NAMES.map((name) => {
    const m = new RegExp(`^const ${name}\\s*=\\s*(.+)$`, 'm').exec(bundle)
    if (m === null) throw new CliError(1, { ok: false, error: `brief-rules: const ${name} not found in the stage bundle` })
    return unquote((m[1] as string).trim(), name)
  })
  return parts.join('\n\n') + '\n'
}

// The command: node factory.ts brief-rules
export async function cmdBriefRules(_f: Flags): Promise<{ ok: true; text: string }> {
  const file = fileURLToPath(new URL('../../workflows/' + 'stage' + '.js', import.meta.url))
  let bundle: string
  try {
    bundle = readFileSync(file, 'utf8')
  } catch (err) {
    throw new CliError(1, { ok: false, error: `brief-rules: cannot read the stage bundle: ${(err as Error).message}` })
  }
  return { ok: true, text: briefRulesText(bundle) }
}
