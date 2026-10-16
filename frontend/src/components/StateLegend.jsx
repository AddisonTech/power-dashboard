import React from 'react'
import { STATES } from '../lib/alarms'
import { StateBadge } from './Badges'

// The ISA 18.2 alarm state model, in a form a visitor can follow
export default function StateLegend({ compact = false }) {
  return (
    <div className="state-legend">
      <div className="state-flow" aria-label="Alarm state transitions">
        <div className="flow-row">
          <span className="flow-node">Normal</span>
          <span className="flow-arrow">condition<span>&rarr;</span></span>
          <span className="flow-node unack">Unacknowledged</span>
          <span className="flow-arrow">acknowledge<span>&rarr;</span></span>
          <span className="flow-node acked">Acknowledged</span>
          <span className="flow-arrow">clears<span>&rarr;</span></span>
          <span className="flow-node">Normal</span>
        </div>
        <div className="flow-row">
          <span className="flow-node unack">Unacknowledged</span>
          <span className="flow-arrow">clears<span>&rarr;</span></span>
          <span className="flow-node rtn">Returned to normal, unack</span>
          <span className="flow-arrow">acknowledge<span>&rarr;</span></span>
          <span className="flow-node">Normal</span>
        </div>
      </div>
      {!compact && (
        <dl className="state-list">
          {['UNACK', 'ACKED', 'RTN_UNACK', 'SHELVED', 'SUPPRESSED'].map(s => (
            <div key={s} className="state-list-row">
              <dt><StateBadge state={s} priority={s === 'SHELVED' || s === 'SUPPRESSED' ? 4 : 2} /></dt>
              <dd>{STATES[s].help}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
