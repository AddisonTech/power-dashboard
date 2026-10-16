import { describe, expect, it } from 'vitest'
import { SPARK_POINTS, alarmsByMeter, initialFeed, reduceFeed } from './feed'
import { buildWsUrl } from './endpoints'

const meters = [{ id: 'UTIL-1', name: 'Utility' }, { id: 'UPS-A', name: 'UPS A' }]
const reading = (id, kw, epoch = 1) => ({ meter_id: id, power_kw: kw, epoch })

const snapshot = {
  type: 'snapshot',
  data: {
    meters,
    readings: [reading('UTIL-1', 400), reading('UPS-A', 140)],
    system: { health: 'normal' },
    alarms: [],
    summary: { unacknowledged: 0 },
    demo: { simulated: true },
  },
}

describe('reduceFeed', () => {
  it('loads a snapshot', () => {
    const s = reduceFeed(initialFeed, snapshot, 1000)
    expect(s.meterById['UPS-A'].name).toBe('UPS A')
    expect(s.readings['UTIL-1'].power_kw).toBe(400)
    expect(s.spark['UTIL-1']).toEqual([400])
    expect(s.snapshotAt).toBe(1000)
    expect(s.demo.simulated).toBe(true)
  })

  it('merges live readings and keeps a bounded sparkline', () => {
    let s = reduceFeed(initialFeed, snapshot)
    for (let i = 0; i < SPARK_POINTS + 20; i++) {
      s = reduceFeed(s, { type: 'readings', data: { readings: [reading('UTIL-1', 400 + i, i)], system: { health: 'caution' } } })
    }
    expect(s.readings['UTIL-1'].power_kw).toBe(400 + SPARK_POINTS + 19)
    expect(s.readings['UPS-A'].power_kw).toBe(140) // untouched meter kept
    expect(s.spark['UTIL-1']).toHaveLength(SPARK_POINTS)
    expect(s.system.health).toBe('caution')
  })

  it('replaces the alarm list on an alarms message', () => {
    const alarms = [{ tag: 'UPS-A.ONBATT', meter_id: 'UPS-A', priority: 1, state: 'UNACK' }]
    const s = reduceFeed(reduceFeed(initialFeed, snapshot), { type: 'alarms', data: { alarms, summary: { unacknowledged: 1 } } })
    expect(s.alarms).toEqual(alarms)
    expect(s.summary.unacknowledged).toBe(1)
  })

  it('a reconnect snapshot keeps the sparkline history', () => {
    let s = reduceFeed(initialFeed, snapshot)
    s = reduceFeed(s, { type: 'readings', data: { readings: [reading('UTIL-1', 410, 2)] } })
    s = reduceFeed(s, snapshot)
    expect(s.spark['UTIL-1']).toEqual([400, 410])
  })

  it('ignores unknown or malformed messages', () => {
    const s = reduceFeed(initialFeed, snapshot)
    expect(reduceFeed(s, { type: 'mystery' })).toBe(s)
    expect(reduceFeed(s, null)).toBe(s)
  })
})

describe('alarmsByMeter', () => {
  it('picks the highest priority annunciated alarm per meter', () => {
    const out = alarmsByMeter([
      { meter_id: 'UPS-A', priority: 2, state: 'ACKED' },
      { meter_id: 'UPS-A', priority: 1, state: 'RTN_UNACK' },
      { meter_id: 'GEN-1', priority: 3, state: 'SUPPRESSED' },
      { meter_id: 'PDU-A1', priority: 3, state: 'SHELVED' },
    ])
    expect(out['UPS-A'].priority).toBe(1)
    expect(out['GEN-1']).toBeUndefined()
    expect(out['PDU-A1']).toBeUndefined()
  })
})

describe('buildWsUrl', () => {
  it('derives the socket URL from the API URL', () => {
    expect(buildWsUrl('https://api.example.com')).toBe('wss://api.example.com/ws/live')
    expect(buildWsUrl('http://localhost:8000')).toBe('ws://localhost:8000/ws/live')
  })

  it('falls back to the page origin', () => {
    expect(buildWsUrl('', { protocol: 'https:', host: 'demo.example.com' })).toBe('wss://demo.example.com/ws/live')
    expect(buildWsUrl('', { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws/live')
  })
})
