// The folder browser of the Open screen (S2): a dialog over GET /api/fs/dirs. A browser's own folder picker cannot
// give the server an absolute path, so the server lists the disk and the client walks it here. Enter or a click on a
// folder goes into it; "Up" goes to the folder above; on Windows the drives are at the top. Esc closes.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { ArrowUp, Folder, GitBranch, HardDrive, X } from 'lucide-react'
import type { DirListing, DirsResult } from '../../store/types.ts'
import { listDirs } from '../../store/api.ts'
import { Badge } from '../../components/ui/badge.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Checkbox } from '../../components/ui/checkbox.tsx'
import { EXPIRED_LINK } from './WorkspaceRail.tsx'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Why a folder could not be listed, in one line. */
export function browseErrorWords(r: Extract<DirsResult, { ok: false }>, path: string): string {
  if (r.status === 401 || r.status === 403) return EXPIRED_LINK
  const where = path === '' ? 'your home folder' : path
  switch (r.error) {
    case 'relative':
      return `Use a full path: ${where}. Relative paths are refused.`
    case 'missing':
      return `No such folder: ${where}.`
    case 'notdir':
      return `Not a folder: ${where}.`
    case 'denied':
      return `No permission to read ${where}.`
    case 'timeout':
    case 'network':
      return 'No answer from the ankur server. Check the terminal it runs in.'
    default:
      return `Could not list ${where}: ${r.error}.`
  }
}

const rowClass =
  'flex min-h-9 w-full min-w-0 items-center gap-2 rounded-control px-2 py-1 text-left text-ui text-fg hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus pointer-coarse:min-h-11'

/** The rows of one listing: the drives (Windows), Up (not at a root), then each subfolder with a git mark. Each row is a button. */
export function FolderList({ listing, onGo, ref }: { listing: DirListing; onGo: (path: string) => void; ref?: Ref<HTMLUListElement> }) {
  return (
    <ul ref={ref} aria-label={`Folders in ${listing.path}`} className="flex min-w-0 flex-col">
      {listing.roots.map((root) => (
        <li key={`drive-${root}`}>
          <button type="button" className={rowClass} onClick={() => onGo(root)} aria-current={root === listing.path ? 'location' : undefined}>
            <HardDrive aria-hidden="true" className="size-4 shrink-0 text-muted" />
            <span className="min-w-0 truncate font-mono">{root}</span>
            <span className="text-meta text-muted">Drive</span>
          </button>
        </li>
      ))}
      {listing.parent !== null && (
        <li>
          <button type="button" className={rowClass} onClick={() => onGo(listing.parent!)}>
            <ArrowUp aria-hidden="true" className="size-4 shrink-0 text-muted" />
            <span className="min-w-0 truncate">Up</span>
            <span className="min-w-0 truncate font-mono text-meta text-muted">{listing.parent}</span>
          </button>
        </li>
      )}
      {listing.entries.map((d) => (
        <li key={d.path}>
          <button type="button" className={rowClass} onClick={() => onGo(d.path)} title={d.path}>
            {d.git ? <GitBranch aria-hidden="true" className="size-4 shrink-0 text-brand-strong" /> : <Folder aria-hidden="true" className="size-4 shrink-0 text-muted" />}
            <span className="min-w-0 flex-1 truncate font-mono">{d.name}</span>
            {d.git && (
              <Badge tone="ok" size="sm" className="shrink-0">
                git
              </Badge>
            )}
          </button>
        </li>
      ))}
      {listing.entries.length === 0 && <li className="px-2 py-2 text-meta text-muted">No folders here.</li>}
    </ul>
  )
}

export interface FolderBrowserProps {
  /** The dialog's heading. */
  title: string
  /** The folder to start in; empty starts at the home folder. A start that cannot be listed falls back to home. */
  start: string
  /** Fills the caller's field with the chosen folder and closes. */
  onChoose: (path: string) => void
  /** When set, a primary "Open this folder" opens the folder straight away. */
  onOpen?: (path: string) => void
  onClose: () => void
  /** The listing request; tests inject one. */
  list?: (path: string, hidden: boolean) => Promise<DirsResult>
}

