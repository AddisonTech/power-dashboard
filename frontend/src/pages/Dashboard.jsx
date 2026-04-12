import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Activity, AlertTriangle, CheckCircle } from 'lucide-react'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import { api } from '../services/api'

function getStatus(reading) {
  if (!reading) return 'off'
  const v = reading.voltage
  const nom = 480
  if (v > nom * 1.10 || v < nom * 0.90) return 'crit'
  if (v > nom * 1.05 || v < nom * 0.95) return 'warn'
  if (reading.power_factor < 0.75) return 'crit'
  if (reading.power_factor < 0.85) return 'warn'
  return 'ok'
}

function SparkLine({ data, color = '#00b4d8' }) {
  if (!data || data.length < 2) return <div style={{ height: 40 }} />
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <Line type="monotone" dataKey="v" stroke={color} dot={false} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function MeterTile({ meter, reading, onClick }) {
  const status = getStatus(reading)
  const statusClass = status === 'crit' ? 'status-crit' : status === 'warn' ? 'status-warn' : 'status-ok'

  return (
    <div className={`meter-tile ${statusClass}`} onClick={onClick}>
      <div className="meter-tile-header">
        <span className="meter-tile-name">{meter.name}</span>
        <span className={`status-dot ${status === 'crit' ? 'crit' : status === 'warn' ? 'warn' : 'ok'}`} />
      </div>
      <div className="meter-tile-metrics">
        <div className="metric-cell">
          <span className="metric-label">Voltage</span>
          <span className="metric-value">{reading?.voltage?.toFixed(1) ?? '--'}</span>
          <span className="metric-unit">V</span>
        </div>
        <div className="metric-cell">
          <span className="metric-label">Current</span>
          <span className="metric-value">{reading?.current?.toFixed(1) ?? '--'}</span>
          <span className="metric-unit">A</span>
        </div>
        <div className="metric-cell">
          <span className="metric-label">Power</span>
          <span className="metric-value">{reading?.power_kw?.toFixed(1) ?? '--'}</span>
          <span className="metric-unit">kW</span>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard({ readings }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)
  const [meters, setMeters] = useState([])
  const [history, setHistory] = useState([])

  useEffect(() => {
    api.getSystemStatus().then(setStatus).catch(() => {})
    api.getMeters().then(setMeters).catch(() => {})
  }, [])

  // Refresh status when readings update
  useEffect(() => {
    api.getSystemStatus().then(setStatus).catch(() => {})
  }, [readings])

  // Build sparkline history from readings over time
  useEffect(() => {
    setHistory(prev => {
      const totalPower = Object.values(readings).reduce((s, r) => s + (r.power_kw || 0), 0)
      const next = [...prev, { v: totalPower, t: Date.now() }]
      return next.slice(-60)
    })
  }, [readings])

  const healthColor = status?.health === 'critical' ? 'var(--status-crit)'
    : status?.health === 'warning' ? 'var(--status-warn)'
    : 'var(--status-ok)'

  return (
    <div>
      <div className="page-header">
        <h2>System Overview</h2>
        <p>Real-time electrical distribution monitoring</p>
      </div>

      {/* Summary cards */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-card-label">Total Load</div>
          <div className="stat-card-value mono">{status?.total_power_kw?.toFixed(1) ?? '--'}</div>
          <div className="stat-card-sub">kW</div>
          <SparkLine data={history} color="var(--accent)" />
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Avg Power Factor</div>
          <div className="stat-card-value mono" style={{
            color: (status?.avg_power_factor ?? 1) < 0.85 ? 'var(--status-warn)' : 'var(--text-primary)'
          }}>
            {status?.avg_power_factor?.toFixed(3) ?? '--'}
          </div>
          <div className="stat-card-sub">System average</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Active Alarms</div>
          <div className="stat-card-value mono" style={{
            color: (status?.active_alarm_count ?? 0) > 0 ? 'var(--status-crit)' : 'var(--status-ok)'
          }}>
            {status?.active_alarm_count ?? '--'}
          </div>
          <div className="stat-card-sub">
            {status?.critical_alarm_count > 0
              ? `${status.critical_alarm_count} critical`
              : 'No critical alarms'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">System Health</div>
          <div className="stat-card-value" style={{ fontSize: 18, color: healthColor }}>
            {status?.health?.toUpperCase() ?? '--'}
          </div>
          <div className="stat-card-sub">{status?.meters_online ?? 0} / {status?.meter_count ?? 0} meters online</div>
        </div>
      </div>

      {/* Meter grid */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>METER OVERVIEW</h3>
      </div>
      <div className="grid-auto">
        {meters.map(m => (
          <MeterTile
            key={m.id}
            meter={m}
            reading={readings[m.id]}
            onClick={() => navigate(`/meters?id=${m.id}`)}
          />
        ))}
      </div>
    </div>
  )
}
