import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { useFeed } from '../services/LiveFeed'
import { api } from '../services/api'
import { getOperator } from '../lib/operator'
import { ago } from '../lib/format'
import { PriorityBadge, StateBadge } from './Badges'

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
