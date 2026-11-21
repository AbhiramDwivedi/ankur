// The centre's tabs: Conversation, ADRs, Deliverables, Decisions, Design. Radix tabs with automatic activation, so
// Left and Right move between them. The tab panel is the only region of the centre that scrolls; the Conversation panel
// holds the thread (its own scroll) with the composer pinned under it. A panel with nothing to show says so in one line.
import { Suspense, lazy, useState, type ReactNode } from 'react'
import { Button } from '../../components/ui/button.tsx'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.tsx'
import { cn } from '../../lib/utils.ts'
import type { Decision, RunState } from '../../store/types.ts'
import { AdrSection, kindOf } from '../decisions/AdrSection.tsx'
import { Deliverables, deliverablesOf } from '../deliverables/Deliverables.tsx'

// The document renderer (marked, mermaid) loads only when the Design tab, or a document preview, first opens.
const DesignPanel = lazy(() => import('../design/DesignPanel.tsx').then((m) => ({ default: m.DesignPanel })))

export interface OverviewTabsProps {
  state: RunState | null
  now: number
  /** The Conversation panel: the thread and the composer under it. */
  conversation: ReactNode
}

type Tab = 'conversation' | 'adrs' | 'deliverables' | 'decisions' | 'design'

export const EMPTY_ADRS = 'No ADRs yet. The design engineer writes them while planning.'
export const EMPTY_DELIVERABLES = 'No deliverables yet. They appear as crews finish.'
export const EMPTY_DECISIONS = 'No decisions yet. The project manager records each ruling here.'

export const EMPTY_DESIGN = 'No plan, architecture doc or images yet. The design engineer adds them while planning.'

/** Decisions listed before "Show all". */
const FIRST_DECISIONS = 20

const panel = 'min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6'

function Count({ n, ask }: { n: number; ask?: boolean }) {
  return (
    <span className={cn('rounded-chip px-2 text-micro leading-4', ask ? 'bg-signal-soft text-signal-text' : 'bg-sunken text-muted')}>{n}</span>
  )
}

function Empty({ children }: { children: string }) {
  return <p className="text-ui text-muted">{children}</p>
}

function DecisionLine({ d }: { d: Decision }) {
  const [first = '', ...more] = d.text.split('\n')
  const parts = first.split(' | ')
  const time = /^\d\d:\d\d$/.test(parts[0] ?? '') ? parts.shift()! : ''
  const ruling = parts.shift() ?? ''
  return (
    <li className="flex min-w-0 gap-3 border-t border-border py-2 first:border-t-0">
      <span className="w-11 shrink-0 font-mono text-micro tabular-nums text-muted">{time}</span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="text-ui font-semibold text-fg">{ruling}</span>
        {parts.length > 0 && <span className="text-meta text-muted"> | {parts.join(' | ')}</span>}
        {more.map((m, i) => (
          <span key={i} className="block text-meta text-muted">
            {m.trim()}
          </span>
        ))}
      </span>
    </li>
  )
}

/** The Decisions tab: the newest ruling first, the first twenty, then a "Show all" button. */
function DecisionsList({ decisions }: { decisions: Decision[] }) {
  const [all, setAll] = useState(false)
  const newest = [...decisions].reverse()
  const shown = all ? newest : newest.slice(0, FIRST_DECISIONS)
  return (
    <>
      <ul aria-label="Decisions, newest first">
        {shown.map((d) => (
          <DecisionLine key={d.n} d={d} />
        ))}
      </ul>
      {!all && newest.length > FIRST_DECISIONS && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll(true)}>
          Show all {newest.length} decisions
        </Button>
      )}
    </>
  )
}

export function OverviewTabs({ state, now, conversation }: OverviewTabsProps) {
  const [tab, setTab] = useState<Tab>('conversation')
  const adrs = state?.adrs ?? []
  const waiting = adrs.filter((a) => kindOf(a.status) === 'proposed').length
  const deliverables = state ? deliverablesOf(state).length : 0
  const decisions = state?.decisions ?? []
  const hasDesign = state?.design != null && (state.design.planMd != null || state.design.architecture != null || state.design.images.length > 0)
  const loading = <Skeleton className="h-10 w-full" />

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 flex-1 gap-0">
      <TabsList aria-label="Run views" className="shrink-0 px-4 lg:px-6">
        <TabsTrigger value="conversation">Conversation</TabsTrigger>
        <TabsTrigger value="adrs">
          ADRs
          {adrs.length > 0 && <Count n={adrs.length} ask={waiting > 0} />}
          {waiting > 0 && <span className="sr-only">, {waiting === 1 ? 'one waits' : `${waiting} wait`} for approval</span>}
        </TabsTrigger>
        <TabsTrigger value="deliverables">
          Deliverables
          {deliverables > 0 && <Count n={deliverables} />}
        </TabsTrigger>
        <TabsTrigger value="decisions">Decisions</TabsTrigger>
        <TabsTrigger value="design">Design</TabsTrigger>
      </TabsList>

      <TabsContent value="conversation" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 lg:px-6">
        <div id="conversation" tabIndex={-1} className="flex min-h-0 flex-1 flex-col gap-3 outline-none">
          {conversation}
        </div>
      </TabsContent>
      <TabsContent value="adrs" className={panel}>
        {state === null ? loading : adrs.length === 0 ? <Empty>{EMPTY_ADRS}</Empty> : <AdrSection adrs={adrs} />}
      </TabsContent>
      <TabsContent value="deliverables" className={panel}>
        {state === null ? loading : deliverables === 0 ? <Empty>{EMPTY_DELIVERABLES}</Empty> : <Deliverables state={state} now={now} onOpenDesign={() => setTab('design')} />}
      </TabsContent>
      <TabsContent value="decisions" className={panel}>
        {state === null ? loading : decisions.length === 0 ? <Empty>{EMPTY_DECISIONS}</Empty> : <DecisionsList decisions={decisions} />}
      </TabsContent>
      <TabsContent value="design" className={panel}>
        {state === null ? (
          loading
        ) : !hasDesign ? (
          <Empty>{EMPTY_DESIGN}</Empty>
        ) : (
          <Suspense fallback={loading}>
            <DesignPanel state={state} now={now} />
          </Suspense>
        )}
      </TabsContent>
    </Tabs>
  )
}
