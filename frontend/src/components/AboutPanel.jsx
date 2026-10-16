import React, { useEffect, useRef, useState } from 'react'
import { X, FlaskConical, Play, Github } from 'lucide-react'
import { useFeed } from '../services/LiveFeed'
import { api } from '../services/api'
import StateLegend from './StateLegend'

const REPO_URL = 'https://github.com/AddisonTech/power-dashboard'

export function ScenarioButtons({ onDone }) {
  const { demo, system } = useFeed()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const running = system?.scenario

  if (!demo?.events_enabled) {
    return <p className="muted">Demo events are disabled on this server.</p>
  }

  const fire = async (name) => {
    setBusy(name)
    setError(null)
    try {
      await api.triggerEvent(name)
      onDone?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="scenario-list">
      {running && (
        <div className="scenario-running">
          <span className="pulse-dot" /> {running.label} in progress
        </div>
      )}
      {demo.scenarios.map(s => (
        <button key={s.name} className="scenario-btn" disabled={!!running || !!busy} onClick={() => fire(s.name)}>
          <Play size={14} />
          <span>
            <strong>{s.label}</strong>
            <small>{s.description}</small>
          </span>
        </button>
      ))}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

export default function AboutPanel({ open, onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    closeRef.current?.focus()
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title"
        onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="about-title">About this demo</h2>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div className="sim-notice">
            <FlaskConical size={18} />
            <div>
              <strong>All data on this site is simulated.</strong> No real facility, customer, or
              equipment is connected. A Python simulator models a small data center and updates every
              2 seconds.
            </div>
          </div>

          <section>
            <h3>What is modeled</h3>
            <p>
              A 2N data center of about 450 kW: a 480 V utility service and a 750 kW standby generator
              feed an automatic transfer switch, then the main switchboard. Two 400 kVA UPS systems
              (A side and B side) each feed two 150 kVA PDUs at 208 V, and the cooling plant runs from
              its own panel. Values roll up from the IT load through transformer and UPS losses, so
              the numbers add up the way a real site does.
            </p>
          </section>

          <section>
            <h3>Try it</h3>
            <p className="muted">
              Events also happen on their own every few minutes. The event rate is faster than a real
              site so there is always something to look at.
            </p>
            <ScenarioButtons onDone={onClose} />
          </section>

          <section>
            <h3>ISA 18.2 alarm handling</h3>
            <p>
              Every alarm in the master alarm database is rationalized with a priority, a consequence,
              and an operator response. Alarms follow the ISA 18.2 state model, use deadbands and
              delays to prevent chatter, can be shelved for a limited time with a logged reason, and
              some are suppressed by design (for example, generator alarms while the generator is off).
              Every transition is written to the alarm journal.
            </p>
            <StateLegend compact />
          </section>

          <section>
            <h3>Real hardware</h3>
            <p>
              The same backend polls Modbus TCP meters when started with <code>DATA_SOURCE=modbus</code> and
              a register map. The alarm engine, history, and this interface work the same either way.
            </p>
          </section>

          <section>
            <h3>Stack</h3>
            <p>Python, FastAPI, WebSocket, SQLite, React, Vite. Hosted on Render.</p>
            <a className="btn btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer">
              <Github size={14} /> Source on GitHub
            </a>
          </section>
        </div>
      </div>
    </div>
  )
}
