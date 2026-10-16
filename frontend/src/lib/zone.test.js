import { describe, expect, it } from 'vitest'
import { clockIn, dateTimeIn, offsetOf, zoneLabel } from './zone'
import { dateTimeOf, timeOf } from './format'

const SUMMER = '2026-10-16T19:28:45.000+00:00'
const WINTER = '2026-01-16T19:28:45.000+00:00'

describe('zone helpers', () => {
  it('converts to the zone and labels it', () => {
    expect(clockIn(SUMMER, 'America/New_York')).toBe('15:28:45 EDT')
    expect(clockIn(WINTER, 'America/New_York')).toBe('14:28:45 EST')
    expect(clockIn(SUMMER, 'UTC')).toBe('19:28:45 UTC')
    expect(dateTimeIn(SUMMER, 'America/New_York')).toBe('Oct 16 15:28:45 EDT')
  })

  it('reads the offset the server keys its labels by', () => {
    expect(offsetOf(SUMMER, 'America/New_York')).toBe('-04:00')
    expect(offsetOf(SUMMER, 'UTC')).toBe('+00:00')
    expect(offsetOf(SUMMER, 'Asia/Kolkata')).toBe('+05:30')
  })

  it('takes the label from the server when it has one', () => {
    expect(zoneLabel(SUMMER, 'Europe/Berlin', { '+02:00': 'CEST' })).toBe('CEST')
    expect(clockIn(SUMMER, 'Europe/Berlin', { '+02:00': 'CEST' })).toBe('21:28:45 CEST')
    expect(zoneLabel(SUMMER, 'Europe/Berlin')).toBe('UTC+2')
  })

  it('labels the shared formatters too', () => {
    expect(timeOf(SUMMER, 'America/New_York')).toBe('15:28:45 EDT')
    expect(dateTimeOf(SUMMER, 'UTC')).toBe('Oct 16 19:28:45 UTC')
    expect(timeOf(null)).toBe('--')
  })
})
