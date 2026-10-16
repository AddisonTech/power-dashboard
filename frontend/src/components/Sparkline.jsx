import React, { useEffect, useRef, useState } from 'react'

// Lightweight SVG line, used where pulling in a chart library is not worth it
export function Sparkline({ data, height = 36, className = '' }) {
  if (!data || data.length < 2) return <div className={`sparkline ${className}`} style={{ height }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const w = 100
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - 2 - ((v - min) / span) * (height - 4)])
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  return (
    <svg className={`sparkline ${className}`} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none"
      style={{ height }} aria-hidden="true">
      <path d={`${line} L${w},${height} L0,${height} Z`} className="spark-fill" />
      <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function useWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

// Small time series chart with axis labels for the dashboard
export function AreaChart(props) {
  const [ref, width] = useWidth()
  return (
    <div ref={ref} className="area-chart-wrap" style={{ height: props.height || 180 }}>
      {width > 0 && <AreaChartSvg {...props} width={width} />}
    </div>
  )
}

function AreaChartSvg({ points, width, height = 180, unit = '', format = v => v.toFixed(0) }) {
  if (!points || points.length < 2) {
    return <div className="chart-empty" style={{ height }}>Collecting data...</div>
  }
  const ys = points.map(p => p.v)
  let min = Math.min(...ys)
  let max = Math.max(...ys)
  const pad = (max - min) * 0.15 || max * 0.05 || 1
  min = Math.max(0, min - pad)
  max = max + pad
  const t0 = points[0].t
  const t1 = points[points.length - 1].t
  const W = width
  const H = height
  const left = 44
  const bottom = 20
  const x = t => left + ((t - t0) / (t1 - t0 || 1)) * (W - left - 4)
  const y = v => 6 + (1 - (v - min) / (max - min)) * (H - bottom - 10)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const ticks = [min, (min + max) / 2, max]
  const timeTicks = [t0, (t0 + t1) / 2, t1]
  const fmtTime = t => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

  return (
    <svg className="area-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      role="img" aria-label="Facility load trend">
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={left} x2={W} y1={y(v)} y2={y(v)} className="grid-line" />
          <text x={left - 6} y={y(v) + 3} textAnchor="end" className="axis-text">{format(v)}{unit}</text>
        </g>
      ))}
      {timeTicks.map((t, i) => (
        <text key={i} x={x(t)} y={H - 4} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
          className="axis-text">{fmtTime(t)}</text>
      ))}
      <path d={`${line} L${x(t1)},${H - bottom} L${x(t0)},${H - bottom} Z`} className="area-fill" />
      <path d={line} className="area-line" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
