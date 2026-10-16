import { describe, expect, it } from 'vitest'
import { resolveFlight } from './flight'

// Baseline behavior only; the corner-case suite (DST days, 24h+ flights,
// unusual offsets) is a separate pass.
describe('resolveFlight', () => {
  it('resolves the LAX -> PEK demo itinerary with a next-day arrival', () => {
    const r = resolveFlight('2026-06-01', '13:00', 'America/Los_Angeles', '16:30', 'Asia/Shanghai')
    if ('error' in r) throw new Error(r.error)
    expect(r.departUtc.toISOString()).toBe('2026-06-01T20:00:00.000Z')
    expect(r.arriveUtc.toISOString()).toBe('2026-06-02T08:30:00.000Z')
    expect(r.arriveLocal.toISODate()).toBe('2026-06-02')
  })

  it('keeps a same-day arrival on the travel date', () => {
    // JFK -> LAX, 09:00 -> 12:00 local: 6h in the air.
    const r = resolveFlight('2026-06-01', '09:00', 'America/New_York', '12:00', 'America/Los_Angeles')
    if ('error' in r) throw new Error(r.error)
    expect(r.arriveLocal.toISODate()).toBe('2026-06-01')
    expect((r.arriveUtc.getTime() - r.departUtc.getTime()) / 3.6e6).toBe(6)
  })

  it('resolves an eastward date-line crossing to the local day before', () => {
    // Kiritimati (UTC+14) -> Honolulu (UTC-10): depart just after local
    // midnight, land the previous local date.
    const r = resolveFlight('2026-06-01', '00:30', 'Pacific/Kiritimati', '05:00', 'Pacific/Honolulu')
    if ('error' in r) throw new Error(r.error)
    expect(r.arriveUtc.getTime()).toBeGreaterThan(r.departUtc.getTime())
    expect(r.arriveLocal.toISODate()).toBe('2026-05-31')
  })

  it('always lands strictly after takeoff', () => {
    // Westward overnight: Beijing 23:30 -> LAX 19:00 the same local date.
    const r = resolveFlight('2026-06-01', '23:30', 'Asia/Shanghai', '19:00', 'America/Los_Angeles')
    if ('error' in r) throw new Error(r.error)
    expect(r.arriveUtc.getTime()).toBeGreaterThan(r.departUtc.getTime())
    const hrs = (r.arriveUtc.getTime() - r.departUtc.getTime()) / 3.6e6
    expect(hrs).toBeGreaterThan(0)
    expect(hrs).toBeLessThan(24)
  })

  it('reports missing or malformed fields as errors', () => {
    expect(resolveFlight('', '13:00', 'America/Los_Angeles', '16:30', 'Asia/Shanghai')).toHaveProperty('error')
    expect(resolveFlight('2026-06-01', '', 'America/Los_Angeles', '16:30', 'Asia/Shanghai')).toHaveProperty('error')
    expect(resolveFlight('2026-06-01', '13:00', 'America/Los_Angeles', '', 'Asia/Shanghai')).toHaveProperty('error')
    expect(resolveFlight('2026-13-40', '13:00', 'America/Los_Angeles', '16:30', 'Asia/Shanghai')).toHaveProperty('error')
  })
})
