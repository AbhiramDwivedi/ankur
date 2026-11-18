// `factory official-plugins [--config-dir D]`: lists Anthropic's own plugins from the official marketplace installed on this machine
// and marks each installed or not. Read-only: it never writes, installs or touches the network, and a missing or unreadable
// catalog gives an empty list and a one-line note, never a failure.
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { str } from './core.ts'
import type { Flags, Obj } from './core.ts'

export const OFFICIAL_MARKETPLACE = 'claude-plugins-official'
export const OFFICIAL_AUTHOR = 'Anthropic'

export type OfficialPlugin = { name: string; author: string; installed: boolean }

// The flag, else CLAUDE_CONFIG_DIR (an empty value counts as unset), else <home>/.claude.
export function configDirOf(flag: string | undefined, env: Record<string, string | undefined> = process.env, home: string = os.homedir()): string {
  if (flag !== undefined && flag !== '') return flag
  const e = env.CLAUDE_CONFIG_DIR
  if (e) return e
  return path.join(home, '.claude')
}

const readJsonFile = (p: string): Obj => JSON.parse(readFileSync(p, 'utf8')) as Obj

export function officialPlugins(configDir: string): { ok: true; plugins: OfficialPlugin[]; note?: string } {
  const catalogPath = path.join(configDir, 'plugins', 'marketplaces', OFFICIAL_MARKETPLACE, '.claude-plugin', 'marketplace.json')
  let entries: unknown[]
  try {
    const cat = readJsonFile(catalogPath)
    if (!Array.isArray(cat.plugins)) throw new Error('no plugins array')
    entries = cat.plugins
  } catch {
    return { ok: true, plugins: [], note: `The ${OFFICIAL_MARKETPLACE} marketplace is not installed or not readable under the Claude config dir, so no official plugins are listed.` }
  }
  let installedKeys = new Set<string>()
  try {
    const inst = readJsonFile(path.join(configDir, 'plugins', 'installed_plugins.json'))
    if (inst.plugins && typeof inst.plugins === 'object') installedKeys = new Set(Object.keys(inst.plugins))
  } catch { /* nothing recorded as installed */ }
  const plugins: OfficialPlugin[] = []
  for (const e of entries as Obj[]) {
    if (!e || typeof e !== 'object' || typeof e.name !== 'string') continue
    if (e.author?.name !== OFFICIAL_AUTHOR) continue
    plugins.push({ name: e.name, author: OFFICIAL_AUTHOR, installed: installedKeys.has(`${e.name}@${OFFICIAL_MARKETPLACE}`) })
  }
  return { ok: true, plugins }
}

export function cmdOfficialPlugins(f: Flags): Obj {
  return officialPlugins(configDirOf(str(f, 'config-dir')))
}
