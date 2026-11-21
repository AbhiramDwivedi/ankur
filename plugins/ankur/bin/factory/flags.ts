// The CLI flags bin/factory.ts handles itself around a command (0.33.0, moved from bin/factory.ts): --status-line, --reap-first.
// This module imports no command module statically, so factory.ts can load it before it reads the command name; reapFirst loads
// reap.ts with a lazy import() only when its flag is present. Never imports factory.ts, whose top-level await would make an import cycle.
import { readFileSync } from 'node:fs'
import { CliError, isObj } from '../core.ts'
import type { Obj } from '../core.ts'
import { parseFlags } from './cli.ts'

// The `ankur-status: <short JSON>` line `--status-line` adds after the result. It holds only the
// booleans ok, merged and admitted, head as a string, env cut to 200 characters, ran from heavy.ran, and pending (with ageMs and
// budgetMs) from heavy.
export function statusLine(body: Obj): string {
  const s: Obj = {}
  for (const k of ['ok', 'merged', 'admitted', 'checkpoint']) if (typeof body[k] === 'boolean') s[k] = body[k]
  if (typeof body.head === 'string') s.head = body.head
  if (typeof body.env === 'string') s.env = body.env.slice(0, 200)
  if (isObj(body.heavy) && typeof body.heavy.ran === 'boolean') s.ran = body.heavy.ran
  // 0.31.0 item 2: a heavy run still going in the background, which the same line collects when run again
  // with the job's age and give-up budget (heavyMain), which stage.js polls against
  if (isObj(body.heavy) && body.heavy.pending === true) {
    s.pending = true
    for (const k of ['ageMs', 'budgetMs']) if (typeof body.heavy[k] === 'number') s[k] = body.heavy[k]
    // again: a waiter may attach once more (ageMs < budgetMs)
    if (typeof body.heavy.again === 'boolean') s.again = body.heavy.again
  }
  // A gates result also carries each step's met and the step that stopped it
  if (isObj(body.gates)) {
    s.gates = Object.fromEntries(Object.entries(body.gates).filter(([, v]) => typeof v === 'boolean'))
    s.stopped = typeof body.stopped === 'string' ? body.stopped : null
  }
  return `ankur-status: ${JSON.stringify(s)}`
}
// Takes the boolean --status-line flag out of argv (for heavy, only before its `--`, so the command after it is untouched).
export function takeStatusFlag(argv: string[]): { on: boolean; argv: string[] } {
  const cut = argv.indexOf('--')
  const head = cut < 0 ? argv : argv.slice(0, cut)
  const rest = cut < 0 ? [] : argv.slice(cut)
  return { on: head.includes('--status-line'), argv: [...head.filter((a) => a !== '--status-line'), ...rest] }
}
// `--reap-first <slug>` reaps that crew's `<slug>-check` process groups (as `reap --slug <slug> --label
// <slug>-check`) before the command runs, so stage.js folds the reap after a member into its next factory call instead of
// spending a runner spawn on it. For heavy it is taken only before the `--`. Only a failed reap rides on the body (as reapedFirst), so the command's own output is unchanged.
export function takeReapFlag(argv: string[]): { slug: string | null; argv: string[] } {
  const cut = argv.indexOf('--')
  const i = argv.indexOf('--reap-first')
  if (i < 0 || (cut >= 0 && i > cut)) return { slug: null, argv }
  return { slug: argv[i + 1] ?? '', argv: [...argv.slice(0, i), ...argv.slice(i + 2)] }
}
// `--admit-first <slug>` (see takeAdmitFlag and admitFirst in admit.ts, which do the work). admit.ts loads only when the
// flag is present before the `--`, so a command without it never loads admit.ts.
export async function takeAdmitFlag(argv: string[]): Promise<{ admit: Obj | null; argv: string[] }> {
  const cut = argv.indexOf('--')
  if (!(cut < 0 ? argv : argv.slice(0, cut)).includes('--admit-first')) return { admit: null, argv }
  return (await import('./admit.ts')).takeAdmitFlag(argv)
}
// 0.34.0 (fixtures/runner-folds-034/folds.json): the fold riders. A rider flag names a second factory step that
// the dispatcher runs in the same process, so the stage spends one runner call on a pair. A `first` rider runs before the carrying command
// and its body goes under `<step>First`; an `after` rider runs after it, only where the unfolded stage would run the second call, and its body
// goes under `<step>After`. Mechanical: no judgement, no retry. Steps run through main (passed in, as gatesRun takes it), so a rider loads
// only its own module and the step prints what it prints alone.
type Rider = { step: string; position: 'first' | 'after'; key: string; value: string; extra: Record<string, string> }
const RIDER_FLAGS: Record<string, { step: string; position: 'first' | 'after'; key: string }> = {
  '--crew-learned-first': { step: 'crew-learned', position: 'first', key: 'crewLearnedFirst' },
  '--decisions-first': { step: 'decisions', position: 'first', key: 'decisionsFirst' },
  '--tests-check-after': { step: 'tests-check', position: 'after', key: 'testsCheckAfter' },
  '--knowledge-commit-after': { step: 'knowledge-commit', position: 'after', key: 'knowledgeCommitAfter' },
  '--admit-after': { step: 'admit', position: 'after', key: 'admitAfter' },
  '--inbox-after': { step: 'inbox', position: 'after', key: 'inboxAfter' }
}
// the flags that go with a rider flag and are taken off argv with it
const RIDER_COMPANIONS: Record<string, string[]> = { 'admit': ['--admit-label', '--admit-title', '--admit-persona'], 'knowledge-commit': ['--knowledge-base'] }
export function takeRiderFlags(argv: string[]): { riders: Rider[]; argv: string[] } {
  const cut = argv.indexOf('--')
  const head = cut < 0 ? argv : argv.slice(0, cut)
  const rest = cut < 0 ? [] : argv.slice(cut)
  const riders: Rider[] = []
  if (!head.some((a) => Object.hasOwn(RIDER_FLAGS, a.split('=')[0] as string))) return { riders, argv }
  const present = new Set(head.map((a) => a.split('=')[0] as string))
  const vals: Record<string, string> = {}
  let high = false
  const kept: string[] = []
  // a companion is taken only when its own rider flag is present, so --admit-label stays for --admit-first otherwise
  const companions = Object.entries(RIDER_COMPANIONS).filter(([step]) => present.has(`--${step}-after`)).flatMap(([, v]) => v)
  for (let i = 0; i < head.length; i++) {
    const a = head[i] as string
    const eq = a.indexOf('=')
    const name = eq < 0 ? a : a.slice(0, eq)
    const val = (): string => (eq < 0 ? (head[++i] ?? '') : a.slice(eq + 1))
    // a second inbox rider on one call (the two reads of a resumed crew) prints its body under inboxAfter2
    if (Object.hasOwn(RIDER_FLAGS, name)) riders.push({ ...(RIDER_FLAGS[name] as (typeof RIDER_FLAGS)[string]), ...(name === '--inbox-after' && riders.some((o) => o.step === 'inbox') ? { key: 'inboxAfter2' } : {}), value: val(), extra: {} })
    else if (name === '--admit-high' && present.has('--admit-after')) high = true
    else if (companions.includes(name)) vals[name] = val()
    else kept.push(a)
  }
  for (const r of riders) {
    for (const c of RIDER_COMPANIONS[r.step] ?? []) if (vals[c] !== undefined) r.extra[c.slice(r.step === 'admit' ? 8 : 2)] = vals[c] as string
    if (r.step === 'admit' && high) r.extra.high = ''
  }
  return { riders, argv: [...kept, ...rest] }
}
type Main = (argv: string[]) => Promise<{ body: Obj; code: number }>
// the step's own command line, from the carrier's --dir and --repo and the rider's value
function riderArgv(r: Rider, carrier: string[], body: Obj | null): string[] {
  const cut = carrier.indexOf('--')
  const f = parseFlags((cut < 0 ? carrier : carrier.slice(0, cut)).slice(1))
  const common = ['--dir', String(f.dir ?? ''), '--repo', String(f.repo ?? '')]
  const crew = String(f.slug ?? f.crew ?? '')
  if (r.step === 'crew-learned') return ['crew-learned', ...common, '--slug', crew, '--add', r.value]
  if (r.step === 'decisions') return ['decisions', ...common, '--crew', r.value]
  if (r.step === 'tests-check') return ['tests-check', ...common, '--slug', r.value]
  if (r.step === 'knowledge-commit') return ['knowledge-commit', ...common, '--slug', crew, '--sha', r.value, '--base', r.extra['knowledge-base'] ?? '', '--head', String(body?.head ?? '')]
  if (r.step === 'inbox') return ['inbox', ...common, '--crew', String(f.crew ?? f.slug ?? ''), '--kind', r.value]
  return ['admit', ...common, '--slug', r.value, ...(r.extra.label !== undefined ? ['--label', r.extra.label] : []), ...(r.extra.title !== undefined ? ['--title', r.extra.title] : []), ...(r.extra.persona !== undefined ? ['--persona', r.extra.persona] : []), ...(r.extra.high !== undefined ? ['--high'] : [])]
}
async function runRider(r: Rider, carrier: string[], body: Obj | null, main: Main): Promise<Obj> {
  try {
    return (await main(riderArgv(r, carrier, body))).body
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
// the carrier's met key, as the unfolded stage reads it
function carrierMet(command: string | undefined, body: Obj, code: number): boolean {
  if (command === 'integrate' || command === 'sync') return body.merged === true
  if (command === 'admit') return body.admitted === true
  if (command === 'decision-checkpoint') return body.checkpoint === true
  if (command === 'tests-check') return body.ok === true
  return code === 0 && body.ok !== false && !(isObj(body.heavy) && body.heavy.pending === true)
}
// each `first` rider runs before the carrier whatever it prints (the unfolded stage logs its failure and goes on)
export async function runRidersFirst(riders: Rider[], carrier: string[], main: Main): Promise<Obj> {
  const out: Obj = {}
  for (const r of riders) if (r.position === 'first') out[r.key] = await runRider(r, carrier, null, main)
  return out
}
// each `after` rider runs after a carrier that met its key and adds its body under its own key. The one exception is the inbox read after
// a decision-checkpoint: the unfolded stage reads the inbox after an unconfirmed checkpoint too, so that rider runs whatever it returned.
// An admit that follows an inbox read runs only while no read of that call shows an open item: an open item of the crew stops the
// stage before any admit, so the stage makes its own admit call (or stops) and the admit never runs where the unfolded stage would not.
// The test is wider than the crew: `open` counts every open item in the repo before any kind or crew filter, so any open item voids the fold.
const openItems = (b: unknown): boolean => isObj(b) && ((Array.isArray(b.items) && b.items.some((i) => isObj(i) && i.state === 'open')) || (typeof b.open === 'number' && b.open > 0))
export async function runRidersAfter(riders: Rider[], carrier: string[], body: Obj, code: number, main: Main): Promise<void> {
  const met = carrierMet(carrier[0], body, code)
  for (const r of riders) {
    if (r.position !== 'after' || !(met || (carrier[0] === 'decision-checkpoint' && r.step === 'inbox'))) continue
    const reads = [carrier[0] === 'inbox' ? body : null, ...riders.filter((o) => o.step === 'inbox').map((o) => body[o.key])]
    if (r.step === 'admit' && reads.some(openItems)) continue
    body[r.key] = await runRider(r, carrier, body, main)
  }
}
// a key a plugin module's own command table (INBOX_COMMANDS, COST_COMMANDS, QUEUE_COMMANDS, WORKTYPE_COMMANDS) gains that a core
// command already has. main refuses it; it is read from the module's source text and the module is never loaded, so a core command still
// loads only its own module. A table body ends at its first line that starts with `}`.
const PLUGIN_TABLES: Record<string, string> = { 'inbox.ts': 'INBOX_COMMANDS', 'cost.ts': 'COST_COMMANDS', 'queue.ts': 'QUEUE_COMMANDS', 'worktypes.ts': 'WORKTYPE_COMMANDS' }
export function shadowedByTables(coreKeys: string[]): string[] {
  const out: string[] = []
  for (const [file, table] of Object.entries(PLUGIN_TABLES)) {
    try {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      const at = src.indexOf(`export const ${table}`)
      if (at < 0) continue
      const body = src.slice(at).split(/\n\}/)[0] as string
      // keys on their own lines, and keys on the declaration's own line (a table written on one line)
      const first = body.slice(body.indexOf('=')).split('\n')[0] as string
      for (const m of [...body.matchAll(/^ {2}(?:'([\w-]+)'|([\w$]+))\s*[:,]/gm), ...first.matchAll(/[{,]\s*(?:'([\w-]+)'|([\w$]+))\s*[:(]/g)]) {
        const k = (m[1] ?? m[2]) as string
        if (coreKeys.includes(k) && !out.includes(k)) out.push(k)
      }
    } catch {
      // a module that cannot be read has no key to shadow
    }
  }
  return out
}
export async function admitFirst(argv: string[], admit: Obj): Promise<Obj> {
  return (await import('./admit.ts')).admitFirst(argv, admit)
}
export async function reapFirst(argv: string[], slug: string): Promise<Obj> {
  try {
    const cut = argv.indexOf('--')
    const f = parseFlags((cut < 0 ? argv : argv.slice(0, cut)).slice(1))
    const { cmdReap } = await import('./reap.ts')
    return cmdReap({ ...f, slug, label: `${slug}-check` })
  } catch (e) {
    return { error: e instanceof CliError ? JSON.stringify(e.body) : e instanceof Error ? e.message : String(e) }
  }
}
