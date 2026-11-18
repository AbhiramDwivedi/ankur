// ankur-allow-truss: this module is where the UI's old-name fallbacks live.
// The UI's copy of the lookup rules in plugins/ankur/bin/names.ts (the UI is a standalone reader and does not import plugin code at
// run time): the project config is .claude/ankur.json, else .claude/truss.json; the run dir is <git common dir>/ankur, else // ankur-allow-truss
// <git common dir>/truss. The UI reads no ANKUR_*/TRUSS_* environment variable, so no env fallback is needed here. // ankur-allow-truss
// Read-only: it only checks which path exists. Paths are built with path.join, so they are right on macOS and Windows.
import fs from 'node:fs'
import path from 'node:path'

const NEW = 'ankur'
const OLD = 'truss' // ankur-allow-truss

// .claude/ankur.json when present, else .claude/truss.json when present, else the new path. // ankur-allow-truss
export function resolveConfigPath(repo: string): string {
  const fresh = path.join(repo, '.claude', `${NEW}.json`)
  if (fs.existsSync(fresh)) return fresh
  const old = path.join(repo, '.claude', `${OLD}.json`) // ankur-allow-truss
  return fs.existsSync(old) ? old : fresh
}

// <common>/ankur when present, else <common>/truss when present, else <common>/ankur. // ankur-allow-truss
export function resolveRunDir(commonDir: string): string {
  const fresh = path.join(commonDir, NEW)
  if (fs.existsSync(fresh)) return fresh
  const old = path.join(commonDir, OLD) // ankur-allow-truss
  return fs.existsSync(old) ? old : fresh
}

// An agent type recorded before the rename is `truss:<role>`; it reads as `ankur:<role>` so every later match sees one name. // ankur-allow-truss
export function agentTypeOf(type: string | null): string | null {
  return type !== null && type.startsWith(`${OLD}:`) ? `${NEW}:${type.slice(OLD.length + 1)}` : type // ankur-allow-truss
}
