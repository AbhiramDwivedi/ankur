// `factory audit-checks --repo <repo>`: reads the repo's tracked lockfiles and proposes the stack's own dependency audit
// as a static check, naming the lockfile each came from. Read-only: it never runs an audit, never touches the network and
// never writes a file. The set-up skill shows the proposals and writes `staticChecks` only on the client's approval.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { flat, git, need, usage } from './core.ts'
import type { Flags, Obj } from './core.ts'

export type AuditCheck = { name: string; run: string; from: string; note?: string }
export type AuditResult = { ok: true; checks: AuditCheck[]; notes: string[] }

// `skip` is the reason no check is proposed; the caller prefixes the lockfile path.
type Proposal = { tool: string; run: string; note?: string } | { skip: string }

// Where a lockfile sits, with every repo path already single-quoted for bash (the static gate runs each check through bash).
// `cd` is the prefix that enters the lockfile's folder ('' at the repo root); `lockfile` is its repo path as one shell word.
type At = { root: boolean; cd: string; lockfile: string }

// The only way a path taken from the repo enters a run: one single-quoted bash word. A path holding a single quote cannot be
// written that way, so it yields undefined and the lockfile gets no check.
function shq(p: string): string | undefined {
  return p.includes("'") ? undefined : `'${p}'`
}

// One row per lockfile name: the stack's own audit command. Flags are the ones the tool's docs list (ADR on the audit proposal);
// none rewrites a file. A row gets only quoted paths, never the raw ones. `lock` is the lockfile text, read only to tell yarn
// classic from yarn berry.
const LOCKFILES: Record<string, (at: At, lock: () => string) => Proposal> = {
  'package-lock.json': (at) => ({ tool: 'npm', run: `${at.cd}npm audit` }),
  'pnpm-lock.yaml': (at) => ({ tool: 'pnpm', run: `${at.cd}pnpm audit` }),
  'yarn.lock': (at, lock) => {
    // Yarn Berry has no flag to run in another folder, so only a root yarn.lock gets a check.
    if (!at.root) return { skip: 'yarn has no documented way to audit another folder, so no check is proposed for it.' }
    const berry = /^__metadata:/m.test(lock())
    return { tool: 'yarn', run: berry ? 'yarn npm audit --all --recursive' : 'yarn audit' }
  },
  'Cargo.lock': (at) => ({
    tool: 'cargo',
    run: `cargo audit --file ${at.lockfile}`,
    note: 'cargo-audit must be installed first (cargo install cargo-audit); without it this check cannot start.',
  }),
}

const NPM_STACK = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
const DEP_KEYS = ['dependencies', 'devDependencies', 'optionalDependencies']

// The quoted paths of a lockfile, or undefined when its folder or name cannot be quoted.
function quotedAt(file: string, dir: string): At | undefined {
  const lockfile = shq(file)
  const qdir = dir === '' ? '' : shq(dir)
  if (lockfile === undefined || qdir === undefined) return undefined
  return { root: dir === '', cd: dir === '' ? '' : `cd ${qdir} && `, lockfile }
}
const dirOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '')
const baseOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1)

function trackedFiles(repo: string): string[] {
  const r = git(repo, ['ls-files', '-z', '--full-name'])
  if (r.status !== 0) throw usage(`git ls-files failed in ${flat(repo)}: ${r.err}`)
  return r.out.split('\0').filter((f) => f !== '').map(flat)
}

// A name the staticChecks key accepts (lower-case letters, digits, dashes, at most 64), unique among `taken`.
function nameFor(tool: string, dir: string, taken: Set<string>): string {
  const slug = `audit-${tool}${dir === '' ? '' : `-${dir}`}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 60).replace(/-+$/, '')
  let name = slug
  for (let n = 2; taken.has(name); n++) name = `${slug}-${n}`
  taken.add(name)
  return name
}

// True when the package.json text declares any dependency; an unreadable or malformed file is named in the notes.
function hasDependencies(repo: string, file: string, notes: string[]): boolean {
  let pkg: Obj
  try {
    pkg = JSON.parse(readFileSync(path.join(repo, file), 'utf8').replace(/^﻿/, '')) as Obj
  } catch (e) {
    notes.push(`${file}: cannot read it as JSON (${(e as Error).message}), so it is not checked for dependencies.`)
    return false
  }
  return DEP_KEYS.some((k) => pkg !== null && typeof pkg[k] === 'object' && pkg[k] !== null && Object.keys(pkg[k]).length > 0)
}

export function auditChecks(repo: string): AuditResult {
  const files = trackedFiles(repo)
  const checks: AuditCheck[] = []
  const notes: string[] = []
  const taken = new Set<string>()
  for (const file of files) {
    const make = LOCKFILES[baseOf(file)]
    if (!make) continue
    const dir = dirOf(file)
    const at = quotedAt(file, dir)
    if (at === undefined) {
      notes.push(`${file}: the path holds a quote mark, so no check is proposed for ${dir === '' ? 'it' : `the folder ${dir}`}.`)
      continue
    }
    const p = make(at, () => readFileSync(path.join(repo, file), 'utf8'))
    if ('skip' in p) {
      notes.push(`${file}: ${p.skip}`)
      continue
    }
    checks.push({ name: nameFor(p.tool, dir, taken), run: p.run, from: file, ...(p.note ? { note: p.note } : {}) })
    if (p.note) notes.push(`${file}: ${p.note}`)
  }
  for (const file of files) {
    if (baseOf(file) !== 'package.json') continue
    const dir = dirOf(file)
    if (NPM_STACK.some((l) => files.includes(dir === '' ? l : `${dir}/${l}`))) continue
    if (hasDependencies(repo, file, notes)) {
      notes.push(`${file} declares dependencies but no lockfile of the repo tracks them (package-lock.json, pnpm-lock.yaml or yarn.lock), so no audit is proposed for it; commit a lockfile to get one.`)
    }
  }
  return { ok: true, checks, notes }
}

export function cmdAuditChecks(f: Flags): Obj {
  return auditChecks(need(f, 'repo'))
}
