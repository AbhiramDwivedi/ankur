// ankur-allow-truss: this module is where the old name lives.
// The pure half of bin/names.ts: names and string rules with no import at all, so the hooks module (which may import only
// relative files and "claude-code") can use it. bin/names.ts re-exports all of it and adds the file and env lookups.
export const NEW = 'ankur'
export const OLD = 'truss' // ankur-allow-truss
export const OLD_PREFIX = 'TRUSS_' // ankur-allow-truss

// An agent type is `<plugin>:<role>`. The role of `ankur:<role>`, or of the pre-0.36.0 `truss:<role>`; undefined for any other type. // ankur-allow-truss
export function roleOf(agentType: unknown): string | undefined {
  if (typeof agentType !== 'string') return undefined
  for (const prefix of [`${NEW}:`, `${OLD}:`]) { // ankur-allow-truss
    if (agentType.startsWith(prefix) && agentType.length > prefix.length) return agentType.slice(prefix.length)
  }
  return undefined
}
// The type with the old prefix swapped for the new one, so a check written against `ankur:<role>` holds for a recorded `truss:<role>`. Anything else comes back as is. // ankur-allow-truss
export function currentType<T>(agentType: T): T | string {
  const role = roleOf(agentType)
  return role === undefined ? agentType : `${NEW}:${role}`
}
// The names a crew's worktree dir and branch can have: ankur-<slug> for a crew started now, truss-<slug> for one started under 0.35.0 or older. // ankur-allow-truss
export const CREW_NAME_PREFIXES = [`${NEW}-`, `${OLD}-`] // ankur-allow-truss

// The run dir name inside the git common dir, given whether each exists: ankur when present, else truss when present, else ankur. // ankur-allow-truss
export function runDirName(freshExists: boolean, oldExists: boolean): string {
  return !freshExists && oldExists ? OLD : NEW
}
