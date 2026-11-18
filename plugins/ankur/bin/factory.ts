// ankur: the factory CLI. Run as `node <plugin>/bin/factory.ts <command> [flags]`. Every command
// prints one JSON object on one line; exit 0 = done, 1 = a gate or expectation refused, 2 = usage or I/O error
// ({"error": "..."}). Node built-ins and relative paths only.
// 0.31.0 item 5: this file is the thin dispatcher: the command table, main and the CLI around it. Each command group lives in
// bin/factory/<group>.ts; no module there imports this file.
// 0.33.0 R-154: every command entry loads its module with a lazy import(), so a run loads only the module of the command it runs.
// This file exports only main and gatesMain; the other names it exported before (0.32.0) are exported by bin/factory/exports.ts.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'
import { CliError, refuse, usage } from './core.ts'
import type { Flags, Obj } from './core.ts'
import { parseFlags } from './factory/cli.ts'
import { admitFirst, reapFirst, runRidersAfter, runRidersFirst, shadowedByTables, statusLine, takeAdmitFlag, takeReapFlag, takeRiderFlags, takeStatusFlag } from './factory/flags.ts'

// ==== main ====

type Cmd = (f: Flags) => Promise<Obj>
const CORE_COMMANDS: Record<string, Cmd> = {
  'crew-decision': async (f) => (await import('./factory/decisions.ts')).cmdCrewDecision(f),
  'decision-reply': async (f) => (await import('./factory/decisions.ts')).cmdDecisionReply(f),
  'decision-replies': async (f) => (await import('./factory/decisions.ts')).cmdDecisionReplies(f),
  'decision-ack': async (f) => (await import('./factory/decisions.ts')).cmdDecisionAck(f),
  'decision-checkpoint': async (f) => (await import('./factory/decisions.ts')).cmdDecisionCheckpoint(f),
  'knowledge-lint': async (f) => (await import('./factory/knowledge-cmds.ts')).cmdKnowledgeLint(f),
  'knowledge-config-gate': async (f) => (await import('./factory/knowledge-cmds.ts')).cmdKnowledgeConfigGate(f),
  'gated-merge': async (f) => (await import('./factory/knowledge-cmds.ts')).cmdGatedMerge(f),
  'knowledge-migrate': async (f) => (await import('./factory/knowledge-cmds.ts')).cmdKnowledgeMigrate(f),
  'migrate-names': async (f) => (await import('./factory/runs.ts')).cmdMigrateNames(f),
  'rules-index': async (f) => (await import('./factory/knowledge-cmds.ts')).cmdRulesIndex(f),
  stitch: async (f) => (await import('./factory/knowledge-cmds.ts')).cmdStitch(f),
  consolidate: async (f) => (await import('./factory/consolidate.ts')).cmdConsolidate(f),
  'knowledge-commit': async (f) => (await import('./factory/decisions.ts')).cmdKnowledgeCommit(f),
  'crew-learned': async (f) => (await import('./factory/decisions.ts')).cmdCrewLearned(f),
  decisions: async (f) => (await import('./factory/decisions.ts')).cmdDecisions(f),
  settings: async (f) => (await import('./factory/plan.ts')).cmdSettings(f),
  'plan-args': async (f) => (await import('./factory/plan.ts')).cmdPlanArgs(f),
  'plan-write': async (f) => (await import('./factory/plan.ts')).cmdPlanWrite(f),
  'plan-cap': async (f) => (await import('./factory/plan.ts')).cmdPlanCap(f),
  'plan-check': async (f) => (await import('./factory/plan.ts')).cmdPlanCheck(f),
  approve: async (f) => (await import('./factory/plan.ts')).cmdApprove(f),
  // start checks --args-file before it runs and writes it after, so its entry holds the module rather than one handler
  start: async (f) => { const m = await import('./factory/start.ts'); m.checkArgsFile(f); return m.argsFileOut(f, m.cmdStart(f)) },
  sync: async (f) => (await import('./factory/crew.ts')).cmdSync(f),
  check: async (f) => (await import('./factory/check.ts')).cmdCheck(f),
  integrate: async (f) => (await import('./factory/crew.ts')).cmdIntegrate(f),
  'mark-merged': async (f) => (await import('./factory/crew.ts')).cmdMarkMerged(f),
  'owns-check': async (f) => (await import('./factory/crew.ts')).cmdOwnsCheck(f),
  'owns-extend': async (f) => (await import('./factory/crew.ts')).cmdOwnsExtend(f),
  'tests-check': async (f) => (await import('./factory/crew.ts')).cmdTestsCheck(f),
  finish: async (f) => (await import('./factory/finish.ts')).cmdFinish(f),
  land: async (f) => (await import('./factory/finish.ts')).cmdLand(f),
  doctor: async (f) => (await import('./factory/doctor.ts')).cmdDoctor(f),
  'find-run': async (f) => (await import('./factory/runs.ts')).cmdFindRun(f),
  admit: async (f) => (await import('./factory/admit.ts')).cmdAdmit(f),
  reap: async (f) => (await import('./factory/reap.ts')).cmdReap(f),
  decide: async (f) => (await import('./factory/decide.ts')).cmdDecide(f),
  'goal-check-job': async (f) => (await import('./factory/decide.ts')).cmdGoalCheckJob(f),
  heavy: async () => {
    // the command line runs it with import('./factory/heavy.ts') (heavyCmd below), so main refuses it
    throw usage('heavy is async: run it from the command line')
  },
  gates: async () => {
    // the command line runs it with import('./factory/gates.ts') (gatesMain below), so main refuses it
    throw usage('gates is async: run it from the command line')
  },
  'goal-check': async () => {
    // the command line runs it with import('./factory/decide.ts') (goalCheckCmd below), so main refuses it
    throw usage('goal-check is async: run it from the command line')
  },
  'persona-install': async (f) => (await import('./factory/personas.ts')).cmdPersonaInstall(f),
}
// The commands of the four plugin modules (INBOX_COMMANDS, COST_COMMANDS, QUEUE_COMMANDS, WORKTYPE_COMMANDS), listed here so no
// module loads before its command runs. A key that is also a core command is never taken over: main refuses and names the keys.
// shadowedByTables (bin/factory/flags.ts) checks the modules' own tables from their source text, so it loads no module.
const PLUGIN_COMMANDS: Record<string, Cmd> = {
  escalate: async (f) => (await import('./inbox.ts')).INBOX_COMMANDS.escalate!(f),
  inbox: async (f) => (await import('./inbox.ts')).INBOX_COMMANDS.inbox!(f),
  // plan.ts registers the plan approval (onPlanApprove) that only a client's approve calls, so resolve loads it for that decision alone
  resolve: async (f) => { if (f.by === 'client' && f.decision === 'approve') void (await import('./factory/plan.ts')).cmdApprove; return (await import('./inbox.ts')).INBOX_COMMANDS.resolve!(f) },
  'mark-applied': async (f) => (await import('./inbox.ts')).INBOX_COMMANDS['mark-applied']!(f),
  cost: async (f) => (await import('./cost.ts')).COST_COMMANDS.cost!(f),
  intake: async (f) => (await import('./queue.ts')).QUEUE_COMMANDS.intake!(f),
  queue: async (f) => (await import('./queue.ts')).QUEUE_COMMANDS.queue!(f),
  'queue-next': async (f) => (await import('./queue.ts')).QUEUE_COMMANDS['queue-next']!(f),
  'queue-set': async (f) => (await import('./queue.ts')).QUEUE_COMMANDS['queue-set']!(f),
  unattended: async (f) => (await import('./queue.ts')).QUEUE_COMMANDS.unattended!(f),
  worktypes: async (f) => (await import('./worktypes.ts')).WORKTYPE_COMMANDS.worktypes!(f),
  'official-plugins': async (f) => (await import('./official-plugins.ts')).cmdOfficialPlugins(f),
}
const SHADOWED: string[] = []
const COMMANDS: Record<string, Cmd> = { ...CORE_COMMANDS }
for (const [k, fn] of Object.entries(PLUGIN_COMMANDS)) {
  if (Object.hasOwn(COMMANDS, k)) SHADOWED.push(k)
  else COMMANDS[k] = fn
}

