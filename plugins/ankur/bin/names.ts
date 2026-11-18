// ankur-allow-truss: this module is where the old name lives.
// The one place that knows both the new names (ankur) and the old ones (the old name), for the 0.36.0 rename (R-190). Every lookup of a
// config file, a run dir or an env var goes through here, so a project set up under the old name keeps working for one release.
// Leaf module: Node built-ins only, imports no other bin module. Paths come back as path.join builds them; callers pass them through flat().
import { existsSync } from 'node:fs'
import path from 'node:path'
import { NEW, OLD, OLD_PREFIX } from './names-pure.ts'

// The project config: .claude/ankur.json when present, else .claude/truss.json when present, else the new path (the one to write). // ankur-allow-truss
export function resolveConfigPath(repo: string): string {
  const fresh = path.join(repo, '.claude', `${NEW}.json`)
  if (existsSync(fresh)) return fresh
  const old = path.join(repo, '.claude', `${OLD}.json`) // ankur-allow-truss
  return existsSync(old) ? old : fresh
}

// The run dir inside the git common dir: <common>/ankur when present, else <common>/truss when present, else <common>/ankur. // ankur-allow-truss
export function resolveRunDir(commonDir: string): string {
  const fresh = path.join(commonDir, NEW)
  if (existsSync(fresh)) return fresh
  const old = path.join(commonDir, OLD) // ankur-allow-truss
  return existsSync(old) ? old : fresh
}

// The pure rules (roleOf, currentType, CREW_NAME_PREFIXES) live in names-pure.ts, which the hooks module can import; re-exported for bin callers.
export { CREW_NAME_PREFIXES, currentType, roleOf } from './names-pure.ts'

const noted = new Set<string>()
const toStderr = (line: string): void => void process.stderr.write(line)

// ANKUR_<suffix>, else the old TRUSS_<suffix> with one deprecation line on stderr per variable per process. // ankur-allow-truss
export function readEnv(suffix: string, env: Record<string, string | undefined> = process.env, stderr: (line: string) => void = toStderr): string | undefined {
  const fresh = env[`ANKUR_${suffix}`]
  if (fresh !== undefined) return fresh
  const oldName = `${OLD_PREFIX}${suffix}` // ankur-allow-truss
  const old = env[oldName]
  if (old === undefined) return undefined
  if (!noted.has(oldName)) {
    noted.add(oldName)
    stderr(`ankur: ${oldName} is deprecated and will stop working in the next release; set ANKUR_${suffix} instead\n`)
  }
  return old
}
