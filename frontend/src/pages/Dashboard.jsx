import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FlaskConical, X, ArrowRight, BatteryCharging, Plug, Server, Gauge as GaugeIcon, Bell } from 'lucide-react'
import { useFeed } from '../services/LiveFeed'
import { alarmsByMeter } from '../services/feed'
import { api } from '../services/api'
import { Sparkline, AreaChart } from '../components/Sparkline'
import { PriorityBadge, StateBadge } from '../components/Badges'
import { ANNUNCIATED } from '../lib/alarms'
import { num, ago } from '../lib/format'
import { readFlag, writeFlag } from '../lib/operator'

const GROUPS = [
  { title: 'Sources', ids: ['UTIL-1', 'GEN-1', 'ATS-1'] },
  { title: 'Distribution', ids: ['MSB-1', 'MECH-1'] },
  { title: 'UPS', ids: ['UPS-A', 'UPS-B'] },
  { title: 'PDUs', ids: ['PDU-A1', 'PDU-A2', 'PDU-B1', 'PDU-B2'] },
]

const INTRO_KEY = 'pd.intro.dismissed'

function LoadBar({ pct }) {
  const v = Math.max(0, Math.min(100, pct || 0))
  const cls = v >= 90 ? 'p2' : v >= 80 ? 'p3' : ''
  return (
    <div className="load-bar" title={`${num(pct)} % of rating`}>
      <div className={`load-bar-fill ${cls}`} style={{ width: `${v}%` }} />
    </div>
  )
}

