// The static-check command: the project's own lint, type and format commands (the `staticChecks` key of .claude/ankur.json) run on
// a crew's head, and a failing one again on the merge base, so only a failure the crew caused fails the gate. Never imports
// factory.ts, whose top-level await would make an import cycle.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { CliError, flat, isObj, refuse, str, usage } from '../core.ts'
import type { Flags, Obj } from '../core.ts'
import { LIST_CAP } from '../knowledge.ts'
import { bashRun, cannotStart, envFailure, installMissingDeps } from './check.ts'
import { crewWorktree, repoOf, run } from './cli.ts'
import { SLUG } from './plan.ts'
import { settingsFor } from './settings.ts'

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
type Check = { name: string; run: string }
type Line = { raw: string; norm: string }
type Result = { exit: number; text: string }

// a result the command could not judge: exit 2 with ok false, so the gate reads it as unmet
const fail = (message: string): CliError => new CliError(2, { ok: false, error: message })

// the merge base of the crew head and the target: the list of checks is read there, so a crew cannot change its own gate
function mergeBaseOf(f: Flags, repo: string, at: string, slug: string): string {
  let target = ''
  try {
    target = settingsFor(f, repo).target
  } catch (e) {
    if (!(e instanceof CliError)) throw e
    throw fail(`no merge base for crew ${slug}: the target could not be read: ${e.message}`)
  }
  const mb = target === '' || target.startsWith('-') ? undefined : run(at, ['-c', 'core.quotepath=off', 'merge-base', target, 'HEAD'])
  if (mb === undefined || mb.status !== 0 || mb.out === '') throw fail(`no merge base for crew ${slug}: ${mb === undefined ? `no usable target (${target === '' ? 'none set' : JSON.stringify(target)})` : `git merge-base ${target} HEAD failed in ${at}${mb.err === '' ? '' : `: ${mb.err.split('\n')[0]}`}`}`)
  return mb.out
}

// .claude/ankur.json as the merge base has it: {} when the base has no such file; an unreadable or invalid one is a named error, never an empty list
function baseConfigOf(at: string, base: string): Obj {
  const spec = '.claude/ankur.json'
  const has = run(at, ['-c', 'core.quotepath=off', 'ls-tree', '--name-only', base, '--', spec])
  if (has.status !== 0) throw fail(`cannot read ${spec} at the merge base ${base}: ${has.err.split('\n')[0]}`)
  if (has.out === '') return {}
  const shown = run(at, ['-c', 'core.quotepath=off', 'show', `${base}:${spec}`])
  if (shown.status !== 0) throw fail(`cannot read ${spec} at the merge base ${base}: ${shown.err.split('\n')[0]}`)
  let v: unknown
  try {
    v = JSON.parse(shown.out)
  } catch (e) {
    throw fail(`${spec} at the merge base ${base} is not valid JSON: ${(e as Error).message}`)
  }
  if (!isObj(v)) throw fail(`${spec} at the merge base ${base} is not a JSON object`)
  return v
}

// the configured list, or undefined when the key is missing or empty; a value the config schema would reject is a usage error
function checksOf(cfg: Obj): Check[] | undefined {
  const v = cfg.staticChecks
  if (v === undefined) return undefined
  if (!Array.isArray(v)) throw fail('staticChecks in .claude/ankur.json is not a list')
  const seen = new Set<string>()
  const out: Check[] = []
  v.forEach((e: unknown, i: number) => {
    const where = `staticChecks[${i}]`
    if (!isObj(e)) throw fail(`${where} is not an object with a name and a run`)
    const extra = Object.keys(e).filter((k) => k !== 'name' && k !== 'run')
    if (extra.length > 0) throw fail(`${where} has an unknown property: ${extra.join(', ')}`)
    if (typeof e.name !== 'string' || !NAME.test(e.name)) throw fail(`${where}.name must match ${NAME.source}`)
    if (typeof e.run !== 'string' || e.run.trim() === '' || /[\r\n]/.test(e.run)) throw fail(`${where}.run must be a non-empty single-line command`)
    if (seen.has(e.name)) throw fail(`${where}.name repeats ${e.name}`)
    seen.add(e.name)
    out.push({ name: e.name, run: e.run })
  })
  return out.length === 0 ? undefined : out
}

