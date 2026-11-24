// The workspace rail (S1): the open workspaces with their status and open-request count, and "Open a directory".
// From 1024 px it is a 232 px column; below that it is a disclosure at the top of the page that opens in the flow.
import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import type { ResumeResult, WorkspaceItem } from '../../store/types.ts'
import { Button } from '../../components/ui/button.tsx'
import { Notice } from '../../components/ui/notice.tsx'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import { cn } from '../../lib/utils.ts'
import { SproutMark } from '../shell/SproutMark.tsx'
import { countChip } from './format.ts'
import { WorkspaceRow, rowCount, rowStatus, type StopLocal } from './WorkspaceRow.tsx'

export const EXPIRED_LINK = "This page's link has expired. Open the address the server printed when it started."
export const NO_WORKSPACES = 'None open yet. Each repository you open becomes a workspace here.'

export interface WorkspaceRailProps {
  /** The list from the server; null before the first answer. */
  items: WorkspaceItem[] | null
  /** The list request failed (not a 401 or 403). */
  error: boolean
  /** 401 or 403: the page's token is gone. */
  expired: boolean
  currentId: string | null
  /** S2 is shown: "Open a directory" is on. */
  openShown: boolean
  /** The link is lost: every word is the last one seen. */
  stale: boolean
  stage: { i: number; n: number } | null
  stops: Record<string, StopLocal>
  onSelect: (id: string) => void
  onOpen: () => void
  onStop: (id: string) => void
  onResume?: (id: string, sessionId: string, force: boolean) => Promise<ResumeResult>
  onRetry: () => void
}

const kbd = 'rounded-chip border border-border-strong border-b-2 bg-surface px-1 font-mono text-micro text-fg'

export function WorkspaceRail(p: WorkspaceRailProps) {
  const [expanded, setExpanded] = useState(false)
  const items = p.items ?? []
  const current = items.find((w) => w.id === p.currentId) ?? null
  const chip = current ? countChip(rowCount(current)) : null
  const status = current ? rowStatus(current, p.stops[current.id], p.stage, p.stale) : null

  const pick = (id: string) => {
    setExpanded(false)
    p.onSelect(id)
  }

  return (
    <nav
      aria-label="Workspaces"
      className="flex min-h-0 min-w-0 flex-col border-b border-border bg-sunken lg:h-full lg:border-r lg:border-b-0"
    >
      {/* The brand row comes first in the nav, so the mark is its first aria-hidden svg (the toggle's chevron follows). */}
      <div className="hidden items-center gap-3 px-5 pt-5 pb-1 lg:flex">
        <SproutMark />
        <div className="flex min-w-0 flex-col">
          <span className="text-lead leading-6 font-semibold tracking-tight text-fg">ankur</span>
          <span className="text-meta text-subtle">Run console</span>
        </div>
      </div>

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="workspace-panel"
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 px-4 py-2 text-left text-ui text-fg lg:hidden"
      >
        <span className="min-w-0 flex-1 truncate">
          {current && status ? (
            <>
              <span className="font-semibold">Workspace: {current.name}</span>
              <span className={cn(p.stale ? 'text-muted' : status.color)}> · {status.text}</span>
            </>
          ) : (
            'Workspaces'
          )}
        </span>
        {chip && current && (
          <span className="inline-inline-flex min-h-6 shrink-0 items-center rounded-chip bg-signal-soft px-2 text-meta font-semibold whitespace-nowrap tabular-nums text-signal-text">
            <span aria-hidden="true">{chip.text}</span>
            <span className="sr-only">
              {rowCount(current)}
              {chip.sr}
            </span>
          </span>
        )}
        <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 text-muted transition-transform duration-(--duration-quick)', expanded && 'rotate-180')} />
      </button>

      <div id="workspace-panel" className={cn(expanded ? 'flex' : 'hidden', 'min-h-0 flex-1 flex-col gap-5 px-3 pb-4 lg:flex lg:px-3 lg:pt-5 lg:pb-4')}>
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-meta font-semibold text-fg">Workspaces</h2>
          {p.items !== null && <span className="text-meta text-muted">{items.length} open</span>}
        </div>

        {p.expired && <Notice tone="fail">{EXPIRED_LINK}</Notice>}
        {p.error && (
          <Notice tone="fail">
            Could not load your workspaces.{' '}
            <button type="button" className="rounded-chip font-semibold underline" onClick={p.onRetry}>
              Retry
            </button>
          </Notice>
        )}

        {p.items === null ? (
          !p.error && !p.expired && (
            <div aria-hidden="true" className="flex flex-col gap-1">
              <Skeleton className="h-18 rounded-ctl" />
              <Skeleton className="h-18 rounded-ctl" />
            </div>
          )
        ) : items.length === 0 ? (
          <p className="px-1 text-meta text-muted">{NO_WORKSPACES}</p>
        ) : (
          <ul className="flex max-h-96 min-h-0 flex-col gap-1 overflow-y-auto lg:max-h-none -mx-1 p-1">
            {items.map((w) => (
              <WorkspaceRow
                key={w.id}
                item={w}
                current={w.id === p.currentId}
                stale={p.stale}
                stage={w.id === p.currentId ? p.stage : null}
                stop={p.stops[w.id]}
                onSelect={pick}
                onStop={p.onStop}
                onResume={p.onResume}
              />
            ))}
          </ul>
        )}

        <Button
          variant="ghost"
          icon={<Plus aria-hidden="true" />}
          aria-pressed={p.openShown}
          className="w-full shrink-0 justify-start aria-pressed:bg-surface aria-pressed:text-brand-strong aria-pressed:shadow-e1 active:translate-y-px"
          onClick={() => {
            setExpanded(false)
            p.onOpen()
          }}
        >
          Open a directory
        </Button>

        <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border px-2 pt-3 text-meta text-muted">
          <p className="flex items-center gap-2">
            <kbd className={kbd}>Alt</kbd>
            <kbd className={kbd}>↑</kbd>
            <kbd className={kbd}>↓</kbd>
            <span>Switch workspace</span>
          </p>
          <p className="flex items-center gap-2">
            <kbd className={kbd}>←</kbd>
            <kbd className={kbd}>→</kbd>
            <span>Switch tab</span>
          </p>
          <p className="flex items-center gap-2">
            <kbd className={kbd}>Esc</kbd>
            <span>Close a dialog</span>
          </p>
        </div>
      </div>
    </nav>
  )
}
