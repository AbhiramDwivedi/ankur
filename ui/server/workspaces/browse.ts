// The folder browser of the Open screen: lists the subfolders of one directory. Node built-ins only; nothing is written.
// A browser's own picker cannot give the server an absolute path, so the page walks the disk through this listing.
import { promises as fs, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export type BrowseError = 'relative' | 'missing' | 'notdir' | 'denied'

export interface DirEntry {
  name: string
  path: string
  /** The folder holds .git (a folder, or the .git file of a worktree or submodule). */
  git: boolean
}

export interface DirListing {
  path: string
  /** The folder above, or null at a root (on Windows, the drives are in `roots`). */
  parent: string | null
  /** This folder itself holds .git. */
  git: boolean
  entries: DirEntry[]
  /** On Windows, the drive roots that exist ("C:\\"); empty elsewhere. */
  roots: string[]
  /** The path separator of the server's platform, so the page can word paths the way the disk does. */
  sep: string
  home: string
  /** More subfolders than MAX_ENTRIES: the list stops there. */
  truncated: boolean
}

/** At most this many subfolders are listed (and checked for .git). */
export const MAX_ENTRIES = 500

export interface BrowseDeps {
  platform?: NodeJS.Platform
  home?: string
  /** Whether a path exists; the drive scan uses it. */
  exists?: (p: string) => Promise<boolean>
}

const existsOnDisk = async (p: string): Promise<boolean> => {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

/** The folder above `dir`, or null when `dir` is a root ("/", "C:\\", "\\\\server\\share\\"). */
export function parentOf(dir: string, platform: NodeJS.Platform = process.platform): string | null {
  const p = platform === 'win32' ? path.win32 : path.posix
  const up = p.dirname(dir)
  return up === dir || p.parse(dir).root === dir ? null : up
}

/** The drive roots of a Windows machine that exist, in letter order. Empty on any other platform. */
export async function driveRoots(platform: NodeJS.Platform = process.platform, exists: (p: string) => Promise<boolean> = existsOnDisk): Promise<string[]> {
  if (platform !== 'win32') return []
  const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i) + ':\\')
  const found = await Promise.all(letters.map(async (l) => ((await exists(l)) ? l : null)))
  return found.filter((l): l is string => l !== null)
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

async function isDir(full: string, d: Dirent): Promise<boolean> {
  if (d.isDirectory()) return true
  if (!d.isSymbolicLink()) return false
  try {
    return (await fs.stat(full)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Lists the subfolders of `typed` (the home folder when it is empty or absent), sorted by name. Folders whose name
 * starts with a dot are left out unless `hidden`; `.git` itself is never listed, but each entry says whether it holds one.
 */
export async function listDirs(typed: unknown, hidden = false, deps: BrowseDeps = {}): Promise<{ ok: true; listing: DirListing } | { ok: false; error: BrowseError }> {
  const platform = deps.platform ?? process.platform
  const home = deps.home ?? homedir()
  const exists = deps.exists ?? existsOnDisk
  const p = platform === 'win32' ? path.win32 : path.posix
  const raw = typeof typed === 'string' ? typed.trim() : ''
  const tilde = platform === 'win32' ? /^~[\\/]/ : /^~\//
  const given = raw === '' || raw === '~' ? home : tilde.test(raw) ? p.join(home, raw.slice(2)) : raw
  if (!p.isAbsolute(given)) return { ok: false, error: 'relative' }
  // A bare drive ("C:") is that drive's root, not its current folder.
  const dir = p.resolve(platform === 'win32' && /^[A-Za-z]:$/.test(given) ? given + '\\' : given)
  let dirents: Dirent[]
  try {
    if (!(await fs.stat(dir)).isDirectory()) return { ok: false, error: 'notdir' }
    dirents = await fs.readdir(dir, { withFileTypes: true })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    return { ok: false, error: code === 'EACCES' || code === 'EPERM' ? 'denied' : 'missing' }
  }
  const names = dirents
    .filter((d) => d.name !== '.git' && (hidden || !d.name.startsWith('.')))
    .sort((a, b) => byName(a.name, b.name))
  const folders: Dirent[] = []
  for (const d of names) {
    if (folders.length > MAX_ENTRIES) break
    if (await isDir(p.join(dir, d.name), d)) folders.push(d)
  }
  const truncated = folders.length > MAX_ENTRIES
  const shown = folders.slice(0, MAX_ENTRIES)
  const entries = await Promise.all(
    shown.map(async (d) => {
      const full = p.join(dir, d.name)
      return { name: d.name, path: full, git: await exists(p.join(full, '.git')) }
    }),
  )
  return {
    ok: true,
    listing: {
      path: dir,
      parent: parentOf(dir, platform),
      git: await exists(p.join(dir, '.git')),
      entries,
      roots: await driveRoots(platform, exists),
      sep: p.sep,
      home,
      truncated,
    },
  }
}
