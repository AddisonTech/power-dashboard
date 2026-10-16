export function num(v, digits = 1) {
  return v == null || Number.isNaN(v) ? '--' : Number(v).toFixed(digits)
}

export function kw(v) {
  if (v == null) return '--'
  return v >= 1000 ? `${(v / 1000).toFixed(2)} MW` : `${v.toFixed(0)} kW`
}

export function timeOf(iso) {
  if (!iso) return '--'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
}

export function dateTimeOf(iso) {
  if (!iso) return '--'
  const d = new Date(iso)
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeOf(iso)}`
}

export function ago(iso, now = Date.now()) {
  if (!iso) return ''
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`
}

export function until(iso, now = Date.now()) {
  if (!iso) return ''
  const s = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

export function alarmValue(a, v = a.value) {
  if (v == null) return '--'
  if (a.kind === 'DISCRETE') return v ? 'Active' : 'Normal'
  const digits = a.unit === '' ? 3 : a.unit === 'Hz' ? 2 : 1
  return `${Number(v).toFixed(digits)}${a.unit ? ` ${a.unit}` : ''}`
}

export function setpointText(a) {
  if (a.kind === 'DISCRETE') return 'discrete'
  const op = a.kind.startsWith('HI') ? '>' : '<'
  const digits = a.unit === '' ? 2 : 1
  return `${op} ${Number(a.setpoint).toFixed(digits)}${a.unit ? ` ${a.unit}` : ''}`
}
