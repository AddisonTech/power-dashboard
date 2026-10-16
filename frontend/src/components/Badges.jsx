import React from 'react'
import { PRIORITY, STATES } from '../lib/alarms'

export function PriorityBadge({ priority, compact = false }) {
  const p = PRIORITY[priority] || PRIORITY[4]
  return (
    <span className={`prio-badge ${p.cls}`} title={`Priority ${priority}: ${p.label}`}>
      P{priority}{!compact && <span className="prio-label">{p.label}</span>}
    </span>
  )
}

export function StateBadge({ state, priority }) {
  const s = STATES[state] || STATES.NORMAL
  const p = PRIORITY[priority] || PRIORITY[4]
  return (
    <span className={`state-badge state-${state.toLowerCase()} ${p.cls}`} title={s.help}>
      <span className="state-icon" aria-hidden="true" />
      {s.short}
    </span>
  )
}