// `decision-reply <id> ack|change [--note T]` takes two words before or among its flags: each word that is not a flag or a flag's
// value becomes the next of `names` as a flag.
function positionalsToFlags(argv: string[], names: string[]): string[] {
  const out: string[] = []
  let n = 0
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a.startsWith('--')) {
      out.push(a)
      const next = argv[i + 1]
      if (!a.includes('=') && next !== undefined && !next.startsWith('--')) out.push(argv[++i] as string)
    } else if (n < names.length) {
      out.push(`--${names[n++]}`, a)
    } else {
      out.push(a)
    }
  }
  return out
}

// A session that runs a state-changing command on a run dir named after another session has resumed that run: record it, so the cost
// meter sweeps its transcripts too (recordSession, sessionsOf in cost.ts). Claude Code sets CLAUDE_CODE_SESSION_ID in a Bash call's
// environment, and a subagent or Workflow inherits the parent session's id, whose transcripts hold the agents' too. Never fails the command.
// cost.ts is loaded only when a session id is set and --dir is absolute, so a command that records nothing never loads it.
async function attach(command: string, f: Flags): Promise<void> {
  const dir = typeof f.dir === 'string' ? f.dir : undefined
  const sid = process.env.CLAUDE_CODE_SESSION_ID
  if (!sid || dir === undefined || !path.isAbsolute(dir)) return
  try {
    const { ATTACH_COMMANDS, recordSession } = await import('./cost.ts')
    if (ATTACH_COMMANDS.includes(command)) recordSession(dir, sid, command)
  } catch {
    // a record that cannot be written leaves the meter as it was before 0.31.0: the run dir's own session only
  }
}

