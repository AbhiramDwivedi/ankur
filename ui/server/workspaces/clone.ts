// Clone a repository for the Open screen: git clone <url> into <parent>/<name>, then the registry opens it.
// Node built-ins only. git runs through execFile with an argument array, never a shell.
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export type CloneError =
  | 'url' // not a clone URL this screen takes
  | 'relative' // the parent folder is not a full path
  | 'parent' // the parent folder does not exist or is not a folder
  | 'exists' // <parent>/<name> exists and is not an empty folder
  | 'auth' // the host refused the credentials, or asked for some
  | 'notfound' // no such repository (or no access to it)
  | 'network' // the host could not be reached
  | 'timeout' // git did not finish within CLONE_TIMEOUT_MS
  | 'nogit' // git is not installed
  | 'git' // any other git failure

/** A clone may take minutes; the open check's 10 s would cut most real ones short. */
export const CLONE_TIMEOUT_MS = 5 * 60_000

export interface CloneRunResult {
  code: number
  stderr: string
  timedOut: boolean
  /** git itself could not be started (ENOENT). */
  missing?: boolean
}
export type CloneRun = (args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<CloneRunResult>

/** git with no prompt on stdin: a host that wants a password fails at once instead of hanging until the timeout. */
export const runClone: CloneRun = (args, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
      },
      (err, _stdout, stderr) => {
        if (!err) return resolve({ code: 0, stderr, timedOut: false })
        const e = err as NodeJS.ErrnoException & { killed?: boolean }
        if (e.code === 'ENOENT') return resolve({ code: 127, stderr, timedOut: false, missing: true })
        resolve({ code: typeof e.code === 'number' ? e.code : 1, stderr: String(stderr ?? ''), timedOut: e.killed === true })
      },
    )
  })

// https://host/owner/repo(.git), http://, ssh://, git://, and the scp form user@host:owner/repo(.git).
const URL_FORMS = /^(?:(?:https?|ssh|git):\/\/[^\s/]+\/\S+|[\w.-]+@[\w.-]+:(?!\/\/)\S+)$/

/**
 * The folder name a clone of `url` gets, or null when the URL is refused: empty, starting with "-" (an option to git),
 * a remote-helper transport such as ext:: or file::, a local path, or any form other than URL_FORMS.
 */
export function repoNameOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const u = url.trim()
  if (u === '' || u.startsWith('-') || /::/.test(u) || /[\0\r\n]/.test(u) || !URL_FORMS.test(u)) return null
  const tail = u.replace(/[?#].*$/, '').replace(/[\\/]+$/, '').split(/[/:]/).pop() ?? ''
  const name = tail.replace(/\.git$/i, '')
  if (name === '' || name === '.' || name === '..' || !/^[\w.-]+$/.test(name) || name.startsWith('-')) return null
  return name
}

/** ~/code when it is a folder, else the home folder. */
export async function defaultCloneParent(home: string = homedir()): Promise<string> {
  const code = path.join(home, 'code')
  try {
    if ((await fs.stat(code)).isDirectory()) return code
  } catch {
    // no ~/code
  }
  return home
}

/** Which refusal a failed clone's stderr names. Auth is checked first: a refused ssh key also says it could not read from the remote. */
export function cloneFailureOf(stderr: string): Extract<CloneError, 'auth' | 'notfound' | 'network' | 'git'> {
  const s = stderr.toLowerCase()
  if (/authentication failed|could not read username|could not read password|terminal prompts disabled|permission denied|invalid username or password|access denied|http(?:\s+status)?\s*40[13]\b|the requested url returned error: 40[13]|host key verification failed/.test(s)) return 'auth'
  if (/repository not found|not found|does not exist|does not appear to be a git repository|the requested url returned error: 404/.test(s)) return 'notfound'
  if (/could not resolve host|could not resolve hostname|failed to connect|connection refused|connection timed out|operation timed out|network is unreachable|no route to host|unable to access|ssl|tls|connection reset|early eof|the remote end hung up/.test(s)) return 'network'
  return 'git'
}

export interface CloneDeps {
  git?: CloneRun
  home?: string
  timeoutMs?: number
}

const inFlight = new Set<string>()

/**
 * Checks the URL and the parent folder, then clones into <parent>/<name>. Refuses a target that exists and is not an
 * empty folder. A failed clone leaves no folder behind that it made itself.
 */
export async function cloneRepo(url: unknown, parentTyped: unknown, deps: CloneDeps = {}): Promise<{ ok: true; path: string } | { ok: false; error: CloneError; target?: string }> {
  const name = repoNameOf(url)
  if (name === null) return { ok: false, error: 'url' }
  const home = deps.home ?? homedir()
  const raw = typeof parentTyped === 'string' ? parentTyped.trim() : ''
  const parent = raw === '' ? await defaultCloneParent(home) : raw === '~' ? home : /^~[\\/]/.test(raw) ? path.join(home, raw.slice(2)) : raw
  if (!path.isAbsolute(parent)) return { ok: false, error: 'relative' }
  try {
    if (!(await fs.stat(parent)).isDirectory()) return { ok: false, error: 'parent' }
  } catch {
    return { ok: false, error: 'parent' }
  }
  const target = path.join(path.resolve(parent), name)
  let made = true
  try {
    const st = await fs.stat(target)
    if (!st.isDirectory() || (await fs.readdir(target)).length > 0) return { ok: false, error: 'exists', target }
    made = false // an empty folder the client made: git clones into it, and it stays if the clone fails
  } catch {
    // no such path: git makes it
  }
  if (inFlight.has(target)) return { ok: false, error: 'exists', target }
  inFlight.add(target)
  try {
    const args = ['-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never', 'clone', '--quiet', '--', String(url).trim(), target]
    const r = await (deps.git ?? runClone)(args, { cwd: parent, timeoutMs: deps.timeoutMs ?? CLONE_TIMEOUT_MS })
    if (r.code === 0 && !r.timedOut) return { ok: true, path: target }
    if (made) await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    if (r.missing) return { ok: false, error: 'nogit', target }
    if (r.timedOut) return { ok: false, error: 'timeout', target }
    return { ok: false, error: cloneFailureOf(r.stderr), target }
  } finally {
    inFlight.delete(target)
  }
}
