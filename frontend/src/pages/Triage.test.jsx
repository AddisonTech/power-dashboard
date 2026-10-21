import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import Triage, { EvidenceChart, GradingPanel, TriageItem, TriageResult, ZoneNote } from './Triage'
import { clockIn, dateTimeIn } from '../lib/zone'
import outage from '../test/triage-outage.json'
import outageUtc from '../test/triage-outage-utc.json'
import grading from '../test/triage-grading.json'

const render = (el) => renderToStaticMarkup(el)
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('Triage tab', () => {
  it('puts the root cause first with its consequences folded under it', () => {
    const html = render(<TriageResult data={outage} />)
    const items = html.match(/class="tri-item /g) || []
    expect(items).toHaveLength(1)
    expect(text(html)).toContain('Utility power failure')
    expect(text(html)).toContain('Root cause')
    expect(text(html)).toContain('Explains 5 more alarms, collapsed under this cause')
    // collapsed by default: the consequence list is not rendered until opened
    expect(html).not.toContain('tri-cq-list')
  })

  it('shows the flood against the ranked list', () => {
    const t = text(render(<TriageResult data={outage} />))
    expect(t).toContain('Alarm flood 24')
    expect(t).toContain('Ranked items 1')
    expect(t).toContain('5 collapsed under their cause')
    expect(t).toContain('24x')
  })

  it('says which writer wrote the text', () => {
    const t = text(render(<TriageResult data={outage} />))
    expect(t).toContain('Written by the template, no model')
    expect(t).toContain('Template, no model')
    const haiku = {
      ...outage,
      triage: {
        ...outage.triage,
        writer: { kind: 'haiku', name: 'Claude Haiku', model: 'claude-haiku-5-5' },
        items: [{ ...outage.triage.items[0], written_by: 'Claude Haiku' }],
      },
    }
    const h = render(<TriageResult data={haiku} />)
    expect(text(h)).toContain('Written by Claude Haiku')
    expect(h).toContain('tri-writer haiku')
  })

  it('shows the next step and the trend evidence', () => {
    const item = outage.triage.items[0]
    const html = render(<TriageItem item={item} zone={outage.zone} />)
    expect(text(html)).toContain('Next step')
    expect(text(html)).toContain(item.next_step.slice(0, 40))
    expect(html).toContain('class="tri-chart"')
    expect(html).toContain('class="tri-limit"')
    expect(html).toContain('class="tri-past"')
  })

  it('draws nothing for an empty trend', () => {
    expect(render(<EvidenceChart evidence={{ trend: [] }} />)).toContain('No trend samples')
  })

  it('says it is read only', () => {
    expect(text(render(<TriageResult data={outage} />))).toContain('Read only.')
  })

  it('renders the page shell with the triage button', () => {
    const html = render(<MemoryRouter initialEntries={['/triage']}><Triage /></MemoryRouter>)
    expect(text(html)).toContain('Triage this event')
    expect(text(html)).toContain('cuts the alarm flood')
  })
})

describe('Triage tab times', () => {
  const cases = [
    ['America/New_York', 'EDT', outage],
    ['UTC', 'UTC', outageUtc],
  ]

  it.each(cases)('states the card times in %s, labeled', (zoneName, label, data) => {
    const item = data.triage.items[0]
    const labels = data.zone.labels
    // what the browser formats for the header and the card footer
    const first = clockIn(item.evidence.first_past_limit, zoneName, labels)
    const last = clockIn(item.evidence.last_past_limit, zoneName, labels)
    expect(first.endsWith(` ${label}`)).toBe(true)
    // what the agent wrote in the card's sentence
    expect(item.reason).toContain(`from ${first} to ${last}`)
    const html = render(<TriageResult data={data} />)
    const t = text(html)
    expect(t).toContain(dateTimeIn(item.start, zoneName, labels))
    // no clock anywhere on the card without its label
    expect(t.match(/\b\d\d:\d\d:\d\d(?! [A-Z])/g)).toBeNull()
    const labelsSeen = new Set([...t.matchAll(/\b\d\d:\d\d:\d\d ([A-Z]+)/g)].map(m => m[1]))
    expect([...labelsSeen]).toEqual([label])
  })

  it('names the zone it is showing', () => {
    const zone = outage.zone
    const t = text(render(<ZoneNote zone={zone} at={outage.event.first_alarm} />))
    expect(t).toContain('Times in America/New_York (EDT)')
    const u = text(render(<ZoneNote zone={outageUtc.zone} at={outageUtc.event.first_alarm} />))
    expect(u.trim()).toBe('Times in UTC')
  })

  it('shows New York and UTC an exact conversion apart', () => {
    const ny = outage.triage.items[0].reason.match(/(\d\d):(\d\d:\d\d) EDT/)
    const utc = outageUtc.triage.items[0].reason.match(/(\d\d):(\d\d:\d\d) UTC/)
    expect((Number(utc[1]) - Number(ny[1]) + 24) % 24).toBe(4)
    expect(ny[2]).toBe(utc[2])
  })
})

describe('How this agent is graded', () => {
  it('is a link that opens a panel', () => {
    const html = render(<GradingPanel grading={grading} />)
    expect(text(html)).toContain('How this agent is graded')
    expect(html).not.toContain('tri-grades')
  })

  it('shows the template writer\'s pass rate for every grader, from the agent', () => {
    const t = text(render(<GradingPanel grading={grading} initiallyOpen />))
    expect(grading.graders.length).toBe(6)
    for (const g of grading.graders) {
      expect(t).toContain(`${g.passed} of ${g.applicable}`)
    }
    expect(t).toContain('Grounding')
    expect(t).toContain(`agent ${grading.agent_version}`)
    expect(t).toContain('The cases are synthetic.')
  })

  it('links to the Evals section of the agent\'s showcase', () => {
    const html = render(<GradingPanel grading={grading} initiallyOpen />)
    expect(html).toContain(`href="${grading.showcase}"`)
    expect(grading.showcase).toMatch(/#evals$/)
  })

  it('shows nothing without grading data', () => {
    expect(render(<GradingPanel grading={null} />)).toBe('')
  })
})

// Since agent 0.3.1 one point can have two episodes, each escalated as its
// own card: a UPS that goes to battery, comes back, and goes again later.
const cause = outage.triage.items[0]
const battery = cause.consequences.find(c => c.point.endsWith('/UPS-B/ONBATT'))
const episode = (start) => ({
  ...cause, ...battery, rank: 1, rule: 'E-P2', consequences: [], start,
  reason: `UPS on battery at UPS-B from ${start}.`, next_step: 'Inspect UPS-B: the input breaker.',
  written_by: 'template, no model',
})
const twoEpisodes = {
  ...outage,
  triage: {
    ...outage.triage,
    items: [episode('2026-09-21T14:18:20+00:00'), { ...episode('2026-09-21T14:28:20+00:00'), rank: 2 }],
    nuisance: [
      { point: battery.point, signal: 'ups_on_battery', label: 'UPS on battery', rule: 'E-D1', finding: 'first' },
      { point: battery.point, signal: 'ups_on_battery', label: 'UPS on battery', rule: 'E-D1', finding: 'second' },
    ],
    unresolved: [],
  },
}

// The keys React is handed for the children of the element with this class
function keysUnder(element, className) {
  if (!element || typeof element !== 'object') return null
  const props = element.props || {}
  if (typeof props.className === 'string' && props.className.split(' ').includes(className)) {
    return [props.children].flat(Infinity).filter(c => c && typeof c === 'object').map(c => c.key)
  }
  for (const child of [props.children].flat(Infinity)) {
    const found = keysUnder(child, className)
    if (found) return found
  }
  return null
}

describe('Two episodes on one point', () => {
  it('renders both cards', () => {
    const html = render(<TriageResult data={twoEpisodes} />)
    expect(html.match(/class="tri-item /g)).toHaveLength(2)
    expect(text(html)).toContain('from 2026-09-21T14:18:20+00:00')
    expect(text(html)).toContain('from 2026-09-21T14:28:20+00:00')
  })

  it('gives each card its own key, by point and episode start', () => {
    const keys = keysUnder(TriageResult({ data: twoEpisodes }), 'tri-list')
    expect(keys).toEqual([
      `${battery.point}@2026-09-21T14:18:20+00:00`,
      `${battery.point}@2026-09-21T14:28:20+00:00`,
    ])
  })

  it('keeps set-aside entries on one point apart too', () => {
    const keys = keysUnder(TriageResult({ data: twoEpisodes }), 'tri-aside')
    expect(new Set(keys).size).toBe(2)
  })
})

