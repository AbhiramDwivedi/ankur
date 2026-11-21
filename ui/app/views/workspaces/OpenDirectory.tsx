// Open a directory (S2): one repo path, one primary button. The server decides what a path is;
// this screen words each refusal, keeps what was typed and puts focus back in the input.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FolderOpen } from 'lucide-react'
import type { OpenResult, WorkspaceItem } from '../../store/types.ts'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { cn } from '../../lib/utils.ts'
import { EXPIRED_LINK } from './WorkspaceRail.tsx'

export const IDLE_HELP = 'It must be a git repository: the folder that holds .git, or any folder inside one. Use the full path, or start it with ~.'

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

export interface OpenDirectoryProps {
  /** Asks the server to open the path; the answer says whether the workspace was already open. */
  open: (path: string) => Promise<OpenResult>
  /** The workspace opened, or was open already; `typed` is what the client typed. */
  onOpened: (workspace: WorkspaceItem, existed: boolean, typed: string) => void
}

export function OpenDirectory({ open, onOpened }: OpenDirectoryProps) {
  const [value, setValue] = useState('')
  const [checking, setChecking] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const refocus = useRef(true)

  // On arrival, and after every refusal, focus is in the input.
  useEffect(() => {
    if (!refocus.current || checking !== null) return
    refocus.current = false
    input.current?.focus()
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (checking !== null) return
    const path = value.trim()
    if (path === '') {
      setRefusal({ head: 'Type a repo path first.', fix: null })
      refocus.current = true
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
    refocus.current = true
  }

  const busy = checking !== null
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
      </div>
    </section>
  )
}