function EquipmentTile({ meter, reading, alarm, onClick }) {
  const r = reading || {}
  const isUps = meter.type === 'ups'
  const off = (r.voltage ?? 0) < 1
  return (
    <button className={`equip-tile${alarm ? ` has-alarm p${alarm.priority}` : ''}${off ? ' off' : ''}`} onClick={onClick}>
      <div className="equip-head">
        <div>
          <div className="equip-name">{meter.name}</div>
          <div className="equip-id mono">{meter.id}</div>
        </div>
        {alarm ? <PriorityBadge priority={alarm.priority} compact /> : null}
      </div>
      <div className={`equip-status status-${(r.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{r.status || '--'}</div>
      <div className="equip-metrics">
        <div><span className="metric-value">{num(r.power_kw, 0)}</span><span className="metric-unit">kW</span></div>
        <div><span className="metric-value">{num(r.voltage, 0)}</span><span className="metric-unit">V</span></div>
        <div><span className="metric-value">{num(r.load_pct, 0)}</span><span className="metric-unit">%</span></div>
      </div>
      <LoadBar pct={r.load_pct} />
      {isUps && (
        <div className="equip-extra">
          <BatteryCharging size={13} />
          <span>{num(r.battery_soc, 0)}% charge, {num(r.battery_runtime_min, 0)} min runtime</span>
        </div>
      )}
      {alarm && <div className="equip-alarm">{alarm.message}</div>}
    </button>
  )
}

function Kpi({ label, value, unit, sub, children, tone }) {
  return (
    <div className={`stat-card${tone ? ` tone-${tone}` : ''}`}>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">
        {value}{unit && <span className="stat-card-unit">{unit}</span>}
      </div>
      {sub && <div className="stat-card-sub">{sub}</div>}
      {children}
    </div>
  )
}

export default function Dashboard({ onAbout }) {
  const { meters, meterById, readings, spark, system, alarms, summary } = useFeed()
  const navigate = useNavigate()
  const [introHidden, setIntroHidden] = useState(() => readFlag(INTRO_KEY))
  const [points, setPoints] = useState([])

  // Last hour of facility load, then extend with live scans
  useEffect(() => {
    let cancelled = false
    api.getMeterHistory('MSB-1', '1h')
      .then(rows => { if (!cancelled) setPoints(prev => [...rows.map(r => ({ t: r.epoch, v: r.power_kw })), ...prev]) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const msb = readings['MSB-1']
  useEffect(() => {
    if (!msb) return
    setPoints(prev => {
      const last = prev[prev.length - 1]
      if (last && msb.epoch - last.t < 10) return prev
      return [...prev.filter(p => p.t > msb.epoch - 3600), { t: msb.epoch, v: msb.power_kw }]
    })
  }, [msb])

  const byMeter = useMemo(() => alarmsByMeter(alarms), [alarms])
  const annunciated = alarms.filter(a => ANNUNCIATED.includes(a.state))

  const hideIntro = () => { setIntroHidden(true); writeFlag(INTRO_KEY, true) }

  const onGen = system?.power_source === 'GENERATOR'
  const runtime = system?.ups_min_runtime_min
  const anyOnBattery = readings['UPS-A']?.on_battery || readings['UPS-B']?.on_battery

  return (
    <div className="page">
      {!introHidden && system?.simulated && (
        <div className="intro-card">
          <FlaskConical size={20} className="intro-icon" />
          <div className="intro-text">
            <strong>Live demo on simulated data.</strong> This dashboard monitors a simulated 2N data
            center in real time. Events like utility outages and PDU overloads happen every few minutes,
            or you can trigger one and watch the ISA 18.2 alarm system respond.
            <div className="intro-actions">
              <button className="btn btn-primary btn-sm" onClick={onAbout}>About this demo and trigger an event</button>
            </div>
          </div>
          <button className="icon-btn" onClick={hideIntro} aria-label="Dismiss"><X size={16} /></button>
        </div>
      )}

      <div className="kpi-grid">
        <Kpi label="Facility load" value={num(system?.facility_kw, 0)} unit="kW" sub="Main switchboard">
          <Sparkline data={spark['MSB-1']} />
        </Kpi>
        <Kpi label="IT load" value={num(system?.it_kw, 0)} unit="kW"
          sub={system?.pue ? `PUE ${system.pue.toFixed(2)}` : 'PUE --'}>
          <Sparkline data={spark['PDU-A1']?.map((v, i) => v + (spark['PDU-A2']?.[i] || 0) + (spark['PDU-B1']?.[i] || 0) + (spark['PDU-B2']?.[i] || 0))} />
        </Kpi>
        <Kpi label="Power source" value={onGen ? 'Generator' : 'Utility'} tone={onGen ? 'warn' : undefined}
          sub={`Utility ${system?.utility_status?.toLowerCase() || '--'}, generator ${system?.generator_status?.toLowerCase() || '--'}`} />
        <Kpi label="UPS runtime" value={num(runtime, 0)} unit="min" tone={anyOnBattery ? 'crit' : undefined}
          sub={anyOnBattery ? 'On battery' : 'Both UPS online'} />
        <Kpi label="Alarms" value={summary?.annunciated ?? 0}
          tone={summary?.highest_unacked ? `p${summary.highest_unacked.priority}` : undefined}
          sub={`${summary?.unacknowledged ?? 0} unacknowledged, ${summary?.shelved ?? 0} shelved`} />
      </div>

      <div className="dash-row">
        <div className="card chart-card">
          <div className="card-head">
            <h3>Facility load, last hour</h3>
            <span className="muted mono">{num(system?.facility_kw, 0)} kW now</span>
          </div>
          <AreaChart points={points} height={200} unit="" />
        </div>

        <div className="card alarm-card">
          <div className="card-head">
            <h3><Bell size={14} /> Alarm list</h3>
            <Link to="/alarms" className="link">Manage <ArrowRight size={13} /></Link>
          </div>
          {annunciated.length === 0 ? (
            <div className="empty-state">
              <p>No active alarms.</p>
              <button className="btn btn-ghost btn-sm" onClick={onAbout}>Trigger a demo event</button>
            </div>
          ) : (
            <ul className="mini-alarms">
              {annunciated.slice(0, 6).map(a => (
                <li key={a.tag} className={`p${a.priority}`}>
                  <PriorityBadge priority={a.priority} compact />
                  <div className="mini-alarm-text">
                    <div>{a.message}</div>
                    <div className="muted">{a.meter_name}, {ago(a.activated_at)}</div>
                  </div>
                  <StateBadge state={a.state} priority={a.priority} />
                </li>
              ))}
              {annunciated.length > 6 && <li className="muted more">+{annunciated.length - 6} more</li>}
            </ul>
          )}
        </div>
      </div>

      {GROUPS.map(g => (
        <section key={g.title} className="equip-group">
          <h3 className="section-title">
            {g.title === 'Sources' ? <Plug size={14} /> : g.title === 'PDUs' ? <Server size={14} /> : <GaugeIcon size={14} />}
            {g.title}
          </h3>
          <div className="equip-grid">
            {g.ids.filter(id => meterById[id]).map(id => (
              <EquipmentTile key={id} meter={meterById[id]} reading={readings[id]} alarm={byMeter[id]}
                onClick={() => navigate(`/meters?id=${id}`)} />
            ))}
          </div>
        </section>
      ))}
      {meters.length === 0 && <p className="muted">No meters configured.</p>}
    </div>
  )
}
