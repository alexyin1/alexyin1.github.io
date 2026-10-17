import { describe, expect, it } from 'vitest'
import { estimateArrival, estimateFlightHours, resolveFlight } from './flight'

const LAX = { lat: 33.942, lon: -118.408, tz: 'America/Los_Angeles' }
const PEK = { lat: 40.08, lon: 116.585, tz: 'Asia/Shanghai' }
const JFK = { lat: 40.64, lon: -73.779, tz: 'America/New_York' }

describe('resolveFlight', () => {
  it('resolves the LAX -> PEK demo itinerary with a next-day arrival', () => {
    const r = resolveFlight(
      '2026-06-01', '13:00', 'America/Los_Angeles',
      '2026-06-02', '16:30', 'Asia/Shanghai',
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.departUtc.toISOString()).toBe('2026-06-01T20:00:00.000Z')
    expect(r.arriveUtc.toISOString()).toBe('2026-06-02T08:30:00.000Z')
    expect(r.arriveLocal.toISODate()).toBe('2026-06-02')
  })

  it('handles a same-day arrival', () => {
    // JFK -> LAX, 09:00 -> 12:00 local: 6h in the air.
    const r = resolveFlight(
      '2026-06-01', '09:00', 'America/New_York',
      '2026-06-01', '12:00', 'America/Los_Angeles',
    )
    if ('error' in r) throw new Error(r.error)
    expect((r.arriveUtc.getTime() - r.departUtc.getTime()) / 3.6e6).toBe(6)
  })

  it('accepts an eastward date-line crossing that lands the local day before', () => {
    // Kiritimati (UTC+14) -> Honolulu (UTC-10): depart just after local
    // midnight, land the previous local date.
    const r = resolveFlight(
      '2026-06-01', '00:30', 'Pacific/Kiritimati',
      '2026-05-31', '05:00', 'Pacific/Honolulu',
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.arriveUtc.getTime()).toBeGreaterThan(r.departUtc.getTime())
  })

  it('rejects an arrival at or before departure', () => {
    expect(
      resolveFlight('2026-06-01', '13:00', 'America/Los_Angeles', '2026-06-01', '16:30', 'Asia/Shanghai'),
    ).toHaveProperty('error')
    expect(
      resolveFlight('2026-06-01', '09:00', 'America/New_York', '2026-06-01', '09:00', 'America/New_York'),
    ).toHaveProperty('error')
  })

  it('reports missing or malformed fields as errors', () => {
    expect(resolveFlight('', '13:00', 'America/Los_Angeles', '2026-06-02', '16:30', 'Asia/Shanghai')).toHaveProperty('error')
    expect(resolveFlight('2026-06-01', '', 'America/Los_Angeles', '2026-06-02', '16:30', 'Asia/Shanghai')).toHaveProperty('error')
    expect(resolveFlight('2026-06-01', '13:00', 'America/Los_Angeles', '', '16:30', 'Asia/Shanghai')).toHaveProperty('error')
    expect(resolveFlight('2026-06-01', '13:00', 'America/Los_Angeles', '2026-06-02', '', 'Asia/Shanghai')).toHaveProperty('error')
    expect(resolveFlight('2026-13-40', '13:00', 'America/Los_Angeles', '2026-06-02', '16:30', 'Asia/Shanghai')).toHaveProperty('error')
  })
})

describe('flight time estimate', () => {
  it('is close to published block times on long and short routes', () => {
    expect(estimateFlightHours(LAX, PEK)).toBeGreaterThan(12.5)
    expect(estimateFlightHours(LAX, PEK)).toBeLessThan(14)
    expect(estimateFlightHours(JFK, LAX)).toBeGreaterThan(5.5)
    expect(estimateFlightHours(JFK, LAX)).toBeLessThan(6.5)
    expect(estimateFlightHours(LAX, LAX)).toBe(0)
  })

  it('estimates a destination-local arrival date and time', () => {
    const a = estimateArrival('2026-06-01', '13:00', LAX, PEK)
    expect(a).not.toBeNull()
    // ~13h after 13:00 PDT (20:00Z) is ~09:00Z = ~17:00 Beijing, next day.
    expect(a!.date).toBe('2026-06-02')
    expect(a!.time >= '16:00' && a!.time <= '18:00').toBe(true)
    expect(a!.time.endsWith('0') || a!.time.endsWith('5')).toBe(true)
  })

  it('returns null for an incomplete departure', () => {
    expect(estimateArrival('', '13:00', LAX, PEK)).toBeNull()
    expect(estimateArrival('2026-06-01', '', LAX, PEK)).toBeNull()
  })
})
