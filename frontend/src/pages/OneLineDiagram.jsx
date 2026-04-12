import React, { useState } from 'react'

const LAYOUT = {
  utility:    { x: 400, y: 50,  w: 120, h: 50 },
  switchgear: { x: 400, y: 160, w: 120, h: 50 },
  panelA:     { x: 220, y: 280, w: 110, h: 50 },
  panelB:     { x: 580, y: 280, w: 110, h: 50 },
  rowA1:      { x: 130, y: 400, w: 100, h: 45 },
  rowA2:      { x: 310, y: 400, w: 100, h: 45 },
  crac1:      { x: 500, y: 400, w: 100, h: 45 },
  crac2:      { x: 660, y: 400, w: 100, h: 45 },
}

const METER_KEYS = [null, 'utility', 'switchgear', 'panelA', 'panelB', 'rowA1', 'rowA2', 'crac1', 'crac2']

function getStatusColor(reading, nomV = 480, nomI = 100) {
  if (!reading) return '#4b5563'
  const v = reading.voltage
  if (v > nomV * 1.10 || v < nomV * 0.90 || reading.power_factor < 0.75) return '#ef4444'
  if (v > nomV * 1.05 || v < nomV * 0.95 || reading.power_factor < 0.85) return '#f59e0b'
  return '#22c55e'
}

function MeterNode({ nodeKey, reading, meter, selected, onClick }) {
  const pos = LAYOUT[nodeKey]
  const color = getStatusColor(reading, meter?.nominal_voltage, meter?.nominal_current)

  return (
    <g transform={`translate(${pos.x - pos.w / 2}, ${pos.y})`} style={{ cursor: 'pointer' }} onClick={onClick}>
      <rect
        width={pos.w} height={pos.h}
        rx={6}
        fill={selected ? 'rgba(0,180,216,0.15)' : 'rgba(30,30,30,0.95)'}
        stroke={selected ? '#00b4d8' : color}
        strokeWidth={selected ? 2 : 1.5}
      />
      <text x={pos.w / 2} y={16} textAnchor="middle" fill="#e8e8e8" fontSize={10} fontWeight="600">
        {meter?.name ?? nodeKey}
      </text>
      <text x={pos.w / 2} y={28} textAnchor="middle" fill={color} fontSize={9} fontFamily="monospace">
        {reading ? `${reading.voltage?.toFixed(0)}V  ${reading.current?.toFixed(0)}A` : 'No data'}
      </text>
      <text x={pos.w / 2} y={40} textAnchor="middle" fill="#a0a0a0" fontSize={9} fontFamily="monospace">
        {reading ? `${reading.power_kw?.toFixed(1)}kW  PF${reading.power_factor?.toFixed(2)}` : ''}
      </text>
      <circle cx={pos.w - 8} cy={8} r={4} fill={color} />
    </g>
  )
}

function Bus({ x, y1, y2, label }) {
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2} stroke="#2a2a2a" strokeWidth={8} />
      <line x1={x} y1={y1} x2={x} y2={y2} stroke="#383838" strokeWidth={3} />
      {label && (
        <text x={x + 12} y={(y1 + y2) / 2} fill="#606060" fontSize={10}>{label}</text>
      )}
    </g>
  )
}

