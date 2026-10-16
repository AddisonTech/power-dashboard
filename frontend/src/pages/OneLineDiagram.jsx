import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { useFeed } from '../services/LiveFeed'
import { alarmsByMeter } from '../services/feed'
import { PriorityBadge, StateBadge } from '../components/Badges'
import { ANNUNCIATED } from '../lib/alarms'
import { num } from '../lib/format'

// Two layouts: landscape for desktop, portrait for phones. Positions are
// node center x and top y in SVG units.
const LAYOUTS = {
  wide: {
    width: 900, height: 560, busY: 318, busX: [150, 850], srcY: 100, pduY: 450, atsIn: 40, labelGap: 30,
    nodes: {
      'UTIL-1': { x: 300, y: 16, w: 160 },
      'GEN-1':  { x: 620, y: 16, w: 160 },
      'ATS-1':  { x: 460, y: 128, w: 224 },
      'MSB-1':  { x: 460, y: 232, w: 190 },
      'UPS-A':  { x: 230, y: 350, w: 150 },
      'UPS-B':  { x: 530, y: 350, w: 150 },
      'MECH-1': { x: 770, y: 350, w: 150 },
      'PDU-A1': { x: 150, y: 482, w: 136 },
      'PDU-A2': { x: 310, y: 482, w: 136 },
      'PDU-B1': { x: 450, y: 482, w: 136 },
      'PDU-B2': { x: 610, y: 482, w: 136 },
    },
  },
  narrow: {
    width: 400, height: 672, busY: 312, busX: [10, 390], srcY: 96, pduY: 436, atsIn: 30, labelGap: 22,
    nodes: {
      'UTIL-1': { x: 102, y: 10, w: 184 },
      'GEN-1':  { x: 298, y: 10, w: 184 },
      'ATS-1':  { x: 200, y: 122, w: 230 },
      'MSB-1':  { x: 200, y: 222, w: 230 },
      'UPS-A':  { x: 104, y: 334, w: 182 },
      'UPS-B':  { x: 296, y: 334, w: 182 },
      'PDU-A1': { x: 54, y: 462, w: 96 },
      'PDU-A2': { x: 151, y: 462, w: 96 },
      'PDU-B1': { x: 249, y: 462, w: 96 },
      'PDU-B2': { x: 346, y: 462, w: 96 },
      'MECH-1': { x: 200, y: 598, w: 230 },
    },
  },
}
const H = 64

function useNarrow(query = '(max-width: 720px)') {
  const get = () => typeof window !== 'undefined' && window.matchMedia?.(query).matches
  const [narrow, setNarrow] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}

function Wire({ d, state }) {
  return <path d={d} className={`wire wire-${state}`} fill="none" />
}

function Node({ n, id, meter, reading, alarm, selected, onSelect }) {
  const compact = n.w < 120
  const r = reading || {}
  const dead = (r.voltage ?? 0) < 1
  const statusCls = (r.status || '').toLowerCase().replace(/\s+/g, '-')
  let line2 = compact ? `${num(r.power_kw, 0)}kW ${num(r.load_pct, 0)}%` : `${num(r.power_kw, 0)} kW   ${num(r.load_pct, 0)}%`
  if (meter.type === 'ups') line2 = `${num(r.power_kw, 0)} kW   batt ${num(r.battery_soc, 0)}%`
  if (meter.type === 'generator' && dead) line2 = '0 kW'
  if (meter.type === 'ats') line2 = `${num(r.power_kw, 0)} kW   ${r.position === 'GENERATOR' ? 'E' : 'N'} closed`

  return (
    <g transform={`translate(${n.x - n.w / 2}, ${n.y})`} className={`ol-node${selected ? ' selected' : ''}${dead ? ' dead' : ''}${alarm ? ` p${alarm.priority} alarmed` : ''}`}
      onClick={() => onSelect(id)} role="button" tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSelect(id)}
      aria-label={`${meter.name}, ${r.status || 'no data'}`}>
      <rect width={n.w} height={H} rx={8} className="ol-box" />
      <text x={compact ? 8 : 12} y={20} className="ol-name">{meter.name}</text>
      <text x={compact ? 8 : 12} y={37} className={`ol-status status-${statusCls}`}>{r.status || '--'}</text>
      <text x={compact ? 8 : 12} y={54} className="ol-values">{line2}</text>
      {alarm && <circle cx={n.w - 12} cy={12} r={5} className="ol-alarm-dot" />}
    </g>
  )
}