// A count or summary line ("2 problems", "Found 3 errors in 2 files.", "✖ 5 problems (3 errors, 2 warnings)"): it changes whenever
// the number of failures does, so it is no failure line. It names a count and no file location (a finding line holds `file.ext:12`).
const COUNT = /\b\d+\s+(?:problems?|errors?|warnings?|failures?|issues?|findings?|files?)\b/i
const isSummary = (norm: string): boolean => COUNT.test(norm) && !/\.[A-Za-z0-9]+(?::|\()/.test(norm)

// The failure lines of a check's output: every non-empty line except a count line, ANSI codes and \r dropped (`raw`, as the tool printed it), and a
// form for comparing (`norm`): the checkout's own root path removed, line and column numbers stripped, white space collapsed.
function linesOf(text: string, roots: string[]): Line[] {
  const rootRes = roots.flatMap((r) => [r, r.replace(/\//g, '\\')]).filter((r) => r !== '').sort((a, b) => b.length - a.length)
  const out: Line[] = []
  for (const l of text.replace(/\r/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n')) {
    const raw = l.trimEnd()
    let norm = raw
    for (const r of rootRes) norm = norm.split(`${r}/`).join('').split(`${r}\\`).join('').split(r).join('')
    norm = norm
      .replace(/(\.[A-Za-z0-9]+):\d+(?::\d+)?/g, '$1')
      .replace(/(\.[A-Za-z0-9]+)\(\d+,\d+\)/g, '$1')
      .replace(/^\s*\d+:\d+(?=\s)/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (norm !== '' && !isSummary(raw)) out.push({ raw, norm })
  }
  return out
}

// both spellings of a checkout's root: as given and as realpath gives it
function rootsOf(at: string): string[] {
  const out = [flat(at)]
  try {
    const real = flat(realpathSync(at))
    if (!out.includes(real)) out.push(real)
  } catch {
    // an unreadable root keeps the one spelling
  }
  return out
}

// `static-check --slug S [--config-only] [--dir D --repo R]`: prints {ok, configured, base?, checks: [...]}; exit 0
// when ok, 1 when a check is broken or has a new failure, 2 when it cannot judge.
export function cmdStaticCheck(f: Flags): Obj {
  const repo = repoOf(f)
  const slug = str(f, 'slug')
  if (slug === undefined || !SLUG.test(slug)) throw usage(`--slug ${String(f.slug)} is not a crew slug`)
  const at = flat(crewWorktree(repo, slug))
  if (!existsSync(at)) throw usage(`no crew worktree for ${slug} at ${at}`)
  const base = mergeBaseOf(f, repo, at, slug)
  const checks = checksOf(baseConfigOf(at, base))
  if (checks === undefined) return { ok: true, configured: false, checks: [] }
  if (f['config-only'] === true) return { ok: false, configured: true, deferred: true, checks: [] }

  const headRoots = rootsOf(at)
  const head = checks.map((c): Result => bashRun(at, c.run))
  const broken = head.map((r) => (r.exit === 0 ? undefined : (cannotStart(r.text, r.exit) ?? envFailure(r.text))))
  const failing = checks.map((_, i) => head[i].exit !== 0 && broken[i] === undefined)

  const onBase = new Map<number, Result>()
  let baseRoots: string[] = []
  if (failing.some(Boolean)) {
    const tmp = mkdtempSync(`${tmpdir()}/static-base-`)
    const checkout = `${flat(tmp)}/base`
    try {
      const add = spawnSync('git', ['-c', 'core.quotepath=off', 'worktree', 'add', '--detach', checkout, base], { cwd: at, encoding: 'utf8', windowsHide: true })
      if (add.error !== undefined || add.status !== 0) throw fail(`cannot add a base checkout at ${base}: ${add.error?.message ?? String(add.stderr).trim()}`)
      baseRoots = rootsOf(checkout)
      installMissingDeps(checkout)
      checks.forEach((c, i) => {
        if (failing[i]) onBase.set(i, bashRun(checkout, c.run))
      })
    } finally {
      spawnSync('git', ['worktree', 'remove', '--force', checkout], { cwd: at, encoding: 'utf8', windowsHide: true })
      rmSync(tmp, { recursive: true, force: true })
      spawnSync('git', ['worktree', 'prune'], { cwd: at, encoding: 'utf8', windowsHide: true })
    }
  }

  const out = checks.map((c, i): Obj => {
    const h = head[i]
    if (broken[i] !== undefined) return { name: c.name, ran: false, exit: h.exit, broken: broken[i], new: false, newFailures: [], baseFailures: [], baseCount: 0 }
    const b = onBase.get(i)
    if (b === undefined) return { name: c.name, ran: true, exit: h.exit, new: false, newFailures: [], baseFailures: [], baseCount: 0 }
    const baseBroken = b.exit === 0 ? undefined : (cannotStart(b.text, b.exit) ?? envFailure(b.text))
    if (baseBroken !== undefined) return { name: c.name, ran: true, exit: h.exit, baseExit: b.exit, broken: `on the merge base: ${baseBroken}`, new: false, newFailures: [], baseFailures: [], baseCount: 0 }
    const seen = new Set(b.exit === 0 ? [] : linesOf(b.text, baseRoots).map((l) => l.norm))
    const lines = linesOf(h.text, headRoots)
    const fresh = lines.filter((l) => !seen.has(l.norm)).map((l) => l.raw)
    const old = lines.filter((l) => seen.has(l.norm)).map((l) => l.raw)
    return { name: c.name, ran: true, exit: h.exit, baseExit: b.exit, new: b.exit === 0 || fresh.length > 0, newFailures: fresh, baseFailures: old.slice(0, LIST_CAP), baseCount: old.length }
  })
  const ok = out.every((c) => c.broken === undefined && c.new === false)
  const body: Obj = { ok, configured: true, ...(onBase.size > 0 ? { base } : {}), checks: out }
  if (!ok) throw refuse(body)
  return body
}
