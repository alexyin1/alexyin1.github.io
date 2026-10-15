import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { sunTimesAt, sunTimesForDate } from './sun'

/** Assert an instant lands within `tol` minutes of HH:mm local in `zone`. */
function expectLocal(at: Date | null, zone: string, hhmm: string, tol = 15) {
  expect(at).not.toBeNull()
  const local = DateTime.fromJSDate(at!, { zone })
  const [h, m] = hhmm.split(':').map(Number)
  const diff = Math.abs(local.hour * 60 + local.minute - (h * 60 + m))
  expect(Math.min(diff, 1440 - diff)).toBeLessThanOrEqual(tol)
}

describe('sunTimesForDate', () => {
  it('matches Los Angeles midsummer within tolerance', () => {
    const t = sunTimesForDate(2026, 6, 15, 34.05, -118.25)
    expect(t.polar).toBeNull()
    expectLocal(t.sunrise, 'America/Los_Angeles', '05:42')
    expectLocal(t.sunset, 'America/Los_Angeles', '20:06')
  })

  it('matches Los Angeles midwinter within tolerance', () => {
    const t = sunTimesForDate(2026, 12, 21, 34.05, -118.25)
    expectLocal(t.sunrise, 'America/Los_Angeles', '06:55')
    expectLocal(t.sunset, 'America/Los_Angeles', '16:48')
  })

  it('matches Beijing midsummer within tolerance', () => {
    const t = sunTimesForDate(2026, 6, 15, 39.9, 116.4)
    expectLocal(t.sunrise, 'Asia/Shanghai', '04:45')
    expectLocal(t.sunset, 'Asia/Shanghai', '19:45')
  })

  it('reports the midnight sun and polar night in Tromsø', () => {
    const june = sunTimesForDate(2026, 6, 21, 69.65, 18.96)
    expect(june.polar).toBe('day')
    const december = sunTimesForDate(2026, 12, 21, 69.65, 18.96)
    expect(december.polar).toBe('night')
    expect(december.sunrise).toBeNull()
  })

  it('always puts sunrise before sunset with a plausible day length', () => {
    for (const [lat, lon] of [[34.05, -118.25], [39.9, 116.4], [-33.87, 151.21], [51.5, -0.12]]) {
      for (const month of [3, 6, 9, 12]) {
        const t = sunTimesForDate(2026, month, 15, lat, lon)
        expect(t.polar).toBeNull()
        const hours = (t.sunset!.getTime() - t.sunrise!.getTime()) / 3.6e6
        expect(hours).toBeGreaterThan(7)
        expect(hours).toBeLessThan(17)
      }
    }
  })

  it('southern hemisphere seasons are inverted', () => {
    const sydneyJune = sunTimesForDate(2026, 6, 15, -33.87, 151.21)
    const sydneyDec = sunTimesForDate(2026, 12, 15, -33.87, 151.21)
    const len = (t: ReturnType<typeof sunTimesForDate>) =>
      (t.sunset!.getTime() - t.sunrise!.getTime()) / 3.6e6
    expect(len(sydneyJune)).toBeLessThan(11)
    expect(len(sydneyDec)).toBeGreaterThan(13)
  })
})

describe('sunTimesAt', () => {
  it('uses the civil date at the location, not the UTC date', () => {
    // 20:00Z on June 14 is already June 15 in Beijing; the sun times should
    // be for Beijing's June 15.
    const probe = new Date('2026-06-14T20:00:00Z')
    const viaAt = sunTimesAt(probe, 'Asia/Shanghai', 39.9, 116.4)
    const direct = sunTimesForDate(2026, 6, 15, 39.9, 116.4)
    expect(viaAt.sunrise!.getTime()).toBeCloseTo(direct.sunrise!.getTime(), -3)
  })
})
