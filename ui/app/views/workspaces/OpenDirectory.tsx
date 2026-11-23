// Open a directory (S2): one repo path, one primary button, a "Browse…" folder browser beside it, and a second form
// that clones a repository and opens the clone. The server decides what a path or a URL is; this screen words each
// refusal, keeps what was typed and puts focus back in the field that was refused.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FolderOpen } from 'lucide-react'
import type { DirsResult, OpenResult, WorkspaceItem } from '../../store/types.ts'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { cn } from '../../lib/utils.ts'
import { EXPIRED_LINK } from './WorkspaceRail.tsx'
import { FolderBrowser } from './FolderBrowser.tsx'

export const IDLE_HELP = 'It must be a git repository: the folder that holds .git, or any folder inside one. Use the full path, or start it with ~.'
export const CLONE_HELP = 'An https or git@ URL from any git host. The clone goes into a new folder named after the repository.'
/** The parent folder's placeholder: the server clones into ~/code, or the home folder when ~/code does not exist. */
export const CLONE_PARENT_DEFAULT = '~/code (or your home folder)'

export interface Refusal {
  head: string
  fix: string | null
}

/** The two lines of a refused open: what happened, then what to do. */
export function refusalOf(r: Extract<OpenResult, { ok: false }>, path: string): Refusal {
  if (r.status === 401 || r.status === 403) return { head: EXPIRED_LINK, fix: null }
  switch (r.error) {
    case 'notgit':
      return { head: `Not a git repository: ${path}`, fix: 'Pick the folder that holds .git, or run git init there first.' }
    case 'missing':
      return { head: `No such folder: ${path}`, fix: 'Check the spelling, or create the folder first.' }
    case 'relative':
      return { head: `Use a full path: ${path}`, fix: 'Relative paths are refused. Start with the full path or ~.' }
    case 'path':
      return { head: 'Type a repo path first.', fix: null }
    case 'timeout':
      return { head: `Could not check ${path} in 10 seconds.`, fix: 'Git or the disk may be busy. Press Open to try again.' }
    case 'stuck':
    case 'network':
      return { head: 'No answer from the ankur server.', fix: 'Check the terminal it runs in, then press Open again.' }
    default:
      return { head: `Could not open ${path}: ${r.error}.`, fix: 'Press Open to try again.' }
  }
}

/** The two lines of a refused clone. `target` is the folder the clone was for, when the server named it. */
export function cloneRefusalOf(r: Extract<OpenResult, { ok: false }>, url: string, parent: string): Refusal {
  if (r.status === 401 || r.status === 403) return { head: EXPIRED_LINK, fix: null }
  const into = r.target ?? (parent === '' ? CLONE_PARENT_DEFAULT : parent)
  switch (r.error) {
    case 'url':
      return url === ''
        ? { head: 'Paste a repository URL first.', fix: null }
        : { head: `Not a repository URL: ${url}`, fix: 'Use an https:// or git@host:owner/repo URL. Local paths and ext:: or file:: URLs are refused.' }
    case 'relative':
      return { head: `Use a full path for the folder: ${parent}`, fix: 'Relative paths are refused. Start with the full path or ~, or leave it empty for ~/code.' }
    case 'parent':
      return { head: `No such folder: ${parent === '' ? CLONE_PARENT_DEFAULT : parent}`, fix: 'Pick a folder that exists with Browse…, or create it first.' }
    case 'exists':
      return { head: `${into} already exists and is not empty.`, fix: 'Open it above if it is this repository, or pick another folder.' }
    case 'auth':
      return { head: `Git could not sign in to ${url}`, fix: 'The repository may be private or may not exist. Check the URL, or set up your git credentials or SSH key, then press Clone again.' }
    case 'notfound':
      return { head: `No repository at ${url}`, fix: 'Check the owner and the name in the URL.' }
    case 'network':
      return { head: `Could not reach the host of ${url}`, fix: 'Check your network connection and the host name, then press Clone again.' }
    case 'timeout':
      return { head: 'The clone took longer than 5 minutes and was stopped.', fix: 'The repository may be very large or the network slow. Clone it in a terminal, then open the folder above.' }
    case 'nogit':
      return { head: 'Git is not installed, or not on the PATH of the ankur server.', fix: 'Install git, restart the server, then press Clone again.' }
    case 'stuck':
    case 'network-down':
      return { head: 'No answer from the ankur server.', fix: 'Check the terminal it runs in. The clone may still finish there.' }
    case 'git':
      return { head: `Git could not clone ${url}`, fix: 'The terminal the server runs in shows git’s own message. Press Clone to try again.' }
    default:
      return { head: `Could not clone ${url}: ${r.error}.`, fix: 'Press Clone to try again.' }
  }
}