export default function OneLineDiagram() {
  const { meterById, readings, alarms } = useFeed()
  const [selected, setSelected] = useState(null)
  const byMeter = useMemo(() => alarmsByMeter(alarms), [alarms])

  const live = id => (readings[id]?.voltage ?? 0) > 50
  const onGen = readings['ATS-1']?.position === 'GENERATOR'
  const msbLive = live('MSB-1')
  const wire = (energized, carrying) => (!energized ? 'dead' : carrying ? 'flow' : 'live')

  const L = LAYOUTS[useNarrow() ? 'narrow' : 'wide']
  const NODES = L.nodes
  const bottom = id => NODES[id].y + H
  const ats = NODES['ATS-1']
  const { busY, srcY, pduY } = L
  const select = id => setSelected(s => (s === id ? null : id))
  const sel = selected && meterById[selected]
  const selReading = selected ? readings[selected] || {} : null
  const selAlarms = selected ? alarms.filter(a => a.meter_id === selected && ANNUNCIATED.includes(a.state)) : []

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>One-line diagram</h2>
          <p>Live power path from the sources to the IT load. Select any equipment for details.</p>
        </div>
      </div>

      <div className="ol-layout">
        <div className="card ol-card">
          <div className="ol-legend">
            <span><i className="lg lg-flow" /> Carrying load</span>
            <span><i className="lg lg-live" /> Energized</span>
            <span><i className="lg lg-dead" /> De-energized</span>
          </div>
          <div className="ol-scroll">
            <svg viewBox={`0 0 ${L.width} ${L.height}`} className={`ol-svg ol-${L.width < 500 ? 'narrow' : 'wide'}`}
              role="img" aria-label="Electrical one-line diagram">
              {/* Sources to ATS */}
              <Wire d={`M${NODES['UTIL-1'].x},${bottom('UTIL-1')} V${srcY} H${ats.x - L.atsIn} V${ats.y}`} state={wire(live('UTIL-1'), !onGen && msbLive)} />
              <Wire d={`M${NODES['GEN-1'].x},${bottom('GEN-1')} V${srcY} H${ats.x + L.atsIn} V${ats.y}`} state={wire(live('GEN-1'), onGen && msbLive)} />
              <text x={ats.x - L.atsIn - L.labelGap} y={srcY - 4} className="ol-wire-label">N</text>
              <text x={ats.x + L.atsIn + L.labelGap - 8} y={srcY - 4} className="ol-wire-label">E</text>

              {/* ATS to switchboard to bus */}
              <Wire d={`M${ats.x},${bottom('ATS-1')} V${NODES['MSB-1'].y}`} state={wire(msbLive, msbLive)} />
              <Wire d={`M${ats.x},${bottom('MSB-1')} V${busY}`} state={wire(msbLive, msbLive)} />
              <line x1={L.busX[0]} x2={L.busX[1]} y1={busY} y2={busY} className={`bus bus-${msbLive ? 'live' : 'dead'}`} />
              <text x={L.busX[0] + 2} y={busY - 8} className="ol-wire-label">480 V MAIN BUS</text>

              {/* Bus to UPS and mechanical */}
              {['UPS-A', 'UPS-B', 'MECH-1'].map(id => (
                <Wire key={id} d={`M${NODES[id].x},${busY} V${NODES[id].y}`}
                  state={wire(msbLive, msbLive && (readings[id]?.input_kw ?? readings[id]?.power_kw ?? 0) > 0)} />
              ))}

              {/* UPS to PDUs */}
              {[['UPS-A', ['PDU-A1', 'PDU-A2']], ['UPS-B', ['PDU-B1', 'PDU-B2']]].map(([ups, pdus]) => (
                <g key={ups}>
                  <Wire d={`M${NODES[ups].x},${bottom(ups)} V${pduY}`} state={wire(live(ups), true)} />
                  <Wire d={`M${NODES[pdus[0]].x},${pduY} H${NODES[pdus[1]].x}`} state={wire(live(ups), true)} />
                  {pdus.map(p => <Wire key={p} d={`M${NODES[p].x},${pduY} V${NODES[p].y}`} state={wire(live(ups), true)} />)}
                </g>
              ))}

              {Object.keys(NODES).filter(id => meterById[id]).map(id => (
                <Node key={id} id={id} n={NODES[id]} meter={meterById[id]} reading={readings[id]} alarm={byMeter[id]}
                  selected={selected === id} onSelect={select} />
              ))}
            </svg>
          </div>
        </div>

        {sel && (
          <div className="card ol-detail">
            <div className="card-head">
              <h3>{sel.name}</h3>
              <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <p className="muted small">{sel.description}</p>
            <dl className="kv">
              {[
                ['Status', selReading.status],
                ['Voltage', `${num(selReading.voltage)} V`],
                ['Current', `${num(selReading.current)} A`],
                ['Power', `${num(selReading.power_kw)} kW`],
                ['Power factor', num(selReading.power_factor, 3)],
                ['Frequency', `${num(selReading.frequency, 2)} Hz`],
                ['Load', `${num(selReading.load_pct)} %`],
                ['Demand (15 min)', `${num(selReading.demand_kw)} kW`],
                ...(sel.type === 'ups' ? [
                  ['Battery charge', `${num(selReading.battery_soc)} %`],
                  ['Battery runtime', `${num(selReading.battery_runtime_min, 0)} min`],
                  ['Input power', `${num(selReading.input_kw)} kW`],
                ] : []),
              ].map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>)}
            </dl>
            {selAlarms.length > 0 && (
              <ul className="mini-alarms">
                {selAlarms.map(a => (
                  <li key={a.tag} className={`p${a.priority}`}>
                    <PriorityBadge priority={a.priority} compact />
                    <div className="mini-alarm-text">{a.message}</div>
                    <StateBadge state={a.state} priority={a.priority} />
                  </li>
                ))}
              </ul>
            )}
            <Link className="btn btn-ghost btn-sm" to={`/meters?id=${sel.id}`}>Open meter detail</Link>
          </div>
        )}
      </div>
    </div>
  )
}
