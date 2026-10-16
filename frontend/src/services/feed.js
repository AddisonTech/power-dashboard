// Pure state handling for the WebSocket feed (kept free of React so it is easy to test).

export const SPARK_POINTS = 90 // 3 minutes at a 2 second scan

export const initialFeed = {
  meters: [],
  meterById: {},
  readings: {},
  spark: {},
  system: null,
  alarms: [],
  summary: null,
  demo: null,
  snapshotAt: null,
  lastMessageAt: null,
}

function pushSpark(spark, readings) {
  const next = { ...spark }
  for (const r of readings) {
    if (r.power_kw == null) continue
    const arr = next[r.meter_id] ? next[r.meter_id].slice(-(SPARK_POINTS - 1)) : []
    arr.push(r.power_kw)
    next[r.meter_id] = arr
  }
  return next
}

function mergeReadings(prev, list) {
  const next = { ...prev }
  for (const r of list) next[r.meter_id] = r
  return next
}

export function reduceFeed(state, msg, now = Date.now()) {
  if (!msg || typeof msg !== 'object') return state
  const d = msg.data || {}
  switch (msg.type) {
    case 'snapshot':
      return {
        ...state,
        meters: d.meters || [],
        meterById: Object.fromEntries((d.meters || []).map(m => [m.id, m])),
        readings: mergeReadings({}, d.readings || []),
        spark: state.snapshotAt ? state.spark : pushSpark({}, d.readings || []),
        system: d.system || null,
        alarms: d.alarms || [],
        summary: d.summary || null,
        demo: d.demo || null,
        snapshotAt: now,
        lastMessageAt: now,
      }
    case 'readings':
      return {
        ...state,
        readings: mergeReadings(state.readings, d.readings || []),
        spark: pushSpark(state.spark, d.readings || []),
        system: d.system || state.system,
        lastMessageAt: now,
      }
    case 'alarms':
      return { ...state, alarms: d.alarms || [], summary: d.summary || state.summary, lastMessageAt: now }
    case 'pong':
      return { ...state, lastMessageAt: now }
    default:
      return state
  }
}

// Highest priority (lowest number) annunciated alarm per meter
export function alarmsByMeter(alarms) {
  const out = {}
  for (const a of alarms) {
    if (!['UNACK', 'ACKED', 'RTN_UNACK'].includes(a.state)) continue
    const cur = out[a.meter_id]
    if (!cur || a.priority < cur.priority) out[a.meter_id] = a
  }
  return out
}
