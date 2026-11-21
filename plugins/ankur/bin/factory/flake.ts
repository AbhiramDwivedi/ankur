// 0.33.0 item 4: a flake costs a re-run, not a fix round. When the full suite fails, the failing test files named in its
// node --test spec-reporter output are re-run once on the same head. A pass is logged as one `flake` event per flaked test (never
// dropped); a failure, or output that names no file, is left to the caller to charge a fix round as before. Leaf: imports only
// ../core.ts and ./log.ts, never factory.ts.
import { flat } from '../core.ts'
import { appendEvent } from './log.ts'

export type FailedTest = { file: string; name: string }
export type RerunInput = {
  dir: string
  slug: string
  cwd: string
  head: string
  output: string
  run: (files: string[]) => { exit: number; text: string }
}
export type RerunResult = { passed: boolean; reran: string[]; flakes: FailedTest[]; text: string }

// `test at <file>:<line>:<col>` then, on the next non-blank line, `✖ <name> (<n>ms)`. One entry per distinct file, first name kept.
export function failedTests(output: string): FailedTest[] {
  const lines = output.split(/\r?\n/)
  const out: FailedTest[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*test at (.+?):\d+:\d+\s*$/.exec(lines[i])
    if (m === null) continue
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    const n = j < lines.length ? /^\s*✖ (.*?)(?: \([0-9.]+ms\))?\s*$/.exec(lines[j]) : null
    if (n === null) continue
    const file = flat(m[1])
    if (!out.some((t) => t.file === file)) out.push({ file, name: n[1] })
  }
  return out
}

// How many failed tests the output names: each `test at <file>:<l>:<c>` followed by a `✖ <name>` line, one per test (failedTests keeps
// one per file).
function namedCount(output: string): number {
  const lines = output.split(/\r?\n/)
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*test at .+?:\d+:\d+\s*$/.test(lines[i])) continue
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    if (j < lines.length && /^\s*✖ /.test(lines[j])) n++
  }
  return n
}

// Fail closed (fix round 3): the named failures must be the whole failure. The output must carry node's `ℹ fail N` summary and N must
// equal the number of tests the output names. A step with no summary is unproved and the caller charges the round.
export function namedAreWholeFailure(output: string): boolean {
  const sums = [...output.matchAll(/^\s*ℹ fail (\d+)\s*$/gm)]
  if (sums.length === 0) return false
  return Number(sums[sums.length - 1][1]) === namedCount(output)
}

// The re-run allowlist (fix round 4): a step is `node --test` followed only by plain file or glob arguments. No argument may start
// with `-` (a flag), and none may hold a quote or shell operator. Only a suite made wholly of such steps gets a re-run.
export function isPlainNodeTestStep(step: string): boolean {
  const w = step.trim().split(/\s+/)
  return w.length >= 3 && w[0] === 'node' && w[1] === '--test' && w.slice(2).every((a) => !a.startsWith('-') && /^[A-Za-z0-9._*\/:-]+$/.test(a))
}

export function rerunFailedFiles(input: RerunInput): RerunResult {
  const failed = failedTests(input.output)
  if (failed.length === 0 || !namedAreWholeFailure(input.output)) return { passed: false, reran: [], flakes: [], text: input.output }
  const files = failed.map((t) => t.file)
  const t0 = Date.now()
  const r = input.run(files)
  const ms = Math.max(0, Math.round(Date.now() - t0))
  if (r.exit !== 0) return { passed: false, reran: files, flakes: [], text: r.text }
  for (const t of failed) appendEvent(input.dir, { event: 'flake', crew: input.slug, file: t.file, name: t.name, head: input.head, ms })
  return { passed: true, reran: files, flakes: failed, text: r.text }
}
