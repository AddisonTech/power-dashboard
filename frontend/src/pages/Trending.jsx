import React, { useState, useEffect } from 'react'
import { Download } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts'
import { api } from '../services/api'

const COLORS = ['#00b4d8', '#22c55e', '#f59e0b', '#a78bfa', '#ef4444', '#fb923c', '#34d399', '#60a5fa']
const PARAMETERS = ['power_kw', 'voltage', 'current', 'power_factor', 'demand_kw', 'frequency']

export default function Trending() {
  const [meters, setMeters] = useState([])
  const [selectedMeters, setSelectedMeters] = useState([1, 2])
  const [parameter, setParameter] = useState('power_kw')
  const [period, setPeriod] = useState('1h')
  const [chartData, setChartData] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.getMeters().then(setMeters).catch(() => {})
  }, [])

  useEffect(() => {
    if (selectedMeters.length === 0) return
    setLoading(true)
    Promise.all(selectedMeters.map(id => api.getMeterHistory(id, period)))
      .then(results => {
        // Merge by timestamp index
        const merged = {}
        results.forEach((rows, idx) => {
          rows.forEach(row => {
            const key = row.timestamp
            if (!merged[key]) merged[key] = { time: new Date(row.timestamp).toLocaleTimeString() }
            merged[key][`m${selectedMeters[idx]}`] = row[parameter]
          })
        })
        setChartData(Object.values(merged).sort((a, b) => a.time > b.time ? 1 : -1))
      })
      .finally(() => setLoading(false))
  }, [selectedMeters, parameter, period])

  const toggleMeter = (id) => {
    setSelectedMeters(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const exportCSV = () => {
    const headers = ['time', ...selectedMeters.map(id => `Meter_${id}_${parameter}`)]
    const rows = chartData.map(row => headers.map(h => row[h] ?? '').join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `trending_${parameter}_${period}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="page-header">
        <h2>Trending</h2>
        <p>Multi-meter historical comparison</p>
      </div>

      {/* Controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
              Meters
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {meters.map(m => (
                <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={selectedMeters.includes(m.id)}
                    onChange={() => toggleMeter(m.id)}
                  />
                  <span style={{ color: selectedMeters.includes(m.id) ? COLORS[(selectedMeters.indexOf(m.id)) % COLORS.length] : 'var(--text-secondary)' }}>
                    {m.name}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
              Parameter
            </div>
            <select value={parameter} onChange={e => setParameter(e.target.value)}>
              {PARAMETERS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
              Period
            </div>
            <div className="period-selector">
              {['1h', '24h', '7d'].map(p => (
                <button key={p} className={`period-btn${period === p ? ' active' : ''}`} onClick={() => setPeriod(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={exportCSV}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading...</div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData} margin={{ top: 5, right: 24, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
              <XAxis dataKey="time" tick={{ fill: '#606060', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#606060', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} labelStyle={{ color: '#a0a0a0' }} />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
              {selectedMeters.map((id, i) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={`m${id}`}
                  name={meters.find(m => m.id === id)?.name || `Meter ${id}`}
                  stroke={COLORS[i % COLORS.length]}
                  dot={false}
                  strokeWidth={1.5}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