// Runs one command and returns what it printed and its exit code.
export async function main(argv: string[]): Promise<{ body: Obj; code: number }> {
  try {
    const [command, ...rest] = argv
    const shadowed = [...SHADOWED, ...shadowedByTables(Object.keys(CORE_COMMANDS)).filter((k) => !SHADOWED.includes(k))]
    if (shadowed.length > 0) throw refuse({ error: `a plugin command key shadows a core command: ${shadowed.join(', ')}` })
    const fn = command === undefined ? undefined : COMMANDS[command]
    if (fn === undefined) throw usage(`unknown command: ${command ?? '(none)'}; commands: ${Object.keys(COMMANDS).join(', ')}`)
    const argv2 = command === 'decision-reply' ? positionalsToFlags(rest, ['id', 'reply']) : command === 'resolve' || command === 'mark-applied' ? positionalsToFlags(rest, ['id']) : rest
    const flags = parseFlags(argv2)
    await attach(command as string, flags)
    return { body: await fn(flags), code: 0 }
  } catch (e) {
    if (e instanceof CliError) return { body: e.body, code: e.code }
    return { body: { error: e instanceof Error ? e.message : String(e) }, code: 2 }
  }
}

// gates runs some steps through main, so it gets main from here rather than importing this file.
export const gatesMain = async (argv: string[]): Promise<{ body: Obj; code: number }> => (await import('./factory/gates.ts')).gatesRun(argv, main)

const isMain = ((): boolean => {
  try {
    return process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
  } catch {
    return false
  }
})()
// The commands the command line runs itself, because they are async. Each loads only its own module, and the guard below names them
// as `argv[0] === 'cmd' ? await handler(...)` so a run of any other command does not reach them (testmap's `direct` commands).
const heavyCmd = async (a: string[]): Promise<{ body: Obj; code: number }> => (await import('./factory/heavy.ts')).heavyMain(a)
const heavyJobCmd = async (a: string[]): Promise<{ body: Obj; code: number }> => (await import('./factory/heavy.ts')).heavyJobMain(a)
const goalCheckCmd = async (a: string[]): Promise<{ body: Obj; code: number }> => (await import('./factory/decide.ts')).goalCheckMain(a)
const goalCheckJobCmd = async (a: string[]): Promise<{ body: Obj; code: number }> => (await import('./factory/decide.ts')).goalCheckJobMain(a)
if (isMain) {
  const { on, argv: plain0 } = takeStatusFlag(process.argv.slice(2))
  const { riders, argv: plain1 } = takeRiderFlags(plain0)
  const { admit: admitArgs, argv: plain } = await takeAdmitFlag(plain1)
  const { slug: reapSlug, argv } = takeReapFlag(plain)
  // an attach to a heavy job already running runs no fold
  const attach = argv[0] === 'heavy' && (await import('./factory/heavy.ts')).heavyAttaches(argv.slice(1))
  const first = reapSlug === null || attach ? null : await reapFirst(argv, reapSlug)
  const admitted = admitArgs === null || attach ? null : await admitFirst(argv, admitArgs)
  // 0.34.0 R-170: the fold riders (flags.ts takeRiderFlags); an attach runs none
  const riderFirst = attach ? {} : await runRidersFirst(riders, argv, main)
  const { body, code } = argv[0] === 'heavy' ? await heavyCmd(argv.slice(1)) : argv[0] === 'heavy-job' ? await heavyJobCmd(argv.slice(1)) : argv[0] === 'gates' ? await gatesMain(argv.slice(1)) : argv[0] === 'goal-check' ? await goalCheckCmd(argv.slice(1)) : argv[0] === 'goal-check-job' ? await goalCheckJobCmd(argv.slice(1)) : await main(argv)
  Object.assign(body, riderFirst)
  if (!attach) await runRidersAfter(riders, argv, body, code, main)
  if (first && !Array.isArray(first.reaped)) body.reapedFirst = first
  // an attach skipped the fold, so the caller must keep its reap due
  if (attach && reapSlug !== null) body.reapSkipped = true
  if (admitted) body.admittedFirst = admitted
  // persona-install refuses with one stderr line (and no stdout), not the JSON error object the other commands print
  if (argv[0] === 'persona-install' && code !== 0) process.stderr.write(`persona-install: ${typeof body.error === 'string' ? body.error : JSON.stringify(body)}\n`.replace(/\n(?=.)/g, ' '))
  else process.stdout.write(JSON.stringify(body) + '\n' + (on ? statusLine(body) + '\n' : ''))
  process.exitCode = code
}