export default function OneLineDiagram({ readings }) {
  const [selected, setSelected] = useState(null)

  const nodeKeys = ['utility', 'switchgear', 'panelA', 'panelB', 'rowA1', 'rowA2', 'crac1', 'crac2']
  const metersByKey = {}
  METER_KEYS.forEach((key, idx) => {
    if (key) metersByKey[key] = {
      id: idx,
      name: key === 'utility' ? 'Utility Feed'
          : key === 'switchgear' ? 'Main Switchgear'
          : key === 'panelA' ? 'Panel A'
          : key === 'panelB' ? 'Panel B'
          : key === 'rowA1' ? 'Server Row A1'
          : key === 'rowA2' ? 'Server Row A2'
          : key === 'crac1' ? 'CRAC Unit 1'
          : 'CRAC Unit 2',
      nominal_voltage: 480,
      nominal_current: [800, 750, 400, 350, 120, 120, 180, 170][idx - 1] || 100,
    }
  })

  const selectedReading = selected ? readings[METER_KEYS.indexOf(selected)] : null

  return (
    <div style={{ display: 'flex', gap: 24, height: '100%' }}>
      <div style={{ flex: 1, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
          ELECTRICAL DISTRIBUTION ONE-LINE DIAGRAM
        </div>
        <svg width="100%" viewBox="0 0 820 480" style={{ display: 'block' }}>
          {/* Background */}
          <rect width="820" height="480" fill="var(--bg-card)" />

          {/* Buses */}
          <Bus x={460} y1={100} y2={160} />
          <line x1={340} y1={135} x2={580} y2={135} stroke="#383838" strokeWidth={3} />

          {/* Panel connections */}
          <line x1={280} y1={210} x2={280} y2={280} stroke="#2a2a2a" strokeWidth={6} />
          <line x1={280} y1={210} x2={280} y2={280} stroke="#383838" strokeWidth={2} />
          <line x1={635} y1={210} x2={635} y2={280} stroke="#2a2a2a" strokeWidth={6} />
          <line x1={635} y1={210} x2={635} y2={280} stroke="#383838" strokeWidth={2} />
          <line x1={340} y1={210} x2={580} y2={210} stroke="#383838" strokeWidth={2} />

          {/* Sub-meter connections */}
          <line x1={180} y1={330} x2={180} y2={400} stroke="#2a2a2a" strokeWidth={4} />
          <line x1={180} y1={330} x2={180} y2={400} stroke="#383838" strokeWidth={1.5} />
          <line x1={360} y1={330} x2={360} y2={400} stroke="#2a2a2a" strokeWidth={4} />
          <line x1={360} y1={330} x2={360} y2={400} stroke="#383838" strokeWidth={1.5} />
          <line x1={180} y1={330} x2={360} y2={330} stroke="#383838" strokeWidth={1.5} />

          <line x1={550} y1={330} x2={550} y2={400} stroke="#2a2a2a" strokeWidth={4} />
          <line x1={550} y1={330} x2={550} y2={400} stroke="#383838" strokeWidth={1.5} />
          <line x1={710} y1={330} x2={710} y2={400} stroke="#2a2a2a" strokeWidth={4} />
          <line x1={710} y1={330} x2={710} y2={400} stroke="#383838" strokeWidth={1.5} />
          <line x1={550} y1={330} x2={710} y2={330} stroke="#383838" strokeWidth={1.5} />

          {/* Nodes */}
          {nodeKeys.map((key, i) => (
            <MeterNode
              key={key}
              nodeKey={key}
              meter={metersByKey[key]}
              reading={readings[i + 1]}
              selected={selected === key}
              onClick={() => setSelected(selected === key ? null : key)}
            />
          ))}

          {/* Labels */}
          <text x={10} y={460} fill="#383838" fontSize={10}>Power Dashboard - Electrical Distribution System</text>
        </svg>
      </div>

      {/* Side panel */}
      {selected && selectedReading && (
        <div style={{ width: 280, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--accent-border)', padding: 20, flexShrink: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 16, color: 'var(--accent)' }}>
            {metersByKey[selected]?.name?.toUpperCase() ?? selected.toUpperCase()}
          </div>
          {[
            ['Voltage',       selectedReading.voltage?.toFixed(2),      'V'],
            ['Current',       selectedReading.current?.toFixed(2),      'A'],
            ['Power',         selectedReading.power_kw?.toFixed(2),     'kW'],
            ['Power Factor',  selectedReading.power_factor?.toFixed(4), ''],
            ['Frequency',     selectedReading.frequency?.toFixed(3),    'Hz'],
            ['Demand',        selectedReading.demand_kw?.toFixed(2),    'kW'],
            ['Energy',        selectedReading.energy_kwh?.toFixed(1),   'kWh'],
          ].map(([label, val, unit]) => (
            <div key={label} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: '1px solid var(--border)'
            }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {val} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{unit}</span>
              </span>
            </div>
          ))}
          <button className="btn btn-ghost" style={{ marginTop: 16, width: '100%' }}
            onClick={() => setSelected(null)}>Close</button>
        </div>
      )}
    </div>
  )
}
