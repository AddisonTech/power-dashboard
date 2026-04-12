import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { api } from '../services/api'

function GaugeArc({ value, min, max, warn, crit, label, unit, size = 120 }) {
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const angle = -210 + pct * 240
  const r = size / 2 - 12
  const cx = size / 2, cy = size / 2

  const toXY = (deg, radius) => ({
    x: cx + radius * Math.cos((deg * Math.PI) / 180),
    y: cy + radius * Math.sin((deg * Math.PI) / 180),
  })

  const arcPath = (startDeg, endDeg, radius) => {
    const s = toXY(startDeg, radius)
    const e = toXY(endDeg, radius)
    const large = endDeg - startDeg > 180 ? 1 : 0
    return `M${s.x},${s.y} A${radius},${radius} 0 ${large},1 ${e.x},${e.y}`
  }

  const color = value >= crit ? '#ef4444' : value >= warn ? '#f59e0b' : '#22c55e'

  return (
    <div className="gauge-container">
      <svg width={size} height={size}>
        <path d={arcPath(-210, 30, r)} fill="none" stroke="#2a2a2a" strokeWidth={8} strokeLinecap="round" />
        <path d={arcPath(-210, -210 + pct * 240, r)} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />
        <line
          x1={cx} y1={cy}
          x2={cx + (r - 10) * Math.cos((angle * Math.PI) / 180)}
          y2={cy + (r - 10) * Math.sin((angle * Math.PI) / 180)}
          stroke={color} strokeWidth={2} strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={4} fill={color} />
        <text x={cx} y={cy + 18} textAnchor="middle" fill="#e8e8e8" fontSize={13} fontWeight="700" fontFamily="monospace">
          {value?.toFixed(unit === 'Hz' ? 3 : 1)}
        </text>
        <text x={cx} y={cy + 30} textAnchor="middle" fill="#606060" fontSize={9}>{unit}</text>
      </svg>
      <div className="gauge-label">{label}</div>
    </div>
  )
}

export default function Meters({ readings }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [meters, setMeters] = useState([])
  const [history, setHistory] = useState([])
  const [period, setPeriod] = useState('1h')
  const selectedId = parseInt(searchParams.get('id') || '1', 10)

  useEffect(() => {
    api.getMeters().then(setMeters).catch(() => {})
  }, [])

  useEffect(() => {
    api.getMeterHistory(selectedId, period).then(rows => {
      setHistory(rows.map(r => ({
        ...r,
        time: new Date(r.timestamp).toLocaleTimeString(),
      })))
    }).catch(() => {})
  }, [selectedId, period])

  const meter = meters.find(m => m.id === selectedId)
  const reading = readings[selectedId] || {}
  const nomV = meter?.nominal_voltage || 480
  const nomI = meter?.nominal_current || 100

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%' }}>
      {/* Meter list */}
      <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
          Meters
        </div>
        {meters.map(m => {
          const r = readings[m.id]
          const v = r?.voltage || 0
          const status = !r ? 'off' : v > nomV * 1.05 || v < nomV * 0.95 ? 'warn' : 'ok'
          return (
            <button
              key={m.id}
              onClick={() => setSearchParams({ id: m.id })}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                borderRadius: 8, border: '1px solid',
                borderColor: m.id === selectedId ? 'var(--accent-border)' : 'var(--border)',
                background: m.id === selectedId ? 'var(--accent-dim)' : 'var(--bg-card)',
                color: m.id === selectedId ? 'var(--accent)' : 'var(--text-primary)',
                textAlign: 'left', fontSize: 12, cursor: 'pointer', width: '100%',
              }}
            >
              <span className={`status-dot ${status}`} />
              {m.name}
            </button>
          )
        })}
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
        {meter && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700 }}>{meter.name}</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{meter.description}</p>
              </div>
            </div>

            {/* Gauges */}
            <div className="card" style={{ display: 'flex', justifyContent: 'space-around', padding: 24 }}>
              <GaugeArc value={reading.voltage || 0} min={400} max={560} warn={nomV * 1.05} crit={nomV * 1.10} label="Voltage" unit="V" size={130} />
              <GaugeArc value={reading.current || 0} min={0} max={nomI * 1.2} warn={nomI * 0.85} crit={nomI} label="Current" unit="A" size={130} />
              <GaugeArc value={reading.power_factor || 0} min={0} max={1} warn={0.85} crit={0.75} label="Pwr Factor" unit="" size={130} />
              <GaugeArc value={reading.frequency || 60} min={58} max={62} warn={60.5} crit={61} label="Frequency" unit="Hz" size={130} />
            </div>

            {/* Key metrics */}
            <div className="grid-4">
              {[
                { label: 'Power',   value: reading.power_kw?.toFixed(2),    unit: 'kW'  },
                { label: 'Demand',  value: reading.demand_kw?.toFixed(2),   unit: 'kW'  },
                { label: 'Energy',  value: reading.energy_kwh?.toFixed(1),  unit: 'kWh' },
                { label: 'Load',    value: ((reading.current / nomI) * 100)?.toFixed(1), unit: '%' },
              ].map(({ label, value, unit }) => (
                <div key={label} className="stat-card">
                  <div className="stat-card-label">{label}</div>
                  <div className="stat-card-value">{value ?? '--'}</div>
                  <div className="stat-card-sub">{unit}</div>
                </div>
              ))}
            </div>

            {/* Trend chart */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>POWER TREND</span>
                <div className="period-selector">
                  {['1h', '24h', '7d'].map(p => (
                    <button key={p} className={`period-btn${period === p ? ' active' : ''}`} onClick={() => setPeriod(p)}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={history} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                  <XAxis dataKey="time" tick={{ fill: '#606060', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#606060', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} labelStyle={{ color: '#a0a0a0' }} />
                  <Line type="monotone" dataKey="power_kw" stroke="var(--accent)" dot={false} strokeWidth={1.5} name="Power kW" />
                  <Line type="monotone" dataKey="voltage" stroke="#22c55e" dot={false} strokeWidth={1} name="Voltage V" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
