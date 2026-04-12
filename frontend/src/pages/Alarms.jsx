import React, { useState, useEffect } from 'react'
import { Bell, CheckSquare, Clock, Filter } from 'lucide-react'
import { api } from '../services/api'

const PRIORITY_LABELS = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low' }
const PRIORITY_CLASSES = { 1: 'crit', 2: 'warn', 3: 'accent', 4: 'off' }

function AlarmRow({ alarm, onAck }) {
  const pClass = PRIORITY_CLASSES[alarm.priority] || 'off'
  return (
    <tr className={`priority-${alarm.priority}`}>
      <td><span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(alarm.raised_at).toLocaleString()}</span></td>
      <td style={{ fontWeight: 500 }}>{alarm.meter_name}</td>
      <td>{alarm.condition}</td>
      <td><span className="mono">{alarm.value?.toFixed(3)}</span></td>
      <td><span className="mono">{alarm.threshold?.toFixed(3)}</span></td>
      <td>
        <span className={`badge badge-${pClass === 'accent' ? 'ok' : pClass}`}>
          P{alarm.priority} {PRIORITY_LABELS[alarm.priority]}
        </span>
      </td>
      <td>
        {alarm.state === 'active' && !alarm.acknowledged ? (
          <button className="btn btn-warn" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => onAck(alarm.id)}>
            Acknowledge
          </button>
        ) : alarm.acknowledged ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>ACK</span>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Cleared</span>
        )}
      </td>
    </tr>
  )
}

export default function Alarms() {
  const [tab, setTab] = useState('active')
  const [active, setActive] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([api.getAlarms(), api.getAlarmHistory()])
      .then(([a, h]) => { setActive(a); setHistory(h) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  const ack = (id) => {
    api.acknowledgeAlarm(id).then(load)
  }

  const displayed = tab === 'active' ? active : history

  return (
    <div>
      <div className="page-header">
        <h2>Alarm Management</h2>
        <p>ISA 18.2 aligned alarm management system</p>
      </div>

      {/* Summary */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Active Alarms', value: active.length,                    color: 'var(--status-crit)' },
          { label: 'Critical (P1)', value: active.filter(a=>a.priority===1).length, color: 'var(--status-crit)' },
          { label: 'High (P2)',     value: active.filter(a=>a.priority===2).length, color: 'var(--status-warn)' },
          { label: 'Total History', value: history.length,                   color: 'var(--text-secondary)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-card-label">{label}</div>
            <div className="stat-card-value mono" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="tab-bar">
          <button className={`tab-btn${tab === 'active' ? ' active' : ''}`} onClick={() => setTab('active')}>
            Active ({active.length})
          </button>
          <button className={`tab-btn${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
            History ({history.length})
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Meter</th>
                <th>Condition</th>
                <th>Value</th>
                <th>Threshold</th>
                <th>Priority</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  {tab === 'active' ? 'No active alarms' : 'No alarm history'}
                </td></tr>
              ) : (
                displayed.map(a => <AlarmRow key={a.id} alarm={a} onAck={ack} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
