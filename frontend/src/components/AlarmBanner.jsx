import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Activity, ListOrdered, X } from 'lucide-react'
import { useFeed } from '../services/LiveFeed'
import { api } from '../services/api'
import { getOperator } from '../lib/operator'
import { ago } from '../lib/format'
import { eventFinished } from '../lib/triage'
import { PriorityBadge, StateBadge } from './Badges'

const OFFER_MS = 10 * 60 * 1000 // offer triage for ten minutes after an event

// After a demo event finishes, offer to run the triage agent on it
function TriageOffer({ scenario }) {
  const navigate = useNavigate()
  const location = useLocation()
  const previous = useRef(scenario)
  const [offer, setOffer] = useState(null)

  useEffect(() => {
    if (eventFinished(previous.current, scenario)) {
      setOffer({ label: previous.current.label, at: Date.now() })
    }
    if (scenario) setOffer(null)
    previous.current = scenario
  }, [scenario])

  useEffect(() => {
    if (!offer) return undefined
    const t = setTimeout(() => setOffer(null), OFFER_MS - (Date.now() - offer.at))
    return () => clearTimeout(t)
  }, [offer])

  if (!offer || location.pathname === '/triage') return null
  return (
    <div className="event-banner triage-offer">
      <ListOrdered size={14} />
      <span className="triage-offer-msg"><strong>{offer.label}</strong> finished.</span>
      <button className="btn btn-sm btn-primary"
        onClick={() => { setOffer(null); navigate('/triage', { state: { run: true } }) }}>
        Triage this event
      </button>
      <button className="icon-btn triage-offer-close" onClick={() => setOffer(null)} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}

// Highest priority unacknowledged alarm, always visible under the top bar
export default function AlarmBanner() {
  const { summary, system } = useFeed()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const top = summary?.highest_unacked
  const scenario = system?.scenario

  return (
    <>
      <TriageOffer scenario={scenario} />
      {scenario && (
        <div className="event-banner">
          <Activity size={14} />
          <span>Demo event in progress: <strong>{scenario.label}</strong></span>
        </div>
      )}
      {top && (
        <div className={`alarm-banner p${top.priority}`}>
          <PriorityBadge priority={top.priority} compact />
          <StateBadge state={top.state} priority={top.priority} />
          <span className="alarm-banner-msg">
            <strong>{top.message}</strong>
            <span className="muted"> {top.meter_name}, {ago(top.activated_at)}</span>
          </span>
          <span className="alarm-banner-actions">
            <button className="btn btn-sm btn-ack" onClick={() => api.acknowledge(top.tag, getOperator()).catch(() => {})}>
              Acknowledge
            </button>
            <Link to="/alarms" className="btn btn-sm btn-ghost">
              {summary.unacknowledged > 1 ? `All ${summary.unacknowledged}` : 'Alarms'}
            </Link>
          </span>
        </div>
      )}
    </>
  )
}
