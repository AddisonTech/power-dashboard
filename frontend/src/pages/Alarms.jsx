import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Clock, HelpCircle } from 'lucide-react'
import { useFeed } from '../services/LiveFeed'
import { api } from '../services/api'
import { PriorityBadge, StateBadge } from '../components/Badges'
import StateLegend from '../components/StateLegend'
import { ANNUNCIATED, NEEDS_ACK, EVENT_LABELS, PRIORITY, STATES } from '../lib/alarms'
import { alarmValue, setpointText, dateTimeOf, ago, until, timeOf } from '../lib/format'
import { getOperator } from '../lib/operator'

const SHELVE_OPTIONS = [5, 15, 60]
const TABS = [
  { key: 'active', label: 'Alarm list' },
  { key: 'shelved', label: 'Shelved' },
  { key: 'suppressed', label: 'Suppressed' },
  { key: 'history', label: 'Journal' },
  { key: 'database', label: 'Alarm database' },
]

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function ShelveForm({ alarm, onDone, onCancel }) {
  const [minutes, setMinutes] = useState(15)
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.shelve(alarm.tag, minutes, reason || 'Shelved from the demo', getOperator())
      onDone()
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <form className="shelve-form" onSubmit={submit}>
      <div className="shelve-label">Shelve for</div>
      <div className="seg">
        {SHELVE_OPTIONS.map(m => (
          <button type="button" key={m} className={`seg-btn${minutes === m ? ' active' : ''}`} onClick={() => setMinutes(m)}>
            {m} min
          </button>
        ))}
      </div>
      <input type="text" placeholder="Reason (logged in the journal)" value={reason} maxLength={200}
        onChange={e => setReason(e.target.value)} aria-label="Shelve reason" />
      <div className="shelve-actions">
        <button type="submit" className="btn btn-sm btn-primary">Shelve</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="form-error">{error}</p>}
      <p className="muted small">ISA 18.2 shelving is time limited. The alarm returns automatically when the timer runs out.</p>
    </form>
  )
}

function AlarmRow({ alarm, now }) {
  const [open, setOpen] = useState(false)
  const [shelving, setShelving] = useState(false)
  const [error, setError] = useState(null)
  const needsAck = NEEDS_ACK.includes(alarm.state)

  const act = useCallback(async (fn) => {
    setError(null)
    try { await fn() } catch (e) { setError(e.message) }
  }, [])

  return (
    <div className={`alarm-row p${alarm.priority} state-${alarm.state.toLowerCase()}`}>
      <div className="alarm-main">
        <button className="alarm-expand" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Details">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="alarm-cell alarm-time">
          <span className="mono">{timeOf(alarm.activated_at || alarm.shelved_at)}</span>
          <span className="muted small">{ago(alarm.activated_at || alarm.shelved_at, now)}</span>
        </div>
        <div className="alarm-cell alarm-desc">
          <div className="alarm-msg">{alarm.message}</div>
          <div className="muted small"><span className="mono">{alarm.tag}</span>, {alarm.meter_name}</div>
          {alarm.state === 'SUPPRESSED' && <div className="muted small">{alarm.suppress_reason}</div>}
        </div>
        <div className="alarm-cell alarm-val">
          <span className="mono">{alarmValue(alarm)}</span>
          <span className="muted small">{alarm.kind === 'DISCRETE' ? 'discrete signal' : `limit ${setpointText(alarm)}`}</span>
        </div>
        <div className="alarm-cell alarm-prio"><PriorityBadge priority={alarm.priority} /></div>
        <div className="alarm-cell alarm-state"><StateBadge state={alarm.state} priority={alarm.priority} /></div>
        <div className="alarm-cell alarm-actions">
          {needsAck && (
            <button className="btn btn-sm btn-ack" onClick={() => act(() => api.acknowledge(alarm.tag, getOperator()))}>
              Acknowledge
            </button>
          )}
          {ANNUNCIATED.includes(alarm.state) && (
            <button className="btn btn-sm btn-ghost" onClick={() => setShelving(s => !s)}>Shelve</button>
          )}
          {alarm.state === 'SHELVED' && (
            <>
              <span className="muted small"><Clock size={12} /> {until(alarm.shelved_until, now)} left</span>
              <button className="btn btn-sm btn-ghost" onClick={() => act(() => api.unshelve(alarm.tag, getOperator()))}>
                Unshelve
              </button>
            </>
          )}
        </div>
      </div>
      {shelving && (
        <ShelveForm alarm={alarm} onDone={() => setShelving(false)} onCancel={() => setShelving(false)} />
      )}
      {error && <p className="form-error">{error}</p>}
      {open && (
        <dl className="alarm-details">
          <div><dt>Consequence</dt><dd>{alarm.consequence}</dd></div>
          <div><dt>Operator response</dt><dd>{alarm.response}</dd></div>
          <div><dt>Value at alarm</dt><dd className="mono">{alarmValue(alarm, alarm.alarm_value)}</dd></div>
          <div><dt>Current value</dt><dd className="mono">{alarmValue(alarm)}</dd></div>
          {alarm.ack_at && <div><dt>Acknowledged</dt><dd>{dateTimeOf(alarm.ack_at)} by {alarm.ack_by}</dd></div>}
          {alarm.rtn_at && <div><dt>Returned to normal</dt><dd>{dateTimeOf(alarm.rtn_at)}</dd></div>}
          {alarm.shelve_reason && <div><dt>Shelved</dt><dd>{alarm.shelve_reason}, by {alarm.shelved_by}, until {timeOf(alarm.shelved_until)}</dd></div>}
          {alarm.suppress_reason && <div><dt>Suppression rule</dt><dd>{alarm.suppress_reason}</dd></div>}
        </dl>
      )}
    </div>
  )
}