export function FolderBrowser({ title, start, onChoose, onOpen, onClose, list = listDirs }: FolderBrowserProps) {
  const box = useRef<HTMLDivElement>(null)
  const rows = useRef<HTMLUListElement>(null)
  const titleId = useId()
  const [at, setAt] = useState(start.trim())
  const [hidden, setHidden] = useState(false)
  const [listing, setListing] = useState<DirListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const focusRows = useRef(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    void list(at, hidden).then(async (r) => {
      if (!live) return
      // A typed start that is not a folder yet: start at home instead, and say why.
      if (!r.ok && at === start.trim() && at !== '' && r.status !== 401 && r.status !== 403) {
        const home = await list('', hidden)
        if (!live) return
        if (home.ok) {
          setListing(home.listing)
          setError(`${browseErrorWords(r, at)} Showing your home folder.`)
          setLoading(false)
          return
        }
      }
      if (r.ok) {
        setListing(r.listing)
        setError(null)
      } else {
        setError(browseErrorWords(r, at))
      }
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [at, hidden, list, start])

  // Focus starts on the first row, and goes back there after each move to another folder.
  useEffect(() => {
    if (loading) return
    if (!focusRows.current && document.activeElement !== document.body && box.current?.contains(document.activeElement)) return
    focusRows.current = false
    const first = rows.current?.querySelector<HTMLElement>('button') ?? box.current?.querySelector<HTMLElement>('[aria-label="Close"]')
    first?.focus()
  }, [loading, listing])

  const go = (p: string) => {
    focusRows.current = true
    setAt(p)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows.current?.contains(document.activeElement)) {
      const all = [...rows.current.querySelectorAll<HTMLElement>('button')]
      const i = all.indexOf(document.activeElement as HTMLElement)
      const next = all[e.key === 'ArrowDown' ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1)]
      if (next) {
        e.preventDefault()
        next.focus()
      }
      return
    }
    if (e.key !== 'Tab' || !box.current) return
    const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
    if (all.length === 0) return
    const first = all[0]!
    const last = all[all.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && (active === first || !box.current.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !box.current.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }

  const here = listing?.path ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div aria-hidden="true" className="absolute inset-0 bg-scrim" onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="relative flex max-h-[85dvh] w-full max-w-2xl min-w-0 animate-confirm-in flex-col overflow-hidden rounded-t-panel bg-surface text-fg shadow-e-hero sm:rounded-panel"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-title font-semibold break-words text-fg">
              {title}
            </h2>
            <p className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-meta text-muted [overflow-wrap:anywhere]">
              <span data-current-path="">{here ?? (at === '' ? '~' : at)}</span>
              {listing?.git && (
                <Badge tone="ok" size="sm">
                  git repository
                </Badge>
              )}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" className="size-8 shrink-0" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
          <Checkbox checked={hidden} onCheckedChange={(v) => setHidden(v === true)}>
            Show hidden folders
          </Checkbox>
          {listing?.truncated && <span className="text-meta text-muted">Showing the first 500 folders.</span>}
        </div>
        <div aria-live="polite" className="shrink-0 px-4 empty:hidden">
          {error !== null && <p className="py-2 text-meta font-medium text-fail-text [overflow-wrap:anywhere]">{error}</p>}
        </div>
        <div className="min-h-40 flex-1 overflow-y-auto px-2 py-2" aria-busy={loading ? 'true' : undefined}>
          {listing !== null && <FolderList ref={rows} listing={listing} onGo={go} />}
          {listing === null && loading && <p className="px-2 py-2 text-meta text-muted">Listing folders…</p>}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={onOpen ? 'secondary' : 'primary'} aria-disabled={here === null ? true : undefined} onClick={() => here !== null && onChoose(here)}>
            Use this folder
          </Button>
          {onOpen && (
            <Button variant="primary" aria-disabled={here === null ? true : undefined} onClick={() => here !== null && onOpen(here)}>
              Open this folder
            </Button>
          )}
        </footer>
      </div>
    </div>
  )
}
