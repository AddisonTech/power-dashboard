import { describe, expect, it } from 'vitest'
import {
  chartGeometry, eventFinished, evidenceText, floodParts, itemWriter, reduction, ruleLabel, seconds, valueText, writerLabel,
} from './triage'
import outage from '../test/triage-outage.json'

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
