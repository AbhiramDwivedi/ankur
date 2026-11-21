// The decide and goal-check commands. Moved unchanged from bin/factory.ts (0.31.0 item 5). Never imports factory.ts, whose
// top-level await would make an import cycle.
import path from 'node:path'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { constants as osConstants, tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { CliError, commonDir, configOf, flat, isObj, readText, refuse, sharedDir, str, usage } from '../core.ts'
import type { Flags, Obj } from '../core.ts'
import { readJsonl, writeJsonAtomic } from '../lock.ts'
import { resolveRunDir } from '../names.ts'
import { stripBlanketSuite } from '../testmap.ts'
import { localTime } from '../../hooks/register.ts'
import { goalOf, RUN_GOAL } from '../../hooks/intake.ts'
import { dirOf, FACTORY, gitOrFail, parseFlags, repoOf, run } from './cli.ts'
import { loadPlan } from './plan-file.ts'
import { settingsFor } from './settings.ts'
import { appendDecision, appendDecisionLine } from './log.ts'
import { heavyMain } from './heavy.ts'

// ==== decide ====

// The PM's one route to D/decisions.md. Three forms, exactly one per call:
//   --line '<decision> | <reason> | <checker> | <outcome>'          -> `- HH:MM | <decision> | <reason> | <checker> | <outcome>`
//   --checker <n> --recommend <answer|defer|pass> --text T --outcome O -> `- HH:MM | checker-<n> RECOMMEND <answer>: T | O`
//   --checker <n> --recommend <worth|trim|drop> --text T --outcome O   -> `- HH:MM | checker-<n> WORTH <worth>: T | O` (bug G)
//   --run '<goal>'                                                   -> `## Run <UTC start> | <goal>`
// The clock stamps every line. Each refusal exits 2 and writes nothing; no form writes a continuation line.
const RECOMMENDS = ['answer', 'defer', 'pass']
// A goal item's worth review before planning: plan-args refuses until the run section holds one of these (plan.ts worthGate)
const WORTHS = ['worth', 'trim', 'drop']
// True when `dir` is a direct child of <git common dir>/ankur; the compare is on real, normalised paths (case-insensitive on win32).
export function isSessionDirUnderCommon(repo: string, dir: string, platform: string = process.platform): boolean {
  let common: string
  try {
    common = commonDir(repo)
  } catch {
    return false
  }
  const norm = (p: string): string => (platform === 'win32' ? flat(p).toLowerCase() : flat(p))
  const target = path.resolve(dir)
  if (!/^[A-Za-z0-9._-]+$/.test(path.basename(target))) return false
  const parent = path.dirname(target)
  // <common>/ankur may not exist yet: resolve the nearest existing ancestor with realpath and re-append the missing tail, so a repo
  // reached through a symlink (macOS /var -> /private/var) compares equal to the real common dir
  const real = (p: string): string => {
    let head = p
    const tail: string[] = []
    while (!existsSync(head) && path.dirname(head) !== head) (tail.unshift(path.basename(head)), (head = path.dirname(head)))
    return path.join(existsSync(head) ? realpathSync(head) : head, ...tail)
  }
  return norm(real(parent)) === norm(real(resolveRunDir(common)))
}
export function cmdDecide(f: Flags, platform: string = process.platform): Obj {
  const dir = dirOf(f)
  const forms = (['line', 'checker', 'run'] as const).filter((k) => f[k] !== undefined)
  if (forms.length !== 1) throw usage('decide takes exactly one of --line, --checker (with --recommend, --text, --outcome) or --run')
  const form = forms[0]
  const keys = form === 'checker' ? ['checker', 'recommend', 'text', 'outcome'] : [form]
  const vals: Record<string, string> = {}
  for (const k of keys) {
    const v = str(f, k)
    if (v === undefined) throw usage(`decide --checker needs --${k}`)
    if (/[\r\n]/.test(v)) throw usage(`--${k} holds a newline; a decision is one line`)
    vals[k] = v
  }
  // --run is the first command of a run: its session dir may not exist yet, so it makes one, but only directly under <common>/ankur
  // and only once the goal text is valid, so a refusal leaves nothing behind
  if (form === 'run' && vals.run.trim() !== '' && !existsSync(dir) && isSessionDirUnderCommon(repoOf(f), dir, platform)) mkdirSync(dir, { recursive: true })
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw usage(`--dir is not a directory: ${dir}`)
  let line: string
  if (form === 'line') {
    const fields = vals.line.split('|').map((s) => s.trim())
    if (fields.length !== 4) throw usage(`--line needs four fields split by |, decision | reason | checker | outcome; got ${fields.length}`)
    line = `- ${localTime(Date.now())} | ${fields.join(' | ')}`
  } else if (form === 'checker') {
    if (!/^[1-9]\d*$/.test(vals.checker)) throw usage(`--checker must be a positive integer, got ${vals.checker}`)
    const worth = WORTHS.includes(vals.recommend)
    if (!worth && !RECOMMENDS.includes(vals.recommend)) throw usage(`--recommend must be one of ${[...RECOMMENDS, ...WORTHS].join(', ')}, got ${vals.recommend}`)
    if (vals.text.trim() === '') throw usage('--text is empty')
    if (vals.outcome.trim() === '') throw usage('--outcome is empty')
    line = `- ${localTime(Date.now())} | checker-${vals.checker} ${worth ? 'WORTH' : 'RECOMMEND'} ${vals.recommend}: ${vals.text.trim()} | ${vals.outcome.trim()}`
  } else {
    const goal = vals.run.trim()
    if (goal === '') throw usage('--run needs a goal')
    line = `## Run ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} | ${goal}`
  }
  appendDecisionLine(dir, line)
  return { ok: true, form, line }
}
// The two steps of a goal check: the plan's own goalCheck, then the full suite on the same commit, each its own heavy job.
type Step = 'goalCheck' | 'suite'
type GoalCheck = { dir: string; repo: string; goalId: string | undefined; command: string | undefined; label: string; target: string; sha: string }
const stepLabel = (goalId: string | undefined, step: Step): string => `${step === 'suite' ? 'full suite' : 'goalCheck'}${goalId === undefined ? '' : ` of ${goalId}`}`

// The goalCheck command a plan names (undefined when the plan or goal has none: the goal check then runs the full suite alone), its
// label, and the target's commit. Refuses (exit 2) on a --goal the plan does not name.
function goalCheckOf(f: Flags): GoalCheck {
  const dir = dirOf(f)
  const repo = repoOf(f)
  const plan = loadPlan(dir)
  const goalId = str(f, 'goal')
  let command: unknown = plan.goalCheck
  if (goalId !== undefined) {
    const g = (Array.isArray(plan.goals) ? plan.goals : []).find((x: Obj) => isObj(x) && x.id === goalId)
    if (!g) throw usage(`no goal ${goalId} in the plan`)
    command = g.goalCheck
  }
  const target = settingsFor(f, repo).target
  const at = str(f, 'at')
  const sha = gitOrFail(repo, ['-c', 'core.quotepath=off', 'rev-parse', '--verify', `${at ?? target}^{commit}`])
  return { dir, repo, goalId, command: typeof command === 'string' && command.trim() !== '' ? command : undefined, label: stepLabel(goalId, 'goalCheck'), target, sha }
}

// The full-suite command at a commit: targetedTests.full, else `npm test` when that commit's package.json has a test script, else
// undefined (no command is known: a goal that needs the suite then fails closed with NO_SUITE). The goal-check caller and its
// suite job both read it here, so they agree.
const NO_SUITE = 'this goal needs a full test run (it changed more than .md files, or what it changed is not known), but no full-suite command is known; to fix it, name the command in targetedTests.full of .claude/ankur.json (or add a test script to package.json), then run goal-check again'
function suiteCommandOf(repo: string, sha: string): string | undefined {
  const t = configOf(repo).targetedTests
  if (isObj(t) && typeof t.full === 'string' && t.full.trim() !== '') return t.full.trim()
  const r = run(repo, ['-c', 'core.quotepath=off', 'show', `${sha}:package.json`])
  if (r.status !== 0) return undefined
  try {
    const scripts = JSON.parse(r.out).scripts
    return isObj(scripts) && typeof scripts.test === 'string' && scripts.test.trim() !== '' ? 'npm test' : undefined
  } catch {
    // a package.json that does not parse names no test script
    return undefined
  }
}

// Text fit for one field of a decision line: a changed path may hold a `|` or a newline, which would split the line.
const oneField = (s: string): string => s.replace(/[|\r\n]+/g, ' ')

const SHA = /^[0-9a-f]{7,64}$/
// Every path the goal's merged crews changed: the union of `git diff --name-only base...head` over this session's merge ledger rows
// of the goal (`run` for the first goal), renames split into both paths. Fails closed with the reason when the change cannot be
// known: a crew the plan marks merged for the goal has no row, no row exists, or a row's range cannot be read.
function goalChange(g: GoalCheck): { paths: string[] } | { unknown: string } {
  const goal = g.goalId ?? RUN_GOAL
  const session = path.basename(g.dir)
  const rows = readJsonl(`${sharedDir(g.repo)}/ledger.jsonl`).rows.filter((r) => r.kind === 'merge' && r.session === session && r.goal === goal)
  const plan = loadPlan(g.dir)
  const merged = (Array.isArray(plan.crews) ? plan.crews : []).filter((c: unknown) => isObj(c) && c.status === 'merged' && goalOf(c) === goal).map((c: Obj) => String(c.slug))
  const missing = merged.filter((s: string) => !rows.some((r) => r.crew === s))
  if (missing.length > 0) return { unknown: `merged crew ${missing.join(', ')} of the goal has no merge ledger row, so its change is not known` }
  if (rows.length === 0) return { unknown: 'no merge ledger row of the goal is on record, so its change is not known' }
  const paths = new Set<string>()
  for (const r of rows) {
    const range = `${String(r.base).slice(0, 12)}...${String(r.head).slice(0, 12)}`
    if (typeof r.base !== 'string' || typeof r.head !== 'string' || !SHA.test(r.base) || !SHA.test(r.head)) return { unknown: `the merge row of crew ${String(r.crew)} names no base and head commit` }
    const d = spawnSync('git', ['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', '-z', `${r.base}...${r.head}`, '--'], { cwd: g.repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true })
    if (d.error !== undefined || d.status !== 0) return { unknown: `the range ${range} of crew ${String(r.crew)} cannot be read: ${(d.error?.message ?? String(d.stderr ?? '')).trim().slice(0, 200)}` }
    for (const p of String(d.stdout).split('\0')) if (p !== '') paths.add(p)
  }
  return { paths: [...paths].sort() }
}

// Whether the full suite still has to run after the goalCheck passed, and why. It does not when the goalCheck already runs it
// (stripBlanketSuite) or every path the goal changed ends in .md; every other case runs it, a change that cannot be known included.
function suiteNeed(g: GoalCheck): { run: boolean; why: string } {
  if (g.command !== undefined && stripBlanketSuite(g.command).blanket) return { run: false, why: `the ${g.label} already runs the whole suite` }
  let c: ReturnType<typeof goalChange>
  try {
    c = goalChange(g)
  } catch (e) {
    // a ledger, plan or git read that throws leaves the change unknown: the suite runs rather than being skipped
    c = { unknown: `the goal's change could not be read: ${e instanceof Error ? e.message : String(e)}` }
  }
  if ('paths' in c && c.paths.length > 0 && c.paths.every((p) => p.endsWith('.md'))) return { run: false, why: `every path the goal's merged crews changed ends in .md (docs only, ${c.paths.length} path${c.paths.length === 1 ? '' : 's'})` }
  const code = 'paths' in c ? c.paths.filter((p) => !p.endsWith('.md')) : []
  const why = 'unknown' in c ? c.unknown : `the goal's merged crews changed ${code.length} path${code.length === 1 ? '' : 's'} that ${code.length === 1 ? 'is' : 'are'} not docs (${code.slice(0, 3).join(', ')}${code.length > 3 ? ', ...' : ''})`
  return { run: true, why }
}

// `goal-check --dir D --repo R [--goal ID]` runs the plan's goalCheck (or the goal's own) at the target head, then the full suite
// on that commit once, unless the goalCheck already runs it or every path the goal's merged crews changed ends in .md (suiteNeed).
// With no goalCheck it runs the suite alone. The body carries `suite: {ran, why, exit?}`, and a red suite fails the goal check;
// a suite the goal needs with no full-suite command known fails it too (exit 2, NO_SUITE), so nothing run is never a pass.
// Each step is a suite run, so each goes through its own heavy background job (heavyMain, the path green's full suite takes):
// detached, holding a heavy slot, with the slot wait scaled by slotWaitMs, and the caller waits at most HEAVY_ATTACH_MS, under the
// 600 s Bash limit. Two jobs, not one: each gets the whole run limit (ANKUR_HEAVY_RUN_MS, else runMsOf) for itself, so a goalCheck
// and a suite that each fit it never fail for not fitting it together. A wait that runs out prints `<step> still running after
// N s` and leaves the job running; the same line, run again, collects its result. A goalCheck that passed is kept in its passed
// record until the suite after it is done, so a re-run collecting a pending suite never runs the goalCheck again.
// Each step that runs logs one decision line; a suite that does not run is named in the goalCheck's line (or, with no goalCheck,
// in a line of its own). A job past the run limit is stopped by the heavy wrapper, which may SIGKILL goal-check-job before it
// cleans up, so this caller removes the worktree and temp dir the job recorded and logs its decision line (collectGoalCheck).
// A job left behind when the caller goes away is stopped by Claude Code's TaskStop. One JSON line, ok or not.
export async function goalCheckMain(argv: string[]): Promise<{ body: Obj; code: number }> {
  let g: GoalCheck
  try {
    g = goalCheckOf(parseFlags(argv))
  } catch (e) {
    if (e instanceof CliError) return { body: e.body, code: e.code }
    return { body: { error: e instanceof Error ? e.message : String(e) }, code: 2 }
  }
  const base = { ok: false, goal: g.goalId ?? null, target: g.target, head: g.sha }
  let passed: Obj | undefined
  if (g.command !== undefined) {
    passed = readPassed(g)
    if (passed === undefined) {
      const r = await runStep(g, 'goalCheck', base)
      if (r.code !== 0) return { body: { ...r.body, suite: { ran: false, why: r.body.pending === true ? `the full suite runs once the ${g.label} has passed` : `the ${g.label} did not pass, so the full suite did not run` } }, code: r.code }
      passed = r.body
      mkdirSync(path.dirname(passedRecord(g)), { recursive: true })
      writeJsonAtomic(passedRecord(g), { command: g.command, body: passed })
    }
  }
  // the goalCheck job decided the suite's need when it passed (and named it in its decision line); with no goalCheck, decide it here
  const { suiteNeed: jobNeed, ...done } = passed ?? { ...base, ok: true }
  const need = isObj(jobNeed) && typeof jobNeed.run === 'boolean' && typeof jobNeed.why === 'string' ? { run: jobNeed.run, why: jobNeed.why } : suiteNeed(g)
  if (!need.run) {
    if (g.command === undefined) appendDecision(g.dir, `${stepLabel(g.goalId, 'suite')} not run at ${g.target} ${g.sha.slice(0, 12)} | ${oneField(need.why)}`)
    rmSync(passedRecord(g), { force: true })
    return { body: { ...done, suite: { ran: false, why: need.why } }, code: 0 }
  }
  // a goal that must run the suite and has no command for it fails closed: nothing run is never a pass (a goalCheck's pass stays
  // on record, so once the command is set the same line runs only the suite)
  if (suiteCommandOf(g.repo, g.sha) === undefined) {
    appendDecision(g.dir, `${stepLabel(g.goalId, 'suite')} failed (not run) at ${g.target} ${g.sha.slice(0, 12)} | ${NO_SUITE}; ${oneField(need.why)}`)
    return { body: { ...done, ok: false, error: NO_SUITE, suite: { ran: false, why: need.why } }, code: 2 }
  }
  const r = await runStep(g, 'suite', base)
  // a suite still running or one that could not take its slot: the goalCheck's pass stays on record for the re-run
  if (r.unsettled === true) return { body: { ...r.body, suite: { ran: false, why: need.why } }, code: 1 }
  rmSync(passedRecord(g), { force: true })
  const exit = Number.isInteger(r.body.exit) ? Number(r.body.exit) : r.code === 0 ? 0 : 1
  const suite = { ran: true, why: need.why, exit, ...(r.body.timedOut === true ? { timedOut: true } : {}), ...(typeof r.body.output === 'string' && exit !== 0 ? { output: r.body.output } : {}) }
  if (r.code !== 0) return { body: { ...done, ok: false, ...(r.body.timedOut === true ? { timedOut: true, limitNote: r.body.limitNote } : {}), suite }, code: r.code }
  return { body: { ...done, ok: true, suite }, code: 0 }
}

// Runs one step as its own heavy job and folds the job's result into a goal-check body: still pending or not run for want of the
// slot (`unsettled`: the step has no verdict yet), stopped by the run limit (`timedOut`), or the job's own body (code 0 when it passed).
async function runStep(g: GoalCheck, step: Step, base: Obj): Promise<{ body: Obj; code: number; unsettled?: true }> {
  const label = stepLabel(g.goalId, step)
  const slug = `goalcheck${g.goalId === undefined ? '' : `-${g.goalId}`}${step === 'suite' ? '-suite' : ''}`
  const inner = [process.execPath, ...process.execArgv, FACTORY, 'goal-check-job', '--dir', g.dir, '--repo', g.repo, '--at', g.sha, ...(g.goalId === undefined ? [] : ['--goal', g.goalId]), ...(step === 'suite' ? ['--suite'] : [])]
  const r = await heavyMain(['--dir', g.dir, '--repo', g.repo, '--slug', slug, '--label', slug, '--cwd', g.repo, '--', ...inner])
  const h = isObj(r.body.heavy) ? r.body.heavy : {}
  if (h.pending === true) {
    const s = Math.round(Number(h.ageMs ?? h.waitedMs ?? 0) / 1000)
    return { body: { ...base, pending: true, job: h.job, error: `${label} still running after ${s} s; run the same goal-check again to wait for its result` }, code: 1, unsettled: true }
  }
  collectGoalCheck(g, step, h)
  if (h.ran === false) return { body: { ...base, error: `${label} did not run: ${String(h.why)}` }, code: 1, unsettled: true }
  const { heavy: _, ...rest } = r.body
  // the run limit stopped the job: the PM must see timedOut, not a bare failure, and the body may be only a tail
  if (h.timedOut === true) return { body: { ...base, ...rest, ok: false, timedOut: true, limitNote: h.limitNote }, code: r.code === 0 ? 1 : r.code }
  return { body: rest, code: r.code }
}

// Where goal-check keeps a goalCheck that passed until the full suite after it is done: one file per goal and commit.
function passedRecord(g: GoalCheck): string {
  return path.join(g.dir, 'goalchecks', `${g.goalId ?? 'plan'}-${g.sha.slice(0, 12)}-passed.json`.replace(/[^\w.-]/g, '_'))
}

// The goalCheck's passing body on record for this commit, when it was the same command; undefined otherwise.
function readPassed(g: GoalCheck): Obj | undefined {
  let r: unknown
  try {
    r = JSON.parse(readText(passedRecord(g)) ?? '')
  } catch {
    // no record, or one cut short: the goalCheck runs again
    return undefined
  }
  return isObj(r) && r.command === g.command && isObj(r.body) && r.body.ok === true ? r.body : undefined
}

export async function goalCheckJobMain(argv: string[]): Promise<{ body: Obj; code: number }> {
  try {
    return { body: await cmdGoalCheckJob(parseFlags(argv)), code: 0 }
  } catch (e) {
    if (e instanceof CliError) return { body: e.body, code: e.code }
    return { body: { error: e instanceof Error ? e.message : String(e) }, code: 2 }
  }
}

// `goal-check-job --dir D --repo R --at SHA [--goal ID] [--suite]` (internal, the heavy job goalCheckMain starts for each step):
// runs the goalCheck, or with --suite the full-suite command (suiteCommandOf), with `bash -c` in a temporary detached worktree at
// SHA, never in the main checkout, removes the worktree, and logs one decision line.
// It never pushes or moves a branch, and has no time limit of its own: the heavy job runs it in the background.
// The command runs under spawnSync. When the heavy job stops the group at the run limit it SIGKILLs the group after
// KILL_GRACE_MS, so this process may die before its cleanup: it records its temp worktree in goalCheckRecord first, and
// collectGoalCheck (run by goalCheckMain, outside the stopped group) removes what a dead job left and logs the decision line.
export function cmdGoalCheckJob(f: Flags): Obj {
  if (str(f, 'at') === undefined) throw usage('goal-check-job needs --at <sha>; run goal-check instead')
  const g = goalCheckOf(f)
  const { dir, repo, goalId, target, sha } = g
  const step: Step = f.suite === true ? 'suite' : 'goalCheck'
  const label = stepLabel(goalId, step)
  const command = step === 'suite' ? suiteCommandOf(repo, sha) : g.command
  if (command === undefined) throw usage(step === 'suite' ? NO_SUITE :`${goalId === undefined ? 'the plan' : `goal ${goalId}`} has no goalCheck`)
  const wt = flat(path.join(realpathSync(mkdtempSync(path.join(tmpdir(), 'ankur-goalcheck-'))), 'wt'))
  const rec = goalCheckRecord(dir, goalId, sha, step)
  mkdirSync(path.dirname(rec), { recursive: true })
  writeFileSync(rec, JSON.stringify({ wt, label, target, sha }))
  const out = `${path.dirname(wt)}/out.txt`
  let status = 1
  let tail = ''
  try {
    gitOrFail(repo, ['-c', 'core.quotepath=off', 'worktree', 'add', '-q', '--detach', wt, sha])
    // a goal-check started under node --test must not hand NODE_TEST_CONTEXT to a node --test the check runs (it would skip every file)
    const { NODE_TEST_CONTEXT: _, ...env } = process.env
    const fd = openSync(out, 'w')
    let errMsg = ''
    try {
      const r = spawnSync('bash', ['-c', command], { cwd: wt, env, stdio: ['ignore', fd, fd], windowsHide: true })
      if (r.error) errMsg = r.error.message
      status = r.status ?? (r.signal === null ? 1 : 128 + (osConstants.signals[r.signal] ?? 0))
    } finally {
      closeSync(fd)
    }
    tail = `${readFileSync(out, 'utf8')}${errMsg === '' ? '' : `\n${errMsg}`}`.slice(-4000)
  } finally {
    cleanGoalCheck(repo, wt)
  }
  // a run the limit stopped never gets here: SIGTERM ends this process under spawnSync, and collectGoalCheck logs it with the
  // limit the wrapper used (h.limitNote), so the decision line and the JSON give the same number
  // a goalCheck that passed decides here whether the full suite follows, so its one decision line names a suite that will not run
  const need = step === 'goalCheck' && status === 0 ? suiteNeed(g) : undefined
  const note = need !== undefined && !need.run ? `; full suite not run: ${oneField(need.why)}` : ''
  appendDecision(dir, `${label} ${status === 0 ? 'passed' : `failed (exit ${status})`} at ${target} ${sha.slice(0, 12)} | run by factory goal-check in a temporary worktree${note}`)
  rmSync(rec, { force: true })
  const body = { ok: status === 0, goal: goalId ?? null, target, head: sha, exit: status, output: tail, ...(need === undefined ? {} : { suiteNeed: need }) }
  if (!body.ok) throw refuse(body)
  return body
}

// Where goal-check-job records its temp worktree until it has cleaned up and logged: one file per goal, commit and step.
function goalCheckRecord(dir: string, goalId: string | undefined, sha: string, step: Step): string {
  return path.join(dir, 'goalchecks', `${goalId ?? 'plan'}-${sha.slice(0, 12)}${step === 'suite' ? '-suite' : ''}.json`.replace(/[^\w.-]/g, '_'))
}

// Removes a goal-check temp worktree (if still registered), prunes, and deletes its temp dir. Safe to run twice.
function cleanGoalCheck(repo: string, wt: string): void {
  run(repo, ['-c', 'core.quotepath=off', 'worktree', 'remove', '--force', wt])
  run(repo, ['-c', 'core.quotepath=off', 'worktree', 'prune'])
  rmSync(path.dirname(wt), { recursive: true, force: true })
}

// Run by goalCheckMain once the heavy job has a result: when the job left its record, it died before cleaning up (the run limit
// SIGKILLed its group), so this removes its worktree and temp dir and logs the decision line the job did not.
function collectGoalCheck(g: GoalCheck, step: Step, h: Obj): void {
  const rec = goalCheckRecord(g.dir, g.goalId, g.sha, step)
  let r: unknown
  try {
    r = JSON.parse(readText(rec) ?? '')
  } catch {
    r = undefined
  }
  // a limit kill can land before the job wrote its record (a loaded host is slow to make the worktree): the stop still gets its decision line
  if (!isObj(r) && h.timedOut !== true) return
  const wt = isObj(r) && typeof r.wt === 'string' ? r.wt : ''
  // only a temp dir this command made: never delete a path the record merely names
  if (path.basename(wt) === 'wt' && path.basename(path.dirname(wt)).startsWith('ankur-goalcheck-')) cleanGoalCheck(g.repo, wt)
  const exit = Number.isInteger(h.exit) ? Number(h.exit) : 1
  const verdict = h.timedOut === true ? `stopped by the run limit (exit ${exit}); ${String(h.limitNote)}` : `failed (exit ${exit}; the job ended before it could clean up)`
  appendDecision(g.dir, `${stepLabel(g.goalId, step)} ${verdict} at ${g.target} ${g.sha.slice(0, 12)} | run by factory goal-check in a temporary worktree`)
  rmSync(rec, { force: true })
}
