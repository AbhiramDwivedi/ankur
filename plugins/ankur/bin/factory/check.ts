// The check command: the targeted and full test runs, the environment verdict and the retro catalog hits. Moved unchanged
// from bin/factory.ts (0.31.0 item 5). Never imports factory.ts, whose top-level await would make an import cycle.
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { configOf, declares, flat, isObj, need, packageName, refuse, usage } from '../core.ts'
import type { Flags, Obj } from '../core.ts'
import { selectForCheckout, stripBlanketSuite } from '../testmap.ts'
import type { Selection, TestsConfig } from '../testmap.ts'
import { releaseHeavySlot } from '../../resources/index.ts'
import type { Catalog } from '../../retro/catalog.ts'
import { isTestPath } from './crew.ts'
import { acceptanceCommand } from './goal-file.ts'
import { acquireSlot, heavyWaitMs, limitNote, recordHeavyTime, runMsOf, slotsAt } from './slot.ts'
import { retro } from './retro-mods.ts'
import { isPlainNodeTestStep, rerunFailedFiles } from './flake.ts'
import { baseOf, dirOf, gitOrFail, PLUGIN, repoOf, run } from './cli.ts'
import { loadPlan } from './plan-file.ts'
import { settingsFor } from './settings.ts'

// Environment failures: output lines that say the host, not the code, failed, so no
// fix builder can clear them. Kept short and literal on purpose: a miss only costs the fix ladder, a false hit stops a crew.
export const ENV_PATTERNS: RegExp[] = [
  /Host system is missing dependencies/, // Playwright: the browser's system libraries are not installed
  /browserType\.launch: /, // Playwright: the browser process could not start
  /Executable doesn't exist at /, // Playwright: the browser binary was never downloaded
  /error while loading shared libraries: /, // the dynamic loader: a system library is missing
  /^mk[ds]?temp: mk[ds]?temp failed on .*Operation not permitted/, // a sandbox forbids the temp dir the host's mktemp picked
]
// A command that cannot start: the shell found no such command, or a test runner names a project it does not have.
// Kept apart from ENV_PATTERNS so a probe can tell "cannot start" from other environment failures.
const CANNOT_START: RegExp[] = [
  /: command not found\s*$/, // bash: `<name>: command not found`
  /^command not found\b/, // a bare `command not found: <name>` (zsh) or `command not found` line
  /\bProject\(s\) "[^"]*" not found/, // Playwright: --project names a project the config does not have
]
// The first line of output that says the command could not start, else a line for exit 126 or 127, else undefined.
export function cannotStart(text: string, exit?: number): string | undefined {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const s = line.replace(/^error:\s*["']?/, '')
    if (CANNOT_START.some((re) => { const x = re.exec(s); return x !== null && !/["'`]/.test(s.slice(0, x.index)) })) return line.length > 300 ? `${line.slice(0, 299)}…` : line
  }
  if (exit === 126 || exit === 127) return `the command could not start (exit ${exit})`
  return undefined
}
// The first line of a failed check's output that names an environment failure, cut at 300 characters, or undefined. Besides
// ENV_PATTERNS, node's `Cannot find package 'x' imported from <file>` (ERR_MODULE_NOT_FOUND) counts when the package.json
// nearest to <file> declares x: the dependency is declared but not installed. An undeclared package is a code failure.
export function envFailure(text: string): string | undefined {
  // A match counts only when no quote or backtick comes before it on the line: quoted text is output echoed by a test, not the
  // host failing. A leading YAML `error:` key and its one opening quote don't count (TAP's `error: "<msg>"`).
  const bare = (s: string, at: number): boolean => !/["'`]/.test(s.slice(0, at))
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const s = line.replace(/^error:\s*["']?/, '')
    let hit = ENV_PATTERNS.some((re) => {
      const x = re.exec(s)
      return x !== null && bare(s, x.index)
    })
    const m = /Cannot find package '([^']+)' imported from (\S+)/.exec(s)
    if (!hit && m && bare(s, m.index) && !m[1].startsWith('.') && !m[1].startsWith('/')) hit = declares(m[2].replace(/^file:\/\//, ''), packageName(m[1]))
    if (hit) return line.length > 300 ? `${line.slice(0, 299)}…` : line
  }
  return undefined
}
// The failure blocks of a check's output, each from its header to the next header: Playwright's
// `N) [project] › file:line:col › ...` (the `[project] › ` part left out when the project has no name) and node:test TAP's
// `not ok N - ...` (a TAP parent that only reports failed subtests is no block of its own). Text before the first header
// belongs to no block. [] when no header is found. A TAP block ends at its YAML diagnostic's closing `...`
// line, or at a plan or summary line (`1..N`, `# tests`); lines after that, up to the next header, belong to no block.
// Playwright blocks run to the next header. The closing `...` counts only at the indent of the block's
// own `---` line, and a plan or summary line ends a block only outside its YAML diagnostic, so an `error: |-` block scalar
// holding an indented `...` or `1..N` line stays one block.
function failureBlocks(text: string): string[] {
  const header = /^\s*(\d+\) (\[[^\]]+\] › )?[^\s›][^›]*:\d+:\d+ › |not ok \d+ - )/
  const tapHeader = /^\s*not ok \d+ - /
  const blocks: string[][] = []
  let open = false
  let tap = false
  // the indent of the open TAP block's `---` line while inside its YAML diagnostic, else undefined
  let yaml: string | undefined
  for (const line of text.split('\n')) {
    if (header.test(line)) {
      blocks.push([line])
      open = true
      tap = tapHeader.test(line)
      yaml = undefined
    } else if (open && tap && yaml === undefined && /^\s*(\d+\.\.\d+|# tests \d+)\b/.test(line)) open = false
    else if (open) {
      blocks[blocks.length - 1]?.push(line)
      if (!tap) continue
      if (yaml === undefined) {
        const start = /^(\s*)---\s*$/.exec(line)
        if (start !== null) yaml = start[1] as string
        else if (/^\s*\.\.\.\s*$/.test(line)) open = false
      } else if (line.startsWith(`${yaml}...`) && line.slice(yaml.length + 3).trim() === '') {
        yaml = undefined
        open = false
      }
    }
  }
  return blocks.map((b) => b.join('\n')).filter((b) => !/failureType: '?subtestsFailed'?/.test(b))
}
// `env` only when env lines explain every failure: every failure block holds one, or no block is found and an env line is.
// Otherwise the first env line, if any, is `envSeen` and the run is a code failure.
// A command that cannot start (cannotStart: exit 126 or 127, a `command not found` line, a missing runner project) is always `env`.
export function envVerdict(text: string, exit?: number): { env?: string; envSeen?: string } {
  // A specific line wins over the exit-code fallback, and an env line (a loader failure exits 127) wins over the fallback too.
  const first = envFailure(text)
  const specific = cannotStart(text)
  if (specific !== undefined) return { env: specific }
  if (first !== undefined && (exit === 126 || exit === 127)) return { env: first }
  const started = cannotStart(text, exit)
  if (started !== undefined) return { env: started }
  if (first === undefined) return {}
  const blocks = failureBlocks(text)
  const explained = blocks.length === 0 || blocks.every((b) => envFailure(b) !== undefined)
  return explained ? { env: first } : { envSeen: first }
}

// Stage green: run `npm ci` in each directory with a tracked package-lock.json whose node_modules is missing.
// A linked node_modules (lstat) counts as present. On win32 npm is a .cmd, which spawn runs only through a shell (CVE-2024-27980):
// one fixed command string with shell: true and no args array (DEP0190); nothing in it comes from input.
export function installMissingDeps(cwd: string, platform: string = process.platform, spawn: typeof spawnSync = spawnSync): { dir: string; status: number | null; output: string }[] {
  const listed = spawnSync('git', ['-c', 'core.quotepath=off', 'ls-files', '-z', '--', 'package-lock.json', '**/package-lock.json'], { cwd, encoding: 'utf8', windowsHide: true })
  const out: { dir: string; status: number | null; output: string }[] = []
  if (listed.status !== 0) return out
  for (const rel of String(listed.stdout).split('\0').filter(Boolean)) {
    const dir = flat(path.join(cwd, path.dirname(rel)))
    try {
      lstatSync(`${dir}/node_modules`)
      continue
    } catch {
      // missing: install
    }
    const opts = { cwd: dir, encoding: 'utf8' as const, windowsHide: true, timeout: 600000 }
    const r = platform === 'win32' ? spawn('npm ci', { ...opts, shell: true }) : spawn('npm', ['ci'], opts)
    out.push({ dir, status: r.status ?? 1, output: `${String(r.stdout ?? '')}${String(r.stderr ?? '')}${r.error ? `\n${r.error.message}` : ''}` })
  }
  return out
}

// Runs `bash -c command` in cwd with stdout and stderr to one file; returns the exit and the text.
// Prefixed (on the same line, so line numbers in the output stay the crew's) to every command bashRun runs. BSD mktemp with no
// template uses the Darwin per-user temp dir and ignores TMPDIR, which a sandbox forbids; GNU mktemp already honours TMPDIR, so
// this is harmless on Linux. A call with a template, or with flags other than a lone -d, goes to the real mktemp unchanged.
export const MKTEMP_PREFIX =
  'mktemp() { if [ "$#" -eq 0 ]; then command mktemp "${TMPDIR:-/tmp}/tmp.XXXXXXXX"; ' +
  'elif [ "$#" -eq 1 ] && [ "$1" = "-d" ]; then command mktemp -d "${TMPDIR:-/tmp}/tmp.XXXXXXXX"; ' +
  'else command mktemp "$@"; fi; }; '

// Runs `bash -c command` in cwd with stdout and stderr to one file; returns the exit and the text.
// group (a direct full-suite check, which holds the heavy slot itself): the suite runs as its own process group, recorded in
// resources/groups with heavyPid = this process, so the `until` takeover (stopHolder in resources/index.ts) stops it with the owner.
export function bashRun(cwd: string, command: string, group?: { dir: string; label: string; slug: string }, platform: string = process.platform): { exit: number; text: string; signal?: string } {
  const scratch = mkdtempSync(`${tmpdir()}/factory-check-`)
  try {
    const fd = openSync(`${scratch}/out.txt`, 'w')
    // a check started under node --test (the plugin's own tests) must not hand NODE_TEST_CONTEXT to the tests it runs: a nested
    // node --test that sees it skips every file and exits 0
    // ANKUR_HEAVY_JOB marks this process only: a test or nested check that inherits it records no process group and behaves differently
    const { NODE_TEST_CONTEXT: _, ANKUR_HEAVY_JOB: __, ...env } = process.env
    // under `factory heavy` the wrapper's own group already holds the suite and stops it on the run limit
    const rec = group !== undefined && platform !== 'win32' && !process.env.ANKUR_HEAVY_JOB ? group : undefined
    const gdir = rec ? `${rec.dir}/resources/groups` : ''
    const body = rec ? JSON.stringify({ heavyPid: process.pid, direct: true, label: rec.label, slug: rec.slug, since: Date.now() }).slice(1, -1) : ''
    const q = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`
    const record = rec ? `mkdir -p ${q(gdir)}; printf '{"pgid":%s,%s}' "$$" ${q(body)} > ${q(gdir)}/"$$".json; ` : ''
    const r = spawnSync('bash', ['-c', record + MKTEMP_PREFIX + command], { cwd, env, stdio: ['ignore', fd, fd], ...(rec ? { detached: true } : {}) })
    closeSync(fd)
    if (rec && r.pid) {
      let alive = false
      try {
        process.kill(-r.pid, 0)
        alive = true
      } catch {
        alive = false
      }
      // a member that outlived the suite keeps its record for the reap
      if (!alive) rmSync(`${gdir}/${r.pid}.json`, { force: true })
    }
    if (r.error) throw usage(`cannot run bash in ${cwd}: ${r.error.message}`)
    return { exit: r.status ?? 1, text: readFileSync(`${scratch}/out.txt`, 'utf8'), ...(r.signal ? { signal: r.signal } : {}) }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// 0.31.0 item 1: the tests a green check runs after the acceptance test. bin/testmap.ts maps the crew's diff to the test files it
// reaches, or to the full suite when reach is unclear; --full alone forces the full suite. The run before merge passes
// --full --skip-bounded: the selection then covers the crew's whole diff from the merge base with the target (never from the last
// green head, which holds only the last round), the suite runs only when that selection is full, and a targeted one runs nothing
// and carries `tests.fullSkipped` (the full suite runs once at goal check). A targeted set runs outside the heavy slot; the full
// suite takes the slot for exactly its own run, then records its time for slotWaitMs. A slot not free within heavyWaitMs comes
// back as `slot: {ran: false}`, which heavy reports as busy.
// the files of --only (comma separated); a name with a character a shell would read is refused, never passed on
// A path missing under cwd means the narrowed run could never pass: [] then, so the whole check runs and the record is not `only`.
function onlyFiles(f: Flags, cwd: string): string[] {
  if (typeof f.only !== 'string' || f.only.trim() === '') return []
  const files = f.only.split(',').map((x) => x.trim()).filter((x) => x !== '')
  if (!files.every((n) => /^[A-Za-z0-9._:\/-]+$/.test(n) && !n.startsWith('-'))) throw usage('--only names a file with a character that is not allowed')
  if (!files.every((n) => existsSync(path.resolve(cwd, n)))) return []
  return files
}

function checkTests(f: Flags, dir: string, slug: string, cwd: string): { exit: number; text: string; tests: Obj; slot?: Obj } {
  // 0.36.0 (F-20): --only <file,file> re-runs just those test files, the ones the last green check failed on. It is never a green
  // pass for the crew: cmdCheck marks its record `only`, and lastGreenHead skips such a record.
  const only = onlyFiles(f, cwd)
  if (only.length > 0) {
    const command = `node --test ${only.join(' ')}`
    const r = bashRun(cwd, command)
    return { exit: r.exit, text: `\n$ ${command}\n${r.text}`, tests: { mode: 'targeted', why: ['--only: the test files the last green check failed on'], files: only, commands: [command] } }
  }
  const skipBounded = f['skip-bounded'] === true
  let config: TestsConfig = {}
  let sel: Selection
  let bounded: string | undefined
  try {
    const t = configOf(repoOf(f)).targetedTests
    config = isObj(t) ? (t as TestsConfig) : {}
    // 0.33.0 item 1a: from the crew's last passed green head to HEAD (that range holds what a target merge since then brought in),
    // else from the merge base with the target. --skip-bounded judges the whole crew diff, so it always starts at the merge base.
    const green: { head?: string; why: string } = skipBounded ? { why: '--skip-bounded: the whole crew diff' } : lastGreenHead(dir, slug, cwd)
    const from = green.head ?? baseOf(cwd, settingsFor(f, repoOf(f)).target)
    sel = selectForCheckout(cwd, from, config)
    if (skipBounded && sel.mode === 'targeted') bounded = `the crew diff is bounded: ${sel.why.join('; ')}; the full suite runs once at goal check`
    sel.why = [green.head !== undefined ? `diff base: the last green head ${green.head.slice(0, 12)} of crew ${slug}` : `diff base: the merge base with the target ${from.slice(0, 12)} (${green.why})`, ...sel.why]
  } catch (e) {
    sel = { mode: 'full', why: [`the diff could not be mapped: ${e instanceof Error ? e.message : String(e)}`], files: [], commands: [] }
    const full = typeof config.full === 'string' && config.full.trim() !== '' ? config.full.trim() : existsSync(`${cwd}/package.json`) ? 'npm test' : undefined
    if (full !== undefined) sel.full = full
  }
  // the green check on this head already ran the targeted set, so a bounded crew diff runs nothing more before merge
  if (bounded !== undefined) return { exit: 0, text: `\nfull suite skipped: ${bounded}\n`, tests: { mode: 'targeted', why: sel.why, files: sel.files, commands: [], fullSkipped: bounded } }
  if (f.full === true && sel.mode !== 'full') sel = { mode: 'full', why: ['--full: the full suite before merge'], files: [], commands: [], ...(sel.full === undefined ? {} : { full: sel.full }) }
  const tests: Obj = { mode: sel.mode, why: sel.why, files: sel.files, commands: sel.mode === 'full' ? (sel.full === undefined ? [] : [sel.full]) : sel.commands }
  if (sel.mode === 'targeted') {
    let exit = 0
    let text = ''
    for (const c of sel.commands) {
      const r = bashRun(cwd, c)
      text += `\n$ ${c}\n${r.text}`
      if (r.exit !== 0 && exit === 0) exit = r.exit
    }
    return { exit, text, tests }
  }
  if (sel.full === undefined) return { exit: 0, text: '\nno full-suite command is known (set targetedTests.full)\n', tests: { ...tests, why: [...sel.why, 'no full-suite command is known (set targetedTests.full)'] } }
  const r = suiteRun(f, dir, slug, cwd, sel.full)
  return r.slot !== undefined ? { exit: 1, text: '', tests, slot: r.slot } : { exit: r.exit, text: `\n$ ${sel.full}\n${r.text}`, tests }
}

// 0.33.0 item 1a: the head of the crew's last passed green check. A record counts only when it carries `expect: 'green'` and exited 0,
// so a red check that happened to exit 0 never does; a record from before 0.33.0 has no mark and is not read as green (the diff then
// starts at the merge base, which is only ever wider). The newest such head that is an ancestor of HEAD wins; none gives the reason.
function lastGreenHead(dir: string, slug: string, cwd: string): { head?: string; why: string } {
  const re = new RegExp(`^${slug.replace(/[^a-z0-9-]/g, '\\$&')}-(\\d+)\\.json$`)
  let names: string[] = []
  try {
    names = readdirSync(`${dir}/checks`)
  } catch {
    return { why: 'no green check recorded yet' }
  }
  const nums = names.map((n) => re.exec(n)?.[1]).filter((n) => n !== undefined).map(Number).sort((a, b) => b - a)
  let seen = false
  for (const n of nums) {
    let rec: unknown
    try {
      rec = JSON.parse(readFileSync(`${dir}/checks/${slug}-${n}.json`, 'utf8'))
    } catch {
      continue
    }
    if (!isObj(rec) || rec.expect !== 'green' || rec.exit !== 0 || rec.only !== undefined || typeof rec.head !== 'string' || !/^[0-9a-f]{40}$/i.test(rec.head)) continue
    seen = true
    if (run(cwd, ['merge-base', '--is-ancestor', rec.head, 'HEAD']).status === 0) return { head: rec.head, why: '' }
  }
  return { why: seen ? 'no passed green head is an ancestor of HEAD' : 'no green check recorded yet' }
}

// A full-suite run inside the heavy slot (0.31.0 item 2): takes the slot for exactly its own run, then records its time for
// slotWaitMs. A slot not free within heavyWaitMs comes back as `slot: {ran: false}` and nothing runs.
function suiteRun(f: Flags, dir: string, slug: string, cwd: string, command: string): { exit: number; text: string; slot?: Obj } {
  const limit = heavyWaitMs(f, process.env, dir)
  const label = `${slug}-check`
  const a = acquireSlot(dir, { label, slug }, slotsAt(cwd), limit)
  if (a.token === null) return { exit: 1, text: '', slot: { ran: false, waitedMs: a.waitedMs, waitLimitMs: limit, why: `waited ${a.waitedMs} ms (limit ${limit} ms) for the heavy slot and free memory` } }
  const t1 = Date.now()
  const runMs = runMsOf(dir)
  let r: { exit: number; text: string; signal?: string }
  try {
    // the first run, the one re-run and any step after it all run before the slot is released, under the same limit and group
    r = suiteSteps(dir, slug, cwd, label, command)
  } finally {
    releaseHeavySlot(dir, a.token)
  }
  // a waiter took the slot past its `until` and stopped the suite's group (stopHolder in resources/index.ts): this process lives on,
  // so it records the stopped run and tells the caller the limit, as heavyJobMain does for a wrapped command
  const timedOut = r.signal !== undefined && Date.now() - t1 >= runMs
  recordHeavyTime(dir, { label, slug, ms: Date.now() - t1, ...(timedOut ? { timedOut: true } : {}) })
  if (timedOut) return { exit: r.exit, text: `${r.text}\n${limitNote(runMs)}\n` }
  return r
}

// The steps of a suite command that is eligible for the re-run, or undefined. The command, or the plain npm test script it names
// (a script with a pre or post hook is not expanded), is split on `&&`; every step must pass isPlainNodeTestStep.
function chainSteps(cwd: string, command: string): string[] | undefined {
  let cmd = command.trim()
  const m = /^npm\s+(?:(test)|run(?:-script)?\s+([A-Za-z0-9:_-]+))$/.exec(cmd)
  if (m !== null) {
    const name = m[1] ?? m[2]
    try {
      const scripts = JSON.parse(readFileSync(`${cwd}/package.json`, 'utf8')).scripts
      if (!isObj(scripts) || typeof scripts[name] !== 'string' || scripts[`pre${name}`] !== undefined || scripts[`post${name}`] !== undefined) return undefined
      cmd = scripts[name].trim()
    } catch {
      return undefined
    }
  }
  const steps = cmd.split('&&').map((x) => x.trim())
  return steps.every(isPlainNodeTestStep) ? steps : undefined
}

// The suite inside the slot. An eligible suite (chainSteps) runs step by step and stops at the first failing step, as `&&` does; that
// step gets the one re-run and the later steps still run when it passes. Any other suite runs as one command with no re-run.
function suiteSteps(dir: string, slug: string, cwd: string, label: string, command: string): { exit: number; text: string; signal?: string } {
  const opts = { dir, label, slug }
  const steps = chainSteps(cwd, command)
  if (steps === undefined) return bashRun(cwd, command, opts)
  let text = ''
  let reran = false
  for (const s of steps) {
    let r = bashRun(cwd, s, opts)
    if (r.exit !== 0 && r.signal === undefined && !reran) {
      const x = rerunFlakes(dir, slug, cwd, r, opts)
      if (x !== r) reran = true
      r = x
    }
    text += steps.length > 1 ? `\n$ ${s}\n${r.text}` : r.text
    if (r.exit !== 0) return { exit: r.exit, text, ...(r.signal ? { signal: r.signal } : {}) }
  }
  return { exit: 0, text }
}

// 0.33.0 item 4: after a failed step, the failing files the output names are re-run once on the same head (bin/factory/flake.ts).
// A pass makes the step pass, with one flake event per flaked test, only when the named failures are the whole failure
// (namedAreWholeFailure); otherwise, or on a failure, or when the output names no file, the first result comes back unchanged so the
// caller charges a fix round as before. Never more than one re-run. A file name with a shell-special character is never re-run.
// The re-run runs in the caller's heavy slot with the first run's limit and group; a run the limit stopped keeps its signal.
function rerunFlakes(dir: string, slug: string, cwd: string, r: { exit: number; text: string }, opts: { dir: string; label: string; slug: string }): { exit: number; text: string; signal?: string } {
  const h = run(cwd, ['rev-parse', '--path-format=absolute', 'HEAD'])
  if (h.status !== 0 || !/^[0-9a-f]{40}$/i.test(h.out)) return r
  let signal: string | undefined
  const x = rerunFailedFiles({
    dir,
    slug,
    cwd,
    head: h.out,
    output: r.text,
    run: (files) => {
      if (!files.every((n) => /^[A-Za-z0-9._:\/-]+$/.test(n))) return { exit: 1, text: 'a failing file name has a character the re-run will not pass to a shell\n' }
      const rr = bashRun(cwd, `node --test ${files.join(' ')}`, opts)
      signal = rr.signal
      return rr
    },
  })
  if (x.reran.length === 0) return r
  return x.passed
    ? { exit: 0, text: `${r.text}\nflake: ${x.flakes.map((t) => t.file).join(', ')} failed, then passed on one re-run on the same head; logged as flake events\n${x.text}` }
    : { exit: r.exit, text: `${r.text}\nre-run of ${x.reran.join(', ')} on the same head failed too:\n${x.text}`, ...(signal ? { signal } : {}) }
}

// The test files a `node --test` step of the command names that do not exist. Node 26 prints nothing and exits 0 for such a file when
// another named file passes, so the command text is read, not its output. It fails open: a missed file is the old behaviour, a false
// one would block every green. Segments split on newlines, && || ; and |. Only a segment that starts with `node ... --test` counts,
// and only plain file names after `--test` up to a redirect (no glob, flag, variable or quote). A plain literal `cd <dir>` moves the
// base for later segments; a cd with a variable, glob or no target, a cd inside a subshell, braces or a function, pushd or popd stops
// all checking for the rest of the command. Paths are forward-slashed so Windows paths read the same. `exists` is a seam for tests.
const VALUE_FLAGS = new Set(['--import', '--require', '-r', '--loader', '--env-file', '--test-reporter', '--test-reporter-destination', '--test-name-pattern', '--test-skip-pattern', '--test-concurrency', '--test-timeout'])
export function missingTestFiles(command: string, cwd: string, exists: (p: string) => boolean = existsSync, platform: string = process.platform): string[] {
  const out: string[] = []
  // an MSYS-style /c/Users/x on Windows is C:/Users/x
  const msys = (p: string): string => (platform === 'win32' ? p.replace(/^\/([a-zA-Z])(?=\/|$)/, (_m, d: string) => `${d.toUpperCase()}:`) : p)
  let base = flat(cwd).replace(/\/+$/, '')
  for (const raw of command.split(/&&|\|\||;|\||\r?\n/)) {
    const seg = raw.trim().replace(/^(?:[!({]\s*|\w+=\$\(\s*|\w+=\S*\s+)+/, '')
    if (seg === '') continue
    const words = seg.split(/\s+/)
    if (/^(?:pushd|popd)$/.test(words[0]) || (words[0] !== 'cd' && words.includes('cd'))) return out
    if (words[0] === 'cd') {
      const t = words[1]
      if (words.length !== 2 || t === undefined || t.startsWith('-') || /[$`*?[\]{}()~'"]/.test(t) || /[(){}`]/.test(raw) || raw.trim() !== seg) return out
      const ft = flat(t)
      base = /^(?:[A-Za-z]:)?\//.test(ft) ? msys(ft) : `${base}/${ft}`
      base = base.replace(/\/\.(?=\/|$)/g, '').replace(/\/+$/, '') || '/'
      continue
    }
    const isNode = /^node(?:\.exe)?$/.test(flat(words[0]).split('/').pop() ?? '')
    const t = isNode ? words.indexOf('--test') : -1
    // anything before the first `node --test` that could create or delete files (a build, an rm, a script) means the files named later
    // may be made or removed by the command itself: stop checking. Only these harmless leaders and fail-function bodies go on.
    if (t < 0 && !/^(?:cd|test|\[|ls|echo|printf|true|set|export|exit|\}|function|\w+=\S*|\w+\(\))$/.test(words[0])) return out
    if (t < 0) continue
    for (let i = t + 1; i < words.length; i++) {
      const w = words[i].replace(/^(['"])(.*)\1$/, '$2')
      if (/^\d*[<>&]/.test(w)) break
      if (VALUE_FLAGS.has(words[i - 1])) continue
      if (w.startsWith('-') || /[*?[\]{}$`<>()'"|&]/.test(w) || !/\.(?:[cm]?[jt]s|[jt]sx)$/.test(w)) continue
      const abs = /^(?:[A-Za-z]:)?[\\/]/.test(w) ? msys(flat(w)) : `${base}/${flat(w)}`
      if (!exists(abs)) out.push(flat(w))
    }
  }
  return out
}

// The crew's acceptance command as cmdCheck runs it: `acceptanceTest` as resolved, `command` after a trailing whole-suite step is cut,
// `suiteOnly` when nothing but the suite is left. Pure: reads the goal file only. Throws the refusal or usage error cmdCheck throws.
export function acceptanceFor(dir: string, slug: string, crew: Obj): { acceptanceTest: string; command: string; suiteOnly: boolean } {
  // the goal file is the one home of the acceptance command: its `## Acceptance test` fenced block wins; plan.json's acceptanceTest
  // is the fallback only when the goal file has no such section, and a malformed section is refused, never guessed at
  const goalFile = `${dir}/goals/${slug}.md`
  const fromGoal = existsSync(goalFile) ? acceptanceCommand(readFileSync(goalFile, 'utf8')) : undefined
  if (typeof fromGoal === 'object') throw refuse({ ok: false, why: `goal file ${flat(goalFile)}: ${fromGoal.error}` })
  const acceptanceTest = fromGoal ?? crew.acceptanceTest
  if (typeof acceptanceTest !== 'string' || acceptanceTest === '') throw usage(`crew ${slug} has no acceptanceTest`)
  // 0.31.0 item 1: a trailing whole-suite step (`&& npm test`) is cut; the green check adds the targeted set itself. An acceptance
  // test that is nothing but the suite stays as it is, and since it is the whole suite it runs inside the heavy slot (suiteRun,
  // item 2); its green run is then the full suite already, so no tests are added after it.
  const cut = stripBlanketSuite(acceptanceTest)
  const suiteOnly = cut.blanket && cut.command.trim() === ''
  const command = cut.blanket && !suiteOnly ? cut.command : acceptanceTest
  return { acceptanceTest, command, suiteOnly }
}

export function cmdCheck(f: Flags): Obj {
  const dir = dirOf(f)
  const slug = need(f, 'slug')
  const cwd = flat(need(f, 'cwd'))
  const expect = need(f, 'expect')
  if (expect !== 'red' && expect !== 'green') throw usage('--expect must be red or green')
  if (f['skip-bounded'] !== undefined && !(f['skip-bounded'] === true && f.full === true)) throw usage('--skip-bounded takes no value and needs --full')
  const crew = loadPlan(dir).crews.find((c: Obj) => isObj(c) && c.slug === slug)
  if (crew === undefined) throw usage(`no crew ${slug} in the plan`)
  const { command, suiteOnly } = acceptanceFor(dir, slug, crew)
  // a failed install goes into the check text, so the env catalog sees it
  const installs = expect === 'green' ? installMissingDeps(cwd).filter((i) => i.status !== 0) : []
  // 0.37.1: node 26 exits 0 for a missing named file when other named files pass; a missing file is a failure, red or green.
  // Read before the run, so a file the command itself builds or removes is never judged by what is left after it.
  const missing = missingTestFiles(command, cwd)
  const acc = suiteOnly ? suiteRun(f, dir, slug, cwd, command) : bashRun(cwd, command)
  let exit = acc.exit
  let text = installs.map((i) => `npm ci failed in ${i.dir} (exit ${i.status}):\n${i.output}\n`).join('') + acc.text
  if (exit === 0 && missing.length > 0) {
    exit = 1
    text += `\nacceptance test names a file that does not exist: ${missing.join(', ')}\n`
  }
  let tests: Obj | undefined = suiteOnly ? { mode: 'full', why: ['the acceptance test is the full suite'], files: [], commands: [command] } : undefined
  let slot: Obj | undefined = 'slot' in acc ? acc.slot : undefined
  if (expect === 'green' && exit === 0 && !suiteOnly) {
    const t = checkTests(f, dir, slug, cwd)
    exit = t.exit
    text += t.text
    tests = t.tests
    slot = t.slot
  }
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const tail = lines.slice(-40).join('\n')
  const head = gitOrFail(cwd, ['rev-parse', 'HEAD'])
  if (slot !== undefined) throw refuse({ ok: false, exit, head, tail, tests, slot })
  mkdirSync(`${dir}/checks`, { recursive: true })
  const used = readdirSync(`${dir}/checks`).map((n) => new RegExp(`^${slug.replace(/[^a-z0-9-]/g, '\\$&')}-(\\d+)\\.json$`).exec(n)?.[1]).filter((n) => n !== undefined).map(Number)
  const n = (used.length === 0 ? 0 : Math.max(...used)) + 1
  // a failing run whose env lines explain every failure carries `env`: never a red, and no fix builder for a green. One whose
  // env lines leave a code failure unexplained carries `envSeen` instead and counts as red.
  const { env, envSeen } = exit === 0 ? {} : envVerdict(text, exit)
  const envKeys = { ...(env === undefined ? {} : { env }), ...(envSeen === undefined ? {} : { envSeen }) }
  const known = exit === 0 ? [] : catalogHits(text)
  const record = `${dir}/checks/${slug}-${n}.json`
  writeFileSync(record, JSON.stringify({ command, expect, exit, head, tail, ...(expect === 'green' && onlyFiles(f, cwd).length > 0 ? { only: onlyFiles(f, cwd) } : {}), ...(tests === undefined ? {} : { tests }), ...envKeys, ...(known.length === 0 ? {} : { catalog: known }) }) + '\n', { flag: 'wx' })
  const ok = expect === 'red' ? exit !== 0 && env === undefined : exit === 0
  const since = ok && expect === 'green' ? testsSinceOf(cwd, f) : {}
  const body = { ok, exit, head, tail, record, ...(tests === undefined ? {} : { tests }), ...envKeys, ...(known.length === 0 ? {} : { catalog: known }), ...(ok && expect === 'green' ? { sourceChanges: sourceChangesOf(cwd, f) } : {}), ...(since.list === undefined ? {} : { testsSince: since.list }), ...(since.unknown === undefined ? {} : { testsUnknown: since.unknown }) }
  if (!ok) throw refuse(body)
  return body
}


// With --tests-since <sha>, the test files (isTestPath) changed in <sha>..HEAD, so stage.js can fail a stress-fix
// round that added no regression test. Undefined without the flag, or when the range can't be read (no list, no check).
// A test file is one isTestPath names or one a `testGlobs` glob of .claude/ankur.json matches. When the list is empty and no
// tracked file of the worktree is a test file by either rule, ankur can't tell the project's tests apart: the list is unknown
// (undefined, so stage.js checks nothing) and `testsUnknown` says why, for stage.js to log as a warning.
function testsSinceOf(cwd: string, f: Flags): { list?: string[]; unknown?: string } {
  const sha = typeof f['tests-since'] === 'string' ? f['tests-since'] : ''
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) return {}
  const r = run(cwd, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', `${sha}..HEAD`])
  if (r.status !== 0) return {}
  let globs: string[] = []
  try {
    const g = configOf(repoOf(f)).testGlobs
    globs = Array.isArray(g) ? g.filter((x: unknown): x is string => typeof x === 'string' && x !== '') : []
  } catch {
    globs = []
  }
  const isTest = (p: string): boolean => isTestPath(p) || globs.some((g) => path.matchesGlob(p, g))
  const list = r.out.split('\n').map((l) => l.trim()).filter((p) => p !== '' && isTest(p)).sort()
  if (list.length > 0) return { list }
  const all = run(cwd, ['-c', 'core.quotepath=off', 'ls-files'])
  if (all.status === 0 && !all.out.split('\n').some((p) => p.trim() !== '' && isTest(p.trim()))) {
    return { unknown: 'no tracked file is a test file by name or by testGlobs, so the stress-fix round\'s regression tests were not checked; set testGlobs in .claude/ankur.json' }
  }
  return { list }
}

// The non-test source files the crew's diff (merge-base with the target ... HEAD) adds, renames or deletes, from
// `git diff --name-status -M`, so the knowledge step runs for new or moved functionality even when no member reported a learned
// item. A source file has a code extension and is not a test, a fixture, a doc (docs/, doc/) or under .claude/. A plain edit is no
// change. Best effort: when the target or the diff can't be read the list is empty. At most 100 entries.
function sourceChangesOf(cwd: string, f: Flags): Obj[] {
  const code = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|rb|php|cs|c|cc|cpp|h|hpp|swift|scala|vue|svelte|sh|sql)$/
  const source = (p: string): boolean => code.test(p) && !isTestPath(p) && !/^(docs?|\.claude)\//.test(p)
  let out: string
  try {
    out = gitOrFail(cwd, ['-c', 'core.quotepath=off', 'diff', '--name-status', '-M', `${baseOf(cwd, settingsFor(f, repoOf(f)).target)}...HEAD`])
  } catch {
    return []
  }
  const changes: Obj[] = []
  for (const line of out.split('\n')) {
    const [st, a, b] = line.split('\t')
    const status = st?.[0]
    if (a === undefined || (status !== 'A' && status !== 'D' && status !== 'R')) continue
    if (status === 'R') {
      if (b !== undefined && (source(a) || source(b))) changes.push({ status, path: b, from: a })
    } else if (source(a)) changes.push({ status, path: a })
  }
  return changes.slice(0, 100)
}

// The catalog entries a failed check's output hits, in catalog order, each with the first line that hits it.
// An unreadable catalog gives no hits: a check never fails over it.
function catalogHits(text: string): { id: string; fix: string; line: string }[] {
  let catalog: Catalog
  try {
    catalog = retro().cat.loadCatalog(`${PLUGIN}/retro/catalog.json`)
  } catch {
    return []
  }
  const first = new Map<string, string>()
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.trim() === '') continue
    const shown = line.trim()
    for (const id of retro().cat.matchLine(line, catalog)) if (!first.has(id)) first.set(id, shown.length > 300 ? `${shown.slice(0, 299)}…` : shown)
  }
  return catalog.entries.filter((e) => first.has(e.id)).map((e) => ({ id: e.id, fix: e.fix, line: first.get(e.id) as string }))
}

// Probes every crew need and every catalog probe on the host; writes nothing.
// `broken`: the probe command itself cannot start (cannotStart), so it says nothing about the need.
export function runProbe(probe: Obj, repo: string): { pass: boolean; detail: string; broken?: boolean } {
  if (probe.kind === 'file') {
    const p = String(probe.path)
    return existsSync(path.resolve(repo, p)) ? { pass: true, detail: '' } : { pass: false, detail: p }
  }
  const r = spawnSync('bash', ['-c', String(probe.run)], { cwd: repo, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  // bash exiting 0 passes even when a background child held the pipes until the timeout (spawnSync then sets ETIMEDOUT with status 0)
  if (r.status === 0) return { pass: true, detail: '' }
  const first = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((l) => l.trim()).find((l) => l !== '')
  const why = r.error !== undefined ? r.error.message : r.signal ? `killed by ${r.signal}` : `exit ${r.status}`
  const detail = first ?? why
  const broken = cannotStart(`${r.stdout ?? ''}\n${r.stderr ?? ''}`, r.status ?? undefined)
  if (broken !== undefined) return { pass: false, broken: true, detail: broken.length > 300 ? `${broken.slice(0, 299)}…` : broken }
  return { pass: false, detail: detail.length > 300 ? `${detail.slice(0, 299)}…` : detail }
}
