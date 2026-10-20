import { describe, expect, it } from 'vitest'
import {
  chartGeometry, dipText, eventFinished, evidenceText, floodParts, graderTitle, itemWriter, passRate, reduction, ruleLabel,
  seconds, valueText, writerLabel,
} from './triage'
import outage from '../test/triage-outage.json'
import outageUtc from '../test/triage-outage-utc.json'

const cause = outage.triage.items[0]

describe('triage helpers', () => {
  it('names the rules and the writer', () => {
    expect(ruleLabel('E-P1')).toBe('Cause confirmed by trend')
    expect(ruleLabel('R-P3')).toBe('R-P3')
    expect(writerLabel({ kind: 'template' })).toBe('Written by the template, no model')
    expect(writerLabel({ kind: 'haiku', name: 'Claude Haiku' })).toBe('Written by Claude Haiku')
    expect(itemWriter('Claude Haiku')).toBe('Claude Haiku')
    expect(itemWriter('template, no model')).toBe('Template, no model')
  })

  it('formats durations and values', () => {
    expect(seconds(0.4)).toBe('one sample')
    expect(seconds(108)).toBe('108 s')
    expect(seconds(600)).toBe('10 min')
    expect(valueText({ kind: 'discrete', limit: 0.5 }, 1)).toBe('Alarm')
    expect(valueText({ kind: 'low', units: 'Hz' }, 58.8)).toBe('58.80 Hz')
  })

  it('states the trend evidence in one line', () => {
    expect(evidenceText(cause.evidence)).toMatch(/^In the alarm state in \d+ of \d+ samples for /)
    expect(evidenceText({ samples_past_limit: 0 })).toMatch(/never shows/)
    const sag = { kind: 'low', direction: 'LOW', limit: 432, units: 'V', samples: 12, samples_past_limit: 3,
      seconds_past_limit: 6, worst_value: 410.3 }
    expect(evidenceText(sag)).toBe('Past its limit < 432.0 V in 3 of 12 samples for 6 s, worst 410.3 V.')
  })

  it('breaks the flood into its parts', () => {
    expect(floodParts(outage.triage.counts)).toBe('6 alarms, 6 returns, 12 acknowledgements and suppressions')
  })

  it('measures the reduction from the flood', () => {
    const r = reduction(outage.triage.counts)
    expect(r.flood).toBe(24)
    expect(r.items).toBe(1)
    expect(r.ratio).toBe(24)
  })

  it('draws the trend, the limit, and the time past it', () => {
    const g = chartGeometry(cause.evidence, 320, 72)
    expect(g.path.startsWith('M')).toBe(true)
    expect(g.path).toContain('H') // a status point is drawn as steps
    expect(g.limitY).toBeGreaterThan(0)
    expect(g.limitY).toBeLessThan(72)
    expect(g.shade.width).toBeGreaterThan(2)
    expect(chartGeometry({ trend: [] }, 320, 72)).toBeNull()
  })

  it('offers triage only when an event has just finished', () => {
    const sc = { name: 'utility_outage', label: 'Utility outage' }
    expect(eventFinished(sc, null)).toBe(true)
    expect(eventFinished(null, sc)).toBe(false)
    expect(eventFinished(sc, sc)).toBe(false)
    expect(eventFinished(null, null)).toBe(false)
  })
})

describe('frequency dip', () => {
  const dipOf = data => data.triage.items[0].consequences.find(c => c.signal === 'frequency_low').evidence.dip

  it('reports the load step dip in the viewer zone, labeled', () => {
    const ny = dipText(dipOf(outage), outage.zone)
    expect(ny).toMatch(/^Load step \d\d:\d\d:\d\d EDT \(at the transfer\): worst 58\.\d\d Hz, 1\.\d\d Hz below the 60 Hz nominal, back within 0\.5 Hz at \d\d:\d\d:\d\d EDT, 2 s after the step\.$/)
    const utc = dipText(dipOf(outageUtc), outageUtc.zone)
    expect(utc).toMatch(/^Load step \d\d:\d\d:\d\d UTC .* \d\d:\d\d:\d\d UTC, 2 s after the step\.$/)
  })

  it('never shows a crank value', () => {
    const text = dipText(dipOf(outage), outage.zone)
    expect(text).not.toMatch(/(^|[^\d.])(0|20|40)\.00 Hz/)
  })

  it('shows no number when nothing was measured', () => {
    const none = { measured: false, reason: 'no transfer to the emergency source and the generator never reached its rated 60 Hz in this export' }
    const t = dipText(none)
    expect(t).toBe('No dip measurement: no transfer to the emergency source and the generator never reached its rated 60 Hz in this export.')
    expect(t).not.toMatch(/\d+\.\d\d Hz/)
  })

  it('says when the frequency never came back', () => {
    const dip = { ...dipOf(outageUtc), recovered_at: null, recovery_s: null }
    expect(dipText(dip, outageUtc.zone)).toMatch(/not back within 0\.5 Hz by \d\d:\d\d:\d\d UTC\.$/)
  })

  it('is what the consequence line shows', () => {
    const c = outage.triage.items[0].consequences.find(x => x.signal === 'frequency_low')
    expect(evidenceText(c.evidence, outage.zone)).toBe(dipText(c.evidence.dip, outage.zone))
  })
})

describe('grading', () => {
  it('names each grader in plain words', () => {
    expect(graderTitle('root_cause')).toBe('Root cause')
    expect(graderTitle('next_step')).toBe('Next step')
    expect(graderTitle('something_new')).toBe('Something new')
  })

  it('writes a pass rate as a percentage', () => {
    expect(passRate(1)).toBe('100%')
    expect(passRate(0.9483)).toBe('94.8%')
    expect(passRate(null)).toBe('--')
  })
})

