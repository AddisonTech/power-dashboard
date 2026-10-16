import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download, ListOrdered, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import { api, exportJournalUrl } from '../services/api'
import { PriorityBadge } from '../components/Badges'
import { clockIn, dateTimeIn, viewerZone, zoneLabel } from '../lib/zone'
import {
  capitalize, chartGeometry, evidenceText, floodParts, itemWriter, reduction, ruleLabel, writerLabel,
} from '../lib/triage'

const CHART_W = 320
const CHART_H = 72

export function EvidenceChart({ evidence }) {
  const g = chartGeometry(evidence, CHART_W, CHART_H)
  if (!g) return <div className="tri-chart tri-chart-empty">No trend samples</div>
  return (
    <svg className="tri-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none"
      role="img" aria-label="Trend evidence with the alarm limit">
      {g.shade && <rect className="tri-past" x={g.shade.x} y="0" width={g.shade.width} height={CHART_H} />}
      <line className="tri-limit" x1="0" x2={CHART_W} y1={g.limitY} y2={g.limitY} vectorEffect="non-scaling-stroke" />
      <path className="tri-line" d={g.path} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Consequences({ items, zone }) {
  const [open, setOpen] = useState(false)
  if (!items.length) {
    return <p className="muted small tri-alone">Nothing else in this window depends on it.</p>
  }
  return (
    <div className="tri-cq">
      <button className="tri-cq-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        Explains {items.length} more alarm{items.length === 1 ? '' : 's'}, collapsed under this cause
      </button>
      {open && (
        <ul className="tri-cq-list">
          {items.map(c => (
            <li key={c.point}>
              <div className="tri-cq-head">
                <PriorityBadge priority={c.priority} compact />
                <span className="tri-cq-label">{capitalize(c.label)}</span>
                <span className="muted small mono">{clockIn(c.start, zone.name, zone.labels)}</span>
              </div>
              <div className="muted small mono tri-point">{c.point}</div>
              <div className="small tri-cq-why">{evidenceText(c.evidence, zone)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function TriageItem({ item, zone }) {
  return (
    <article className={`tri-item p${item.priority}`}>
      <header className="tri-item-head">
        <div className="tri-rank" aria-label={`Rank ${item.rank}`}>{item.rank}</div>
        <div className="tri-title">
          <div className="tri-label">{capitalize(item.label)}</div>
          <div className="muted small mono tri-point">{item.point}</div>
          <div className="tri-chips">
            <PriorityBadge priority={item.priority} />
            <span className="tri-chip"><b>{item.rule}</b> {ruleLabel(item.rule)}</span>
            {item.consequences.length > 0 && <span className="tri-chip tri-chip-cause">Root cause</span>}
          </div>
        </div>
      </header>

      <div className="tri-say">
        <p className="tri-say-label">Why it matters</p>
        <p>{item.reason}</p>
      </div>
      <div className="tri-say tri-say-step">
        <p className="tri-say-label">Next step</p>
        <p>{item.next_step}</p>
      </div>

      <figure className="tri-evidence">
        <figcaption className="tri-say-label">Trend evidence</figcaption>
        <EvidenceChart evidence={item.evidence} />
        <p className="small muted">{evidenceText(item.evidence, zone)}</p>
      </figure>

      <Consequences items={item.consequences} zone={zone} />

      <footer className="tri-foot">
        <span className={`tri-writer ${/haiku/i.test(item.written_by) ? 'haiku' : 'template'}`}>
          {itemWriter(item.written_by)}
        </span>
        <span className="muted small">{dateTimeIn(item.start, zone.name, zone.labels)}</span>
      </footer>
    </article>
  )
}

// The zone the agent wrote its text in, with the labels for its offsets
function zoneOf(data) {
  return { name: data.triage.time_zone?.name || data.zone?.name || 'UTC', labels: data.zone?.labels || {} }
}

export function ZoneNote({ zone, at }) {
  if (!zone) return null
  const label = at ? zoneLabel(at, zone.name, zone.labels) : 'UTC'
  return (
    <span className="muted small tri-zone">
      Times in {zone.name}{label === zone.name ? '' : ` (${label})`}
    </span>
  )
}

export function TriageResult({ data }) {
  const result = data.triage
  const zone = zoneOf(data)
  const counts = result.counts
  const r = reduction(counts)
  return (
    <>
      <div className="kpi-grid">
        <div className="stat-card tone-p2">
          <div className="stat-card-label">Alarm flood</div>
          <div className="stat-card-value">{r.flood}</div>
          <div className="stat-card-sub">journal entries: {floodParts(counts)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Ranked items</div>
          <div className="stat-card-value">{r.items}</div>
          <div className="stat-card-sub">
            {counts.consequences_collapsed} collapsed under their cause{counts.nuisance ? `, ${counts.nuisance} nuisance` : ''}{counts.unresolved ? `, ${counts.unresolved} unresolved` : ''}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Reduction</div>
          <div className="stat-card-value">{r.ratio ? `${r.ratio.toFixed(0)}x` : '--'}</div>
          <div className="stat-card-sub">{r.flood} to read down to {r.items}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Writer</div>
          <div className="stat-card-value small-value">{result.writer.kind === 'haiku' ? 'Claude Haiku' : 'Template'}</div>
          <div className="stat-card-sub">{writerLabel(result.writer)}. Same guardrails either way.</div>
        </div>
      </div>

      {result.items.length === 0 && (
        <div className="card empty-state"><p>No item in this window needed escalating.</p></div>
      )}
      <div className="tri-list">
        {result.items.map(item => <TriageItem key={item.point} item={item} zone={zone} />)}
      </div>

      {(result.nuisance.length > 0 || result.unresolved.length > 0) && (
        <div className="card">
          <div className="card-head"><h3>Set aside</h3></div>
          <ul className="tri-aside">
            {result.nuisance.map(n => (
              <li key={n.point}><span className="mono small">{n.point}</span> <span className="muted small">{n.finding}</span></li>
            ))}
            {result.unresolved.map(u => (
              <li key={u.point}><span className="mono small">{u.point}</span> <span className="muted small">{u.reason}</span></li>
            ))}
          </ul>
        </div>
      )}

      <p className="muted small tri-note">
        <ShieldCheck size={13} /> Read only. The agent gets a copy of the alarm journal and trend history for this
        window and has no path back to the alarm manager or any meter. Agent {result.agent_version}, run in{' '}
        {data.elapsed_ms} ms{data.cached ? ' (unchanged window, stored result)' : ''}.
      </p>
    </>
  )
}

export default function Triage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [timeZone] = useState(viewerZone)
  const [event, setEvent] = useState(undefined)
  const [zone, setZone] = useState({ name: timeZone, labels: {} })
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const autoRan = useRef(false)

  const loadEvent = useCallback(() => {
    api.getTriageEvent(timeZone)
      .then(r => { setEvent(r.event); if (r.zone) setZone(r.zone) })
      .catch(() => setEvent(null))
  }, [timeZone])

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.runTriage({ time_zone: timeZone })
      setData(res)
      setEvent(e => ({ ...(e || {}), ...res.event }))
      if (res.zone) setZone(res.zone)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [timeZone])

  useEffect(() => { loadEvent() }, [loadEvent])

  // Arriving from the "Triage this event" button runs straight away
  useEffect(() => {
    if (location.state?.run && !autoRan.current) {
      autoRan.current = true
      navigate(location.pathname, { replace: true, state: null })
      run()
    }
  }, [location.state, location.pathname, navigate, run])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Triage</h2>
          <p>The BMS Alarm Triage Agent cuts the alarm flood from the latest event to a short ranked list</p>
        </div>
      </div>

      <div className="card tri-controls">
        <div className="tri-event">
          <ListOrdered size={18} className="brand-icon" />
          {event === undefined && <span className="muted">Looking for the latest event...</span>}
          {event === null && <span className="muted">No alarm event yet. Trigger one from About this demo.</span>}
          {event && (
            <span>
              Latest event: first alarm <span className="mono">{dateTimeIn(event.first_alarm, zone.name, zone.labels)}</span>
              {event.alarms ? <span className="muted">, {event.alarms} alarm{event.alarms === 1 ? '' : 's'}</span> : null}
              <br /><ZoneNote zone={zone} at={event.first_alarm} />
            </span>
          )}
        </div>
        <div className="tri-actions">
          <button className="btn btn-primary" onClick={run} disabled={busy || !event}>
            {busy ? <RefreshCw size={14} className="spin" /> : data ? <RefreshCw size={14} /> : <Play size={14} />}
            {busy ? 'Triaging...' : data ? 'Run again' : 'Triage this event'}
          </button>
          {event && (
            <a className="btn btn-ghost" href={exportJournalUrl(event.start, event.end)} download>
              <Download size={14} /> Journal export
            </a>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>

      {data && <TriageResult data={data} />}

      {!data && !busy && (
        <div className="card tri-intro">
          <p>
            An outage raises a flood: the utility fails, both UPS systems go to battery, the generator starts,
            the transfer switch moves, and the generator frequency dips when the load lands. The agent reads the
            alarm journal and trend history for the window around the event, ranks the root cause first, and
            folds its consequences underneath it, with the trend evidence and a next step for each item.
          </p>
          <p className="muted small">
            The text is written by a fixed template from each item's own evidence. Claude Haiku writes it only
            when the server has an API key set, and the hosted demo has none. Every reply passes the same checks
            either way: a diagnostic verb from a closed list, the item's own equipment as the target, and no
            control action.
          </p>
        </div>
      )}
    </div>
  )
}