/** The client's fetch to the server failed (status 0) reads as a dead server, not as git's network failure. */
function cloneRefusal(r: Extract<OpenResult, { ok: false }>, url: string, parent: string): Refusal {
  return cloneRefusalOf(r.status === 0 && r.error === 'network' ? { ...r, error: 'network-down' } : r, url, parent)
}

export interface OpenDirectoryProps {
  /** Asks the server to open the path; the answer says whether the workspace was already open. */
  open: (path: string) => Promise<OpenResult>
  /** The workspace opened, or was open already; `typed` is what the client typed. */
  onOpened: (workspace: WorkspaceItem, existed: boolean, typed: string) => void
  /** Asks the server to clone `url` into `parent` (empty: the default) and open the clone. Absent: no clone form. */
  clone?: (url: string, parent: string) => Promise<OpenResult>
  /** The folder browser's listing request; tests inject one. */
  list?: (path: string, hidden: boolean) => Promise<DirsResult>
}

type Browsing = 'repo' | 'parent' | null

export function OpenDirectory({ open, onOpened, clone, list }: OpenDirectoryProps) {
  const [value, setValue] = useState('')
  const [checking, setChecking] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [browsing, setBrowsing] = useState<Browsing>(null)
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [cloning, setCloning] = useState<string | null>(null)
  const [cloneRefused, setCloneRefused] = useState<Refusal | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const urlInput = useRef<HTMLInputElement>(null)
  const repoBrowse = useRef<HTMLButtonElement>(null)
  const parentBrowse = useRef<HTMLButtonElement>(null)
  const refocus = useRef<HTMLElement | null>(null)
  const arrived = useRef(false)

  // On arrival, and after every refusal, focus is in the refused field (after a browse, back on its Browse… button).
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true
      input.current?.focus()
      return
    }
    if (refocus.current === null || checking !== null || cloning !== null || browsing !== null) return
    refocus.current.focus()
    refocus.current = null
  })

  const openPath = async (raw: string) => {
    if (checking !== null || cloning !== null) return
    const path = raw.trim()
    if (path === '') {
      setRefusal({ head: 'Type a repo path first.', fix: null })
      refocus.current = input.current
      return
    }
    setRefusal(null)
    setChecking(path)
    const r = await open(path)
    setChecking(null)
    if (r.ok) {
      onOpened(r.workspace, r.existed, path)
      return
    }
    setRefusal(refusalOf(r, path))
    refocus.current = input.current
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void openPath(value)
  }

  const submitClone = async (e: FormEvent) => {
    e.preventDefault()
    if (clone === undefined || cloning !== null || checking !== null) return
    const u = url.trim()
    const p = parent.trim()
    if (u === '') {
      setCloneRefused({ head: 'Paste a repository URL first.', fix: null })
      refocus.current = urlInput.current
      return
    }
    setCloneRefused(null)
    setCloning(u)
    const r = await clone(u, p)
    setCloning(null)
    if (r.ok) {
      onOpened(r.workspace, r.existed, r.workspace.path)
      return
    }
    setCloneRefused(cloneRefusal(r, u, p))
    refocus.current = urlInput.current
  }

  const busy = checking !== null
  const cloneBusy = cloning !== null
  return (
    <section aria-label="Open a directory" className="grid min-h-full min-w-0 place-items-center px-4 py-8">
      <div className="flex w-full max-w-130 min-w-0 flex-col gap-5">
        <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-card bg-brand-soft text-brand-strong">
          <FolderOpen className="size-5" />
        </span>
        <h1 className="text-h1 font-semibold text-fg">Open a repository to start a run</h1>
        <p className="text-lead text-muted">
          Each repository becomes a workspace with its own session, conversation and crews. Open as many as you like.
        </p>
        <form noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="repo-path">Repo path</Label>
          <div className="flex min-w-0 flex-col gap-2 min-[30rem]:flex-row">
            <Input
              id="repo-path"
              ref={input}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              readOnly={busy}
              placeholder="~/code/shop-api"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={refusal !== null ? true : undefined}
              aria-describedby="repo-msg"
              className={cn('h-9 font-mono', busy && 'bg-sunken')}
            />
            <Button ref={repoBrowse} type="button" aria-haspopup="dialog" aria-disabled={busy ? true : undefined} onClick={() => !busy && setBrowsing('repo')} className="min-w-24">
              Browse…
            </Button>
            <Button type="submit" variant="primary" pending={busy} className="min-w-24">
              {busy ? 'Checking…' : 'Open'}
            </Button>
          </div>
          <div id="repo-msg" aria-live="polite" role={refusal !== null ? 'alert' : 'status'} className="flex min-w-0 flex-col gap-1 text-meta [overflow-wrap:anywhere]">
            {refusal !== null ? (
              <>
                <p className="font-medium text-fail-text">{refusal.head}</p>
                {refusal.fix !== null && <p className="text-muted">{refusal.fix}</p>}
              </>
            ) : checking !== null ? (
              <p className="text-muted">Checking that {checking} is a git repository…</p>
            ) : (
              <p className="text-muted">{IDLE_HELP}</p>
            )}
          </div>
        </form>
        {clone !== undefined && (
          <form noValidate onSubmit={submitClone} aria-labelledby="clone-title" className="flex min-w-0 flex-col gap-2 border-t border-border pt-5">
            <h2 id="clone-title" className="text-title font-semibold text-fg">
              Or clone a repository
            </h2>
            <Label htmlFor="clone-url">Repository URL</Label>
            <Input
              id="clone-url"
              ref={urlInput}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              readOnly={cloneBusy}
              placeholder="https://github.com/acme/shop-api.git"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={cloneRefused !== null ? true : undefined}
              aria-describedby="clone-msg"
              className={cn('h-9 font-mono', cloneBusy && 'bg-sunken')}
            />
            <Label htmlFor="clone-parent">Clone into</Label>
            <div className="flex min-w-0 flex-col gap-2 min-[30rem]:flex-row">
              <Input
                id="clone-parent"
                value={parent}
                onChange={(e) => setParent(e.target.value)}
                readOnly={cloneBusy}
                placeholder={CLONE_PARENT_DEFAULT}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="clone-msg"
                className={cn('h-9 font-mono', cloneBusy && 'bg-sunken')}
              />
              <Button ref={parentBrowse} type="button" aria-haspopup="dialog" aria-disabled={cloneBusy ? true : undefined} onClick={() => !cloneBusy && setBrowsing('parent')} className="min-w-24">
                Browse…
              </Button>
              <Button type="submit" pending={cloneBusy} className="min-w-24">
                {cloneBusy ? 'Cloning…' : 'Clone'}
              </Button>
            </div>
            <div id="clone-msg" aria-live="polite" role={cloneRefused !== null ? 'alert' : 'status'} className="flex min-w-0 flex-col gap-1 text-meta [overflow-wrap:anywhere]">
              {cloneRefused !== null ? (
                <>
                  <p className="font-medium text-fail-text">{cloneRefused.head}</p>
                  {cloneRefused.fix !== null && <p className="text-muted">{cloneRefused.fix}</p>}
                </>
              ) : cloning !== null ? (
                <p className="text-muted">Cloning {cloning}… This can take a few minutes.</p>
              ) : (
                <p className="text-muted">{CLONE_HELP}</p>
              )}
            </div>
          </form>
        )}
      </div>
      {browsing === 'repo' && (
        <FolderBrowser
          title="Pick a repository"
          start={value}
          list={list}
          onClose={() => {
            refocus.current = repoBrowse.current
            setBrowsing(null)
          }}
          onChoose={(p) => {
            setValue(p)
            refocus.current = input.current
            setBrowsing(null)
          }}
          onOpen={(p) => {
            setValue(p)
            setBrowsing(null)
            void openPath(p)
          }}
        />
      )}
      {browsing === 'parent' && (
        <FolderBrowser
          title="Pick the folder to clone into"
          start={parent === '' ? '~/code' : parent}
          list={list}
          onClose={() => {
            refocus.current = parentBrowse.current
            setBrowsing(null)
          }}
          onChoose={(p) => {
            setParent(p)
            refocus.current = parentBrowse.current
            setBrowsing(null)
          }}
        />
      )}
    </section>
  )
}
