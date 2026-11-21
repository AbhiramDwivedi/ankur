// The Usage cell's sparkline, drawn from the client's own series of figures seen so far. The line is brand, the last
// point is sun (the one place sunshine marks "now"). Fewer than two points draw nothing, at the same height, so the cell
// never jumps when the first result arrives.
const W = 72
const H = 26

export interface SparklineProps {
  series: number[]
}

export function Sparkline({ series }: SparklineProps) {
  if (series.length < 2) return <span aria-hidden="true" className="block h-6.5 w-18 shrink-0" />
  const max = Math.max(...series, 1) * 1.1
  const step = (W - 3) / (series.length - 1)
  const pts = series.map((v, i) => `${(1.5 + i * step).toFixed(1)},${(H - (v / max) * (H - 3) - 1.5).toFixed(1)}`)
  const [lastX, lastY] = pts.at(-1)!.split(',')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="block h-6.5 w-18 shrink-0 overflow-visible">
      <path d={`M1.5,${H} L${pts.join(' L')} L${W - 1.5},${H} Z`} className="fill-brand/10" />
      <polyline points={pts.join(' ')} fill="none" className="stroke-brand" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.6} className="fill-sun stroke-fg" strokeWidth={1.2} />
    </svg>
  )
}
