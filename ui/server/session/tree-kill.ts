// End a Claude Code process tree. UI-side copies of killGroup and treeKill in
// plugins/ankur/resources/index.ts: the UI may not import plugin code. Node built-ins only.
import { spawnSync } from 'node:child_process'

export interface TreeKillDeps {
  platform?: NodeJS.Platform
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void // process.kill; a negative pid names a process group
  treeKill?: (pid: number) => void // win32: taskkill /pid <pid> /T /F
  graceMs?: number // POSIX: how long the group may take to end after SIGTERM before SIGKILL
  pollMs?: number
}

export const TERM_GRACE_MS = 2000
export const TERM_POLL_MS = 100

/** win32: `taskkill /pid <pid> /T /F` stops the pid and every process it started. */
export function winTreeKill(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 1) return
  try {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  } catch {
    // taskkill missing or already gone: the process is not ours to chase further
  }
}

const gone = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ESRCH'

/**
 * Ends the process `pid` leads and everything in its group. The child was spawned detached on POSIX, so its pid is its
 * group id. POSIX: SIGTERM to the group, a check every pollMs for up to graceMs whether the group is still alive, then
 * SIGKILL to the group. win32: taskkill /T /F. A group that is already gone (ESRCH) counts as ended.
 */
export async function endTree(pid: number, deps: TreeKillDeps = {}): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 1) return
  const platform = deps.platform ?? process.platform
  if (platform === 'win32') {
    (deps.treeKill ?? winTreeKill)(pid)
    return
  }
  const kill = deps.kill ?? ((p: number, s: NodeJS.Signals | 0) => void process.kill(p, s))
  const graceMs = deps.graceMs ?? TERM_GRACE_MS
  const pollMs = deps.pollMs ?? TERM_POLL_MS
  try {
    kill(-pid, 'SIGTERM')
  } catch (e) {
    if (gone(e)) return
  }
  const end = Date.now() + graceMs
  while (Date.now() < end) {
    try {
      kill(-pid, 0)
    } catch {
      return // ESRCH: no member left
    }
    await new Promise<void>((r) => setTimeout(r, pollMs))
  }
  try {
    kill(-pid, 'SIGKILL')
  } catch {
    // already gone
  }
}
