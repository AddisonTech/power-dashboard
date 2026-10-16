import React, { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useFeed } from '../services/LiveFeed'
import { api } from '../services/api'

const COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#c084fc', '#f472b6', '#22d3ee', '#a3e635', '#fb923c']
const PARAMETERS = {
  power_kw: 'Power (kW)',
  load_pct: 'Load (% of rating)',
  current: 'Current (A)',
  voltage: 'Voltage (V)',
  power_factor: 'Power factor',
  frequency: 'Frequency (Hz)',
  demand_kw: 'Demand (kW)',
}

export default function Trending() {
  const { meters } = useFeed()
  const [selected, setSelected] = useState(['UTIL-1', 'UPS-A', 'UPS-B', 'MECH-1'])
  const [parameter, setParameter] = useState('power_kw')
  const [period, setPeriod] = useState('1h')
  const [series, setSeries] = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all(selected.map(id => api.getMeterHistory(id, period).then(rows => [id, rows]).catch(() => [id, []])))
      .then(results => { if (!cancelled) setSeries(Object.fromEntries(results)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selected, period])

  // History buckets share boundaries across meters, so merge on epoch
  const data = useMemo(() => {
    const merged = {}
    for (const id of selected) {
      for (const row of series[id] || []) {
        merged[row.epoch] = merged[row.epoch] || { epoch: row.epoch }
        merged[row.epoch][id] = row[parameter]
      }
    }
    return Object.values(merged).sort((a, b) => a.epoch - b.epoch)
  }, [series, selected, parameter])

  const toggle = id => setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  const exportCSV = () => {
    const header = ['timestamp_utc', ...selected.map(id => `${id}_${parameter}`)]
    const rows = data.map(r => [new Date(r.epoch * 1000).toISOString(), ...selected.map(id => r[id] ?? '')].join(','))
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trend_${parameter}_${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const tickFmt = t => new Date(t * 1000).toLocaleString([], period === '7d'
    ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Trends</h2>
          <p>Compare meters over time. History is averaged into about 360 points per period.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={exportCSV} disabled={!data.length}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="card trend-card-controls">
        <div className="control-group">
          <div className="control-label">Meters</div>
          <div className="chip-row">
            {meters.map(m => {
              const idx = selected.indexOf(m.id)
              return (
                <button key={m.id} className={`chip${idx >= 0 ? ' on' : ''}`} onClick={() => toggle(m.id)}
                  style={idx >= 0 ? { borderColor: COLORS[idx % COLORS.length], color: COLORS[idx % COLORS.length] } : undefined}>
                  {m.name}
                </button>
              )
            })}
          </div>
        </div>
        <div className="control-row">
          <div className="control-group">
            <div className="control-label">Parameter</div>
            <select value={parameter} onChange={e => setParameter(e.target.value)} aria-label="Parameter">
              {Object.entries(PARAMETERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="control-group">
            <div className="control-label">Period</div>
            <div className="seg">
              {['1h', '24h', '7d'].map(p => (
                <button key={p} className={`seg-btn${period === p ? ' active' : ''}`} onClick={() => setPeriod(p)}>{p}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        {selected.length === 0 ? (
          <div className="empty-state"><p>Select one or more meters.</p></div>
        ) : loading && !data.length ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : (
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="epoch" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tickFmt}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} minTickGap={50} />
              <YAxis domain={['auto', 'auto']} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8 }}
                labelFormatter={t => new Date(t * 1000).toLocaleString()} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {selected.map((id, i) => (
                <Line key={id} type="monotone" dataKey={id} name={meters.find(m => m.id === id)?.name || id}
                  stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
