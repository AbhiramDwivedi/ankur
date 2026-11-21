// The Usage so far cell of the summary strip: dollars and tokens (a dash when the server has no figure, never 0), the
// agent count, a sparkline of the run's tokens as this page has seen them, and the run's elapsed time. One button: it
// opens the Spend by model dialog. SpendTable is that dialog's body. Cost comes from state.cost.
import { useEffect, useRef, useState } from 'react'
import type { RunState } from '../../store/types.ts'
import { cn } from '../../lib/utils.ts'
import { DeliverableDialog } from '../deliverables/DeliverableDialog.tsx'
import { hhmm } from '../crews/format.ts'
import { Sparkline } from './Sparkline.tsx'
import { costOf, formatDollars, formatElapsed, formatTokens, runAgents, runTimeMs, spendRows } from './format.ts'

export interface UsageCellProps {
  state: RunState | null
  now: number
  className?: string
}

/** Points kept for the sparkline. */
const SERIES_MAX = 24

/** The figures this page has seen for one value, oldest first: a new one is added when the value moves. */
function useSeries(value: number | null): number[] {
  const [series, setSeries] = useState<number[]>(() => (value === null ? [] : [value]))
  useEffect(() => {
    if (value === null) return
    setSeries((prev) => (prev.at(-1) === value ? prev : [...prev, value].slice(-SERIES_MAX)))
  }, [value])
  return series
}

const th = 'px-3 py-2 text-meta font-medium whitespace-nowrap text-muted'
const td = 'px-3 py-2 text-right font-mono tabular-nums text-fg'

/** The Spend by model table: Model, Agents, Running, Tokens, Dollars, with the run's total under it. */
export function SpendTable({ state }: { state: RunState | null }) {
  const cost = costOf(state)
  const rows = state ? spendRows(state) : []
  if (state === null || cost === null || rows.length === 0) {
    return <p className="p-4 text-ui text-muted">No usage recorded for this run yet.</p>
  }
  const agents = runAgents(state).length
  const running = rows.reduce((n, r) => n + r.running, 0)
  return (
    <div className="p-4">
      <div role="region" aria-label="Spend by model" tabIndex={0} className="max-w-full overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-xl border-collapse text-ui">
          <caption className="sr-only">Spend by model</caption>
          <thead className="border-b border-border bg-sunken">
            <tr>
              <th scope="col" className={cn(th, 'text-left')}>
                Model
              </th>
              {['Agents', 'Running', 'Tokens', 'Dollars'].map((h) => (
                <th key={h} scope="col" className={cn(th, 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model} className="border-t border-border first:border-t-0">
                <th scope="row" className="px-3 py-2 text-left font-mono font-medium text-fg">
                  {r.model}
                </th>
                <td className={td}>{r.agents}</td>
                <td className={td}>{r.running}</td>
                <td className={td}>{formatTokens(r.tokens)}</td>
                <td className={td}>{formatDollars(r.usd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border-strong bg-sunken">
            <tr>
              <th scope="row" className="px-3 py-2 text-left font-medium text-fg">
                Total
              </th>
              <td className={td}>{agents}</td>
              <td className={td}>{running}</td>
              <td className={td}>{formatTokens(cost.session.tokens)}</td>
              <td className={td}>{formatDollars(cost.session.usd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-meta text-muted">
        {cost.run.since ? `Since approval at ${hhmm(cost.run.since)}` : 'Since approval'}: {formatTokens(cost.run.tokens)} tokens,{' '}
        {formatDollars(cost.run.usd)}
        {cost.run.usd === null || cost.run.tokens <= 0 ? ' (not recorded for this run)' : ''}
      </p>
      {cost.crews.length > 0 && (
        <div role="region" aria-label="Spend by crew" tabIndex={0} className="mt-4 max-w-full overflow-x-auto rounded-card border border-border">
          <table className="w-full border-collapse text-ui">
            <caption className="sr-only">Spend by crew</caption>
            <thead className="border-b border-border bg-sunken">
              <tr>
                <th scope="col" className={cn(th, 'text-left')}>
                  Crew
                </th>
                <th scope="col" className={cn(th, 'text-right')}>
                  Tokens
                </th>
                <th scope="col" className={cn(th, 'text-right')}>
                  Dollars
                </th>
              </tr>
            </thead>
            <tbody>
              {cost.crews.map((c) => (
                <tr key={c.crew} className="border-t border-border first:border-t-0">
                  <th scope="row" className="px-3 py-2 text-left font-mono font-medium text-fg">
                    {c.crew}
                  </th>
                  <td className={td}>{formatTokens(c.tokens)}</td>
                  <td className={td}>
                    {formatDollars(c.usd)}
                    {c.usd === null && <span className="ml-2 font-sans text-meta text-muted">{c.why ?? 'not priced'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cost.unpriced.length > 0 && (
        <p className="mt-3 text-meta text-muted">
          No price for {cost.unpriced.join(', ')}, so its dollars read —.
        </p>
      )}
    </div>
  )
}

export function UsageCell({ state, now, className }: UsageCellProps) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  // The headline reads the same source as the Spend dialog: costOf(state), which falls back to the session's own usage.
  // A dash shows only where costOf itself has no value, never 0.
  const cost = costOf(state)
  const tokens = cost?.run.tokens ?? null
  const series = useSeries(tokens !== null && tokens > 0 ? tokens : null)
  const ms = state ? runTimeMs(state, now) : null
  const crews = state?.run?.crews.length ?? 0
  const agentCount = state && crews > 0 ? runAgents(state).length : null

  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => opener.current?.focus())
  }

  const tokenWords = tokens !== null && tokens > 0 ? `${formatTokens(tokens)} tokens` : '—'
  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        title="Open spend by model"
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-border bg-surface px-4 py-2 text-left transition-colors duration-(--duration-quick) ease-out hover:border-border-strong active:translate-y-px active:bg-pressed',
          className,
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-meta font-medium text-muted">Usage so far</span>
          <span className="font-mono text-body font-semibold tabular-nums text-fg">
            {formatDollars(cost?.run.usd)}
            <span className="font-normal text-muted"> · {tokenWords}</span>
          </span>
        </span>{' '}
        <span className="text-meta text-muted">{agentCount === null ? 'No agents yet' : agentCount === 1 ? '1 agent' : `${agentCount} agents`}</span>{' '}
        <span className="ml-auto flex shrink-0 items-center gap-4">
          <Sparkline series={series} />
          <span className="font-mono text-meta tabular-nums text-muted">{ms === null ? '—' : formatElapsed(ms)}</span>
        </span>
      </button>
      {open && (
        <DeliverableDialog
          onClose={close}
          kicker="Usage so far"
          title="Spend by model"
          subtitle="Model rows and the total cover the whole session"
        >
          <SpendTable state={state} />
        </DeliverableDialog>
      )}
    </>
  )
}
