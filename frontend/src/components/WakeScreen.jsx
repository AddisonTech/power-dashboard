import React, { useEffect, useState } from 'react'
import { Zap, Check, Loader2, RotateCcw } from 'lucide-react'

const EXPECTED_S = 50
const SLOW_S = 90

function Step({ done, active, children }) {
  return (
    <li className={`wake-step${done ? ' done' : ''}${active ? ' active' : ''}`}>
      <span className="wake-step-icon">
        {done ? <Check size={14} /> : active ? <Loader2 size={14} className="spin" /> : null}
      </span>
      {children}
    </li>
  )
}

export default function WakeScreen({ serverAwake, startedAt, retry }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const quick = elapsed < 4 && !serverAwake
  const slow = elapsed >= SLOW_S && !serverAwake
  const pct = serverAwake ? 92 : Math.min(88, (elapsed / EXPECTED_S) * 88)

  const title = quick
    ? 'Connecting to the live system'
    : serverAwake
      ? 'Server is awake, starting the live feed'
      : 'Waking up the demo server'

  return (
    <div className="wake-screen" role="status" aria-live="polite">
      <div className="wake-card">
        <div className="wake-brand">
          <Zap size={22} /> <span>Power Dashboard</span>
        </div>
        <h1>{title}</h1>

        {!quick && (
          <p className="wake-text">
            This portfolio demo is hosted on a free tier that sleeps when nobody is using it.
            The first visit after a quiet period takes about 30 to 60 seconds while the server
            starts. After that, everything updates live every 2 seconds.
          </p>
        )}

        <div className="wake-progress" aria-hidden="true">
          <div className="wake-progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="wake-elapsed mono">{elapsed}s</div>

        <ol className="wake-steps">
          <Step done={serverAwake} active={!serverAwake}>Contact the server</Step>
          <Step done={serverAwake} active={false}>Start the simulator and build 24 h of history</Step>
          <Step done={false} active={serverAwake}>Open the live data feed</Step>
        </ol>

        {slow && (
          <div className="wake-slow">
            <p>This is taking longer than usual. The server may still be starting.</p>
            <button className="btn btn-primary" onClick={retry}>
              <RotateCcw size={14} /> Try again
            </button>
          </div>
        )}

        <div className="wake-preview">
          <div className="wake-preview-title">While you wait, here is what you will see</div>
          <ul>
            <li>A simulated 2N data center: utility, generator, ATS, switchboard, UPS A and B, PDUs, cooling</li>
            <li>A live one-line diagram that follows the power path during a utility outage</li>
            <li>ISA 18.2 alarm handling: acknowledge, shelve, return to normal, and a full alarm journal</li>
            <li>Buttons to trigger events yourself, from a voltage sag to a full outage</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