function AlarmList({ alarms, empty, now }) {
  if (alarms.length === 0) return <div className="empty-state"><p>{empty}</p></div>
  return (
    <div className="alarm-list">
      <div className="alarm-list-head">
        <span /><span>Time</span><span>Alarm</span><span>Value</span><span>Priority</span><span>State</span><span>Action</span>
      </div>
      {alarms.map(a => <AlarmRow key={a.tag} alarm={a} now={now} />)}
    </div>
  )
}

function Journal({ refreshKey }) {
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('ALL')
  useEffect(() => {
    let cancelled = false
    api.getAlarmHistory(300).then(r => { if (!cancelled) setRows(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [refreshKey])

  if (!rows) return <div className="empty-state"><p>Loading journal...</p></div>
  const shown = filter === 'ALL' ? rows : rows.filter(r => r.event === filter)
  return (
    <>
      <div className="seg journal-filter">
        {['ALL', 'ALARM', 'ACK', 'RTN', 'SHELVE', 'SUPPRESS'].map(f => (
          <button key={f} className={`seg-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'ALL' ? 'All' : EVENT_LABELS[f]}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Time</th><th>Event</th><th>Alarm</th><th>Priority</th><th>Value</th><th>State after</th><th>By</th></tr>
          </thead>
          <tbody>
            {shown.map(e => (
              <tr key={e.id} className={`ev-${e.event.toLowerCase()}`}>
                <td className="mono nowrap">{dateTimeOf(e.timestamp)}</td>
                <td><span className={`ev-tag ev-${e.event.toLowerCase()}`}>{EVENT_LABELS[e.event] || e.event}</span></td>
                <td>
                  <div>{e.message}</div>
                  <div className="muted small mono">{e.tag}{e.note ? `, ${e.note}` : ''}</div>
                </td>
                <td><PriorityBadge priority={e.priority} compact /></td>
                <td className="mono nowrap">{e.value == null ? '--' : alarmValue({ unit: e.unit, kind: e.unit === '' && e.setpoint === 1 ? 'DISCRETE' : 'HI' }, e.value)}</td>
                <td className="nowrap">{STATES[e.state]?.short || e.state}</td>
                <td className="nowrap muted">{e.operator}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={7} className="empty-cell">No journal entries</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

function AlarmDatabase() {
  const [defs, setDefs] = useState(null)
  useEffect(() => { api.getAlarmDefs().then(setDefs).catch(() => {}) }, [])
  if (!defs) return <div className="empty-state"><p>Loading alarm database...</p></div>
  return (
    <>
      <p className="muted db-intro">
        The master alarm database. Each alarm was rationalized: it has one cause, a priority based on
        consequence and time to respond, and a documented operator response. Deadbands and delays
        keep noisy signals from chattering.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Tag</th><th>Alarm</th><th>Limit</th><th>Deadband</th><th>Delay on/off</th><th>Priority</th><th>Operator response</th></tr>
          </thead>
          <tbody>
            {defs.map(d => (
              <tr key={d.tag}>
                <td className="mono nowrap">{d.tag}</td>
                <td>
                  <div>{d.message}</div>
                  {d.suppression && <div className="muted small">Suppressed when: {d.suppression}</div>}
                </td>
                <td className="mono nowrap">{setpointText(d)}</td>
                <td className="mono nowrap">{d.kind === 'DISCRETE' ? '--' : `${d.deadband} ${d.unit}`}</td>
                <td className="mono nowrap">{d.on_delay} / {d.off_delay} scans</td>
                <td><PriorityBadge priority={d.priority} /></td>
                <td className="small">{d.response}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function Alarms() {
  const { alarms, summary } = useFeed()
  const [tab, setTab] = useState('active')
  const [showHelp, setShowHelp] = useState(false)
  const now = useNow()

  const active = alarms.filter(a => ANNUNCIATED.includes(a.state))
  const shelved = alarms.filter(a => a.state === 'SHELVED')
  const suppressed = alarms.filter(a => a.state === 'SUPPRESSED')
  const counts = { active: active.length, shelved: shelved.length, suppressed: suppressed.length }
  const unackedActive = active.filter(a => NEEDS_ACK.includes(a.state))

  const ackAll = async () => {
    for (const a of unackedActive) {
      try { await api.acknowledge(a.tag, getOperator()) } catch { /* already handled */ }
    }
  }

  const rateTone = { Acceptable: '', Manageable: 'p3', 'Above target': 'p2', Flood: 'p1' }[summary?.rate_status] || ''

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Alarms</h2>
          <p>Alarm management following ANSI/ISA-18.2</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowHelp(s => !s)}>
          <HelpCircle size={14} /> {showHelp ? 'Hide' : 'How alarm states work'}
        </button>
      </div>

      {showHelp && <div className="card help-card"><StateLegend /></div>}

      <div className="kpi-grid kpi-alarms">
        <div className={`stat-card${summary?.unacknowledged ? ` tone-p${summary.highest_unacked?.priority}` : ''}`}>
          <div className="stat-card-label">Unacknowledged</div>
          <div className="stat-card-value">{summary?.unacknowledged ?? 0}</div>
          <div className="stat-card-sub">{summary?.rtn_unack ?? 0} returned to normal</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Alarm list by priority</div>
          <div className="prio-counts">
            {Object.entries(PRIORITY).map(([p, info]) => (
              <div key={p} className={`prio-count ${info.cls}${summary?.by_priority?.[p] ? ' on' : ''}`}>
                <span className="mono">{summary?.by_priority?.[p] ?? 0}</span>
                <small>{info.label}</small>
              </div>
            ))}
          </div>
        </div>
        <div className={`stat-card${rateTone ? ` tone-${rateTone}` : ''}`}>
          <div className="stat-card-label">Alarm rate, last 10 min</div>
          <div className="stat-card-value">{summary?.alarm_rate_10min ?? 0}</div>
          <div className="stat-card-sub">{summary?.rate_status} (ISA 18.2 target: about 1, flood at 10)</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Out of the list</div>
          <div className="stat-card-value">{(summary?.shelved ?? 0) + (summary?.suppressed ?? 0)}</div>
          <div className="stat-card-sub">{summary?.shelved ?? 0} shelved, {summary?.suppressed ?? 0} suppressed by design</div>
        </div>
      </div>

      <div className="card">
        <div className="tab-bar" role="tablist">
          {TABS.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key}
              className={`tab-btn${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}{counts[t.key] != null && <span className="tab-count">{counts[t.key]}</span>}
            </button>
          ))}
        </div>

        {tab === 'active' && (
          <>
            {unackedActive.length > 1 && (
              <div className="list-toolbar">
                <button className="btn btn-sm btn-ack" onClick={ackAll}>Acknowledge all {unackedActive.length}</button>
              </div>
            )}
            <AlarmList alarms={active} now={now}
              empty="No alarms. Trigger a demo event from About this demo to see the alarm lifecycle." />
          </>
        )}
        {tab === 'shelved' && <AlarmList alarms={shelved} now={now} empty="No shelved alarms." />}
        {tab === 'suppressed' && (
          <AlarmList alarms={suppressed} now={now}
            empty="No alarms are suppressed right now." />
        )}
        {tab === 'history' && <Journal refreshKey={`${summary?.alarm_rate_10min}-${alarms.length}-${summary?.unacknowledged}`} />}
        {tab === 'database' && <AlarmDatabase />}
      </div>
    </div>
  )
}
