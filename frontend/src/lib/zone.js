// Times shown to a viewer: one zone, always labeled.
//
// The server keeps every time as UTC ISO 8601 with an offset. The browser
// converts each one to the viewer's IANA zone. The label comes from the
// server's map of UTC offset to label for that zone (the same labels the
// triage agent writes into its text), so a header formatted here and a
// sentence written there say "15:28:45 EDT" alike. Without a map, the
// browser's own short name is used.

export function viewerZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function parts(iso, zone, options) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options })
  const out = {}
  for (const p of fmt.formatToParts(new Date(iso))) out[p.type] = p.value
  return out
}

// "-04:00" for a moment in New York in summer, "+00:00" for UTC
export function offsetOf(iso, zone) {
  const name = parts(iso, zone, { timeZoneName: 'longOffset' }).timeZoneName || 'GMT'
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(name)
  return m ? `${m[1]}:${m[2] || '00'}` : '+00:00'
}

export function zoneLabel(iso, zone, labels) {
  const fromServer = labels && labels[offsetOf(iso, zone)]
  if (fromServer) return fromServer
  const short = parts(iso, zone, { timeZoneName: 'short' }).timeZoneName || 'UTC'
  return short === 'GMT' && offsetOf(iso, zone) === '+00:00' ? 'UTC' : short.replace(/^GMT/, 'UTC')
}

const CLOCK = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }

// "15:28:45 EDT"
export function clockIn(iso, zone = viewerZone(), labels) {
  if (!iso) return '--'
  const p = parts(iso, zone, CLOCK)
  return `${p.hour}:${p.minute}:${p.second} ${zoneLabel(iso, zone, labels)}`
}

// "Oct 16 15:28:45 EDT"
export function dateTimeIn(iso, zone = viewerZone(), labels) {
  if (!iso) return '--'
  const p = parts(iso, zone, { month: 'short', day: 'numeric', ...CLOCK })
  return `${p.month} ${p.day} ${p.hour}:${p.minute}:${p.second} ${zoneLabel(iso, zone, labels)}`
}
