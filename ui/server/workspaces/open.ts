// Path checks for opening a workspace. Node built-ins only; nothing is written.
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export type OpenError = 'path' | 'relative' | 'missing' | 'notgit' | 'timeout'
export type GitRun = (args: string[], cwd: string) => Promise<{ code: number; stdout: string }>

export const GIT_TIMEOUT_MS = 10_000

/** A rejection with this code from a GitRun means git did not answer in time. */
export const TIMEOUT_CODE = 'ETIMEDOUT'

/** git, with a 10 s timeout. A non-zero exit resolves with its code; a timeout rejects with code ETIMEDOUT. */
export const runGit: GitRun = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      if (!err) return resolve({ code: 0, stdout })
      const e = err as NodeJS.ErrnoException & { killed?: boolean }
      if (e.killed) return reject(Object.assign(new Error('git timed out'), { code: TIMEOUT_CODE }))
      resolve({ code: typeof e.code === 'number' ? e.code : 1, stdout: '' })
    })
  })

/** A leading ~ or ~/ (or ~\ on Windows) means the home directory. */
export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || (path.sep === '\\' && p.startsWith('~\\'))) return path.join(homedir(), p.slice(2))
  return p
}

const settled = <T>(p: Promise<T>, ms: number): Promise<{ value: T } | 'timeout'> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), ms)
    p.then(
      (value) => { clearTimeout(timer); resolve({ value }) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })

/**
 * Checks `typed` in order and returns the realpath of its git toplevel, or the named error.
 * The 10 s limit is also enforced here, so an injected git that hangs ends in 'timeout'.
 */
export async function checkRepoPath(typed: unknown, git: GitRun = runGit): Promise<{ ok: true; path: string } | { ok: false; error: OpenError }> {
  if (typeof typed !== 'string' || typed.trim() === '') return { ok: false, error: 'path' }
  const given = expandHome(typed.trim())
  if (!path.isAbsolute(given)) return { ok: false, error: 'relative' }
  try {
    if (!(await fs.stat(given)).isDirectory()) return { ok: false, error: 'missing' }
  } catch {
    return { ok: false, error: 'missing' }
  }
  let out: { code: number; stdout: string }
  try {
    const r = await settled(git(['-C', given, 'rev-parse', '--show-toplevel'], given), GIT_TIMEOUT_MS)
    if (r === 'timeout') return { ok: false, error: 'timeout' }
    out = r.value
  } catch (e) {
    return { ok: false, error: (e as NodeJS.ErrnoException)?.code === TIMEOUT_CODE ? 'timeout' : 'notgit' }
  }
  const top = out.stdout.trim()
  if (out.code !== 0 || top === '') return { ok: false, error: 'notgit' }
  try {
    return { ok: true, path: await fs.realpath(top) }
  } catch {
    return { ok: false, error: 'missing' }
  }
}
