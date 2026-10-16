import React, { useEffect, useState } from 'react'
import { Wifi, Database, User, Cpu } from 'lucide-react'
import { useFeed } from '../services/LiveFeed'
import { api } from '../services/api'
import { API_URL, WS_URL } from '../services/endpoints'
import { getOperator, setOperator } from '../lib/operator'
import { PriorityBadge } from '../components/Badges'

function Rows({ rows }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>)}
    </dl>
  )
}

export default function SettingsPage() {
  const { system, demo } = useFeed()
  const [cfg, setCfg] = useState(null)
  const [name, setName] = useState(getOperator)
  const [saved, setSaved] = useState(false)

  useEffect(() => { api.getConfig().then(setCfg).catch(() => {}) }, [])

  const save = (e) => {
    e.preventDefault()
    setOperator(name.trim() || 'demo visitor')
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>System</h2>
          <p>Data source, connection, and alarm configuration</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="card">
          <div className="card-head"><h3><Cpu size={14} /> Data source</h3></div>
          <Rows rows={[
            ['Mode', system?.simulated ? 'Simulator (demo)' : 'Modbus TCP'],
            ['Scan interval', `${cfg?.poll_interval_s ?? demo?.poll_interval_s ?? '--'} s`],
            ['History interval', `${cfg?.history_interval_s ?? '--'} s`],
            ['Meters online', `${system?.meters_online ?? '--'} / ${system?.meter_count ?? '--'}`],
            ['Version', cfg?.version ?? demo?.version ?? '--'],
          ]} />
          <p className="muted small">
            Real meters are polled over Modbus TCP when the backend runs with DATA_SOURCE=modbus and a
            register map. See the README for setup.
          </p>
        </div>

        <div className="card">
          <div className="card-head"><h3><Wifi size={14} /> Connection</h3></div>
          <Rows rows={[
            ['API', API_URL || window.location.origin],
            ['WebSocket', WS_URL],
          ]} />
        </div>

        <div className="card">
          <div className="card-head"><h3><User size={14} /> Operator</h3></div>
          <form className="operator-form" onSubmit={save}>
            <label htmlFor="op-name" className="muted small">Name recorded in the alarm journal for acknowledge and shelve actions</label>
            <div className="operator-row">
              <input id="op-name" type="text" value={name} maxLength={40} onChange={e => setName(e.target.value)} />
              <button className="btn btn-primary btn-sm" type="submit">{saved ? 'Saved' : 'Save'}</button>
            </div>
          </form>
        </div>

        <div className="card">
          <div className="card-head"><h3><Database size={14} /> Retention</h3></div>
          <Rows rows={[
            ['Readings', `${cfg?.retention_days ?? '--'} days`],
            ['Alarm journal', `${cfg?.retention_days ?? '--'} days`],
            ['Shelving limit', `${cfg?.shelve_max_min ?? '--'} min`],
            ['Database', 'SQLite'],
          ]} />
        </div>

        <div className="card span-2">
          <div className="card-head"><h3>Alarm priorities</h3></div>
          <p className="muted small">Priority comes from the consequence of not responding and the time available to respond.</p>
          <dl className="kv">
            {cfg && Object.entries(cfg.priorities).map(([p, info]) => (
              <div key={p}><dt><PriorityBadge priority={Number(p)} /></dt><dd>{info.response}</dd></div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}
