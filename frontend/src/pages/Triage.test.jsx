import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import Triage, { EvidenceChart, TriageItem, TriageResult } from './Triage'
import outage from '../test/triage-outage.json'

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
    const html = render(<TriageItem item={item} />)
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
