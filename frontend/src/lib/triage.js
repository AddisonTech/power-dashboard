// Helpers for the Triage tab. Pure functions, so they test without a browser.

import { clockIn } from './zone'

export const RULES = {
  'E-P1': 'Cause confirmed by trend',
  'E-P2': 'Not explained by any cause',
  'E-C1': 'Explained by the cause above',
  'E-D1': 'Not seen in the trend',
}

export function ruleLabel(rule) {
  if (!rule) return 'No rule fired'
  if (RULES[rule]) return RULES[rule]
  return rule
}

export function writerLabel(writer) {
  if (!writer) return ''
  if (writer.kind === 'haiku') return 'Written by Claude Haiku'
  if (writer.kind === 'template') return 'Written by the template, no model'
  return `Written by ${writer.name}`
}

// The per item label: an item can fall back to the template even when Haiku is on
export function itemWriter(name) {
  if (!name) return ''
  return /haiku/i.test(name) ? 'Claude Haiku' : 'Template, no model'
}

export function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : ''
}

export function seconds(s) {
  if (s == null) return '--'
  if (s < 1) return 'one sample'
  if (s < 120) return `${Math.round(s)} s`
  if (s < 7200) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(1)} h`
}

export function valueText(evidence, v) {
  if (v == null) return '--'
  if (evidence.kind === 'discrete') return v >= evidence.limit ? 'Alarm' : 'Normal'
  const digits = evidence.units === 'Hz' ? 2 : evidence.units === '' ? 3 : 1
  return `${Number(v).toFixed(digits)}${evidence.units ? ` ${evidence.units}` : ''}`
}

export function limitText(evidence) {
  if (evidence.kind === 'discrete') return 'status alarm'
  const op = evidence.direction === 'HIGH' ? '>' : '<'
  return `limit ${op} ${valueText(evidence, evidence.limit)}`
}

// One line on what the trend shows, for under the chart
// A generator frequency dip, measured by the agent from its load step.
// Times are shown in the viewer's zone with the server's labels.
export function dipText(dip, zone = { name: 'UTC', labels: {} }) {
  if (!dip) return null
  if (!dip.measured) return `No dip measurement: ${dip.reason}.`
  const at = iso => clockIn(iso, zone.name, zone.labels)
  const step = dip.basis === 'ats_transfer' ? 'at the transfer' : 'with the generator first at rated frequency'
  if (dip.below_nominal_hz <= dip.tolerance_hz) {
    return `Load step ${at(dip.step_at)} (${step}): stayed within ${dip.tolerance_hz} Hz of ${dip.nominal_hz} Hz, lowest ${dip.worst_hz.toFixed(2)} Hz.`
  }
  const head = `Load step ${at(dip.step_at)} (${step}): worst ${dip.worst_hz.toFixed(2)} Hz, ` +
    `${dip.below_nominal_hz.toFixed(2)} Hz below the ${dip.nominal_hz} Hz nominal`
  if (dip.recovered_at) {
    return `${head}, back within ${dip.tolerance_hz} Hz at ${at(dip.recovered_at)}, ${seconds(dip.recovery_s)} after the step.`
  }
  return `${head}, not back within ${dip.tolerance_hz} Hz by ${at(dip.window_end)}.`
}

export function evidenceText(evidence, zone) {
  if (evidence?.dip) return dipText(evidence.dip, zone)
  if (!evidence || !evidence.samples_past_limit) return 'The trend never shows this point past its limit.'
  const past = evidence.samples_past_limit
  const span = evidence.seconds_past_limit > 0 ? ` for ${seconds(evidence.seconds_past_limit)}` : ''
  if (evidence.kind === 'discrete') {
    return `In the alarm state in ${past} of ${evidence.samples} samples${span}.`
  }
  const worst = `, worst ${valueText(evidence, evidence.worst_value)}`
  return `Past its ${limitText(evidence)} in ${past} of ${evidence.samples} samples${span}${worst}.`
}

export function reduction(counts) {
  if (!counts) return null
  const flood = counts.journal_entries ?? counts.alarm_events
  const items = counts.ranked_items
  return { flood, items, ratio: items ? flood / items : null }
}

// What the flood was made of, in the journal's own terms
export function floodParts(counts) {
  const alarms = counts.alarms_annunciated ?? 0
  const returns = Math.max((counts.alarm_transitions ?? counts.alarm_events ?? 0) - alarms, 0)
  const records = counts.operator_records ?? 0
  return `${alarms} alarms, ${returns} returns, ${records} acknowledgements and suppressions`
}

// Geometry for the evidence chart: a line, the alarm limit, and the stretch
// the point spent past it. Returns null when there is nothing to draw.
export function chartGeometry(evidence, width, height, pad = { left: 6, right: 6, top: 8, bottom: 8 }) {
  const pts = (evidence?.trend || []).map(([t, v]) => [new Date(t).getTime(), v])
  if (pts.length < 2) return null
  const t0 = pts[0][0]
  const t1 = pts[pts.length - 1][0]
  const values = pts.map(p => p[1]).concat([evidence.limit])
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (evidence.kind === 'discrete') { lo = 0; hi = 1 }
  const room = (hi - lo) * 0.12 || 1
  lo -= room
  hi += room
  const x = t => pad.left + ((t - t0) / (t1 - t0 || 1)) * (width - pad.left - pad.right)
  const y = v => pad.top + (1 - (v - lo) / (hi - lo)) * (height - pad.top - pad.bottom)
  const step = evidence.kind === 'discrete'
  let path = ''
  pts.forEach(([t, v], i) => {
    if (i === 0) path += `M${x(t).toFixed(1)},${y(v).toFixed(1)}`
    else if (step) path += `H${x(t).toFixed(1)}V${y(v).toFixed(1)}`
    else path += `L${x(t).toFixed(1)},${y(v).toFixed(1)}`
  })
  let shade = null
  if (evidence.first_past_limit && evidence.last_past_limit) {
    const a = x(new Date(evidence.first_past_limit).getTime())
    const b = x(new Date(evidence.last_past_limit).getTime())
    shade = { x: a, width: Math.max(b - a, 2) }
  }
  return { path, limitY: y(evidence.limit), shade, t0, t1 }
}

// Decide when to offer the button: an event just finished and the
// operator has not triaged it yet.
export function eventFinished(previous, current) {
  return !!(previous && !current)
}
