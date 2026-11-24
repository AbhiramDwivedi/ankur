// The terminal command that resumes a Claude Code session in its repository. No imports: it runs under plain
// `node --test`. The shell is read off the repository path, which is the server's own path (the server and the
// terminal are on one machine): a drive letter or a \\ share is Windows (PowerShell), anything else POSIX.

export type Shell = 'posix' | 'powershell'

export const shellOf = (repo: string): Shell => (/^[A-Za-z]:[\\/]/.test(repo) || repo.startsWith('\\\\') ? 'powershell' : 'posix')

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/

/** One POSIX word: bare when it has only safe characters, else in single quotes with each ' written '\''. */
export function posixQuote(s: string): string {
  return SAFE.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

/** One PowerShell literal: single-quoted; ' and the typographic single quotes PowerShell also reads as quotes are doubled. */
export function powershellQuote(s: string): string {
  return `'${s.replace(/['‘’‚‛]/g, (c) => c + c)}'`
}

/** `cd <repo> && claude --resume <id>`, or on Windows `Set-Location '<repo>'; claude --resume <id>`. */
export function resumeCommand(repo: string, sessionId: string, shell: Shell = shellOf(repo)): string {
  return shell === 'powershell'
    ? `Set-Location ${powershellQuote(repo)}; claude --resume ${SAFE.test(sessionId) ? sessionId : powershellQuote(sessionId)}`
    : `cd ${posixQuote(repo)} && claude --resume ${posixQuote(sessionId)}`
}
