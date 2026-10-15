import { describe, expect, it } from 'vitest'
import { PARAMS, plan, type AdviceKind, type Trip } from './circadian'
import {
  AXIS_ANCHOR_HOUR,
  KIND_EMOJI,
  axisFraction,
  axisFractionOfHour,
  axisHourAt,
  axisTicks,
  daylightSegments,
  formatHourLabel,
  intervalSegments,
  localHourDecimal,
  localWindowSegments,
  segmentsFrom,
  sleepDurationHours,
  targetTminHour,
  temperatureCurveOnAxis,
} from './visual'

const iso = (s: string) => new Date(s)
const BJ = 'Asia/Shanghai'
const LA = 'America/Los_Angeles'

describe('KIND_EMOJI', () => {
  it('covers every advice kind', () => {
    const kinds: AdviceKind[] = ['sleep', 'seek-light', 'avoid-light', 'melatonin', 'exercise', 'meal']
    for (const k of kinds) expect(KIND_EMOJI[k]).toBeTruthy()
  })
})

describe('the axis is rigid', () => {
  it('anchors at midday so the destination night sits mid-axis', () => {
    expect(AXIS_ANCHOR_HOUR).toBe(12)
    expect(axisHourAt(0)).toBe(12)
    expect(axisHourAt(0.5)).toBe(0) // midnight at the centre
    expect(axisHourAt(1)).toBe(12)
    expect(axisFractionOfHour(12)).toBe(0)
    expect(axisFractionOfHour(0)).toBeCloseTo(0.5, 9)
  })

  it('maps instants by destination time of day, not by plan day', () => {
    // 03:30 Beijing on two different dates lands on the same axis position.
    const a = iso('2026-06-02T19:30:00Z')
    const b = iso('2026-06-05T19:30:00Z')
    expect(localHourDecimal(a, BJ)).toBeCloseTo(3.5, 6)
    expect(axisFraction(a, BJ)).toBeCloseTo(axisFraction(b, BJ), 9)
  })

  it('places the same instant differently on each zone clock', () => {
    const at = iso('2026-06-02T19:30:00Z') // 03:30 Beijing, 12:30 LA
    expect(axisFraction(at, BJ)).toBeCloseTo((3.5 - 12 + 24) / 24, 6)
    expect(axisFraction(at, LA)).toBeCloseTo(0.5 / 24, 6)
  })
})

describe('segmentsFrom', () => {
  it('returns a single span when it fits', () => {
    expect(segmentsFrom(0.25, 6)).toEqual([{ f0: 0.25, f1: 0.5 }])
  })

  it('splits a span that runs off the right edge', () => {
    const segs = segmentsFrom(0.875, 6) // 3h to the edge, 3h wrapped
    expect(segs).toHaveLength(2)
    expect(segs[0]).toEqual({ f0: 0.875, f1: 1 })
    expect(segs[1].f0).toBe(0)
    expect(segs[1].f1).toBeCloseTo(0.125, 9)
  })

  it('clamps a full day and drops an empty window', () => {
    expect(segmentsFrom(0.3, 24)).toEqual([{ f0: 0, f1: 1 }])
    expect(segmentsFrom(0.3, 0)).toEqual([])
  })

  it('keeps total width equal to the duration when wrapping', () => {
    for (const f0 of [0, 0.4, 0.9, 0.99]) {
      const total = segmentsFrom(f0, 8).reduce((a, s) => a + (s.f1 - s.f0), 0)
      expect(total).toBeCloseTo(8 / 24, 9)
    }
  })
})

describe('intervalSegments', () => {
  it('projects an overnight sleep window across the axis centre', () => {
    // 23:00-07:00 Beijing: starts at 23:00 (f=11/24) and runs 8h without
    // wrapping, because the axis centre is midnight.
    const segs = intervalSegments(iso('2026-06-02T15:00:00Z'), iso('2026-06-02T23:00:00Z'), BJ)
    expect(segs).toHaveLength(1)
    expect(segs[0].f0).toBeCloseTo(11 / 24, 6)
    expect(segs[0].f1).toBeCloseTo(19 / 24, 6)
  })
})

describe('localWindowSegments', () => {
  it('projects a home-clock window onto the destination axis', () => {
    // 23:00 LA on 2026-06-02 is 14:00 Beijing (+15h): f = 2/24.
    const segs = localWindowSegments(LA, '23:00', 8, BJ, iso('2026-06-02T12:00:00Z'))
    expect(segs).toHaveLength(1)
    expect(segs[0].f0).toBeCloseTo(2 / 24, 6)
  })

  it('is the identity when the window is already on the axis zone', () => {
    const segs = localWindowSegments(BJ, '23:00', 8, BJ, iso('2026-06-02T12:00:00Z'))
    expect(segs[0].f0).toBeCloseTo(11 / 24, 6)
  })
})

describe('daylightSegments', () => {
  it('puts destination daylight at both ends, night in the middle', () => {
    const segs = daylightSegments(BJ, BJ, iso('2026-06-02T12:00:00Z'))
    // 06:00-18:00 on a midday-anchored axis = [0, 0.25] and [0.75, 1].
    expect(segs).toHaveLength(2)
    expect(segs[0].f0).toBeCloseTo(0.75, 6)
    expect(segs[0].f1).toBe(1)
    expect(segs[1].f0).toBe(0)
    expect(segs[1].f1).toBeCloseTo(0.25, 6)
  })

  it('offsets the origin strip by the zone difference', () => {
    const segs = daylightSegments(LA, BJ, iso('2026-06-02T12:00:00Z'))
    const total = segs.reduce((a, s) => a + (s.f1 - s.f0), 0)
    expect(total).toBeCloseTo(0.5, 6) // still 12h of daylight
    // LA 06:00 is Beijing 21:00 that day: f = 9/24.
    expect(segs[0].f0).toBeCloseTo(9 / 24, 6)
  })
})

describe('targets', () => {
  it('target Tmin is habitual wake minus the Tmin offset', () => {
    expect(targetTminHour('07:00')).toBeCloseTo(7 - PARAMS.cbtMinBeforeWakeHours, 9)
    expect(targetTminHour('01:00')).toBeCloseTo(24 + 1 - PARAMS.cbtMinBeforeWakeHours, 9)
  })

  it('sleep duration handles the midnight wrap', () => {
    expect(sleepDurationHours('23:00', '07:00')).toBe(8)
    expect(sleepDurationHours('01:00', '09:00')).toBe(8)
    expect(sleepDurationHours('22:30', '06:00')).toBeCloseTo(7.5, 9)
  })
})

describe('temperatureCurveOnAxis', () => {
  it('dips at the given local hour and peaks 12h away', () => {
    const pts = temperatureCurveOnAxis(3.5, AXIS_ANCHOR_HOUR, 577)
    const lo = pts.reduce((a, b) => (b.v < a.v ? b : a))
    const hi = pts.reduce((a, b) => (b.v > a.v ? b : a))
    expect(axisHourAt(lo.f)).toBeCloseTo(3.5, 1)
    expect(lo.v).toBeCloseTo(-1, 4)
    expect(axisHourAt(hi.f)).toBeCloseTo(15.5, 1)
  })

  it('is continuous across the axis, including the edges', () => {
    const pts = temperatureCurveOnAxis(3.5)
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i].v - pts[i - 1].v)).toBeLessThan(0.1)
    }
    // A 24h span starts and ends at the same phase.
    expect(pts[0].v).toBeCloseTo(pts[pts.length - 1].v, 6)
  })
})

describe('axis labels', () => {
  it('ticks span the axis inclusively on whole hours', () => {
    const ticks = axisTicks(3)
    expect(ticks).toHaveLength(9)
    expect(ticks[0]).toEqual({ f: 0, hour: 12 })
    expect(ticks[4]).toEqual({ f: 0.5, hour: 0 })
    expect(ticks[8]).toEqual({ f: 1, hour: 12 })
  })

  it('formats hours in both clock modes, wrapping negatives', () => {
    expect(formatHourLabel(15, '24h')).toBe('15:00')
    expect(formatHourLabel(0, '24h')).toBe('00:00')
    expect(formatHourLabel(0, '12h')).toBe('12 AM')
    expect(formatHourLabel(12, '12h')).toBe('12 PM')
    expect(formatHourLabel(15, '12h')).toBe('3 PM')
    // Home-time labels can go negative after the offset subtraction.
    expect(formatHourLabel(-3, '24h')).toBe('21:00')
    expect(formatHourLabel(27, '24h')).toBe('03:00')
  })
})

describe('the plan converges on the axis', () => {
  const trip: Trip = {
    originZone: LA, destinationZone: BJ,
    departUtc: iso('2026-06-01T20:00:00Z'), arriveUtc: iso('2026-06-02T08:30:00Z'),
    habitualBedLocal: '23:00', habitualWakeLocal: '07:00', preTravelDays: 3,
  }

  it('moves the body-clock low monotonically toward the fixed target', () => {
    const p = plan(trip)
    const goal = targetTminHour(trip.habitualWakeLocal)
    const gaps = p.days.map((d) => {
      const h = localHourDecimal(d.nextCbtMin, BJ)
      const raw = Math.abs(h - goal)
      return Math.min(raw, 24 - raw)
    })
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1] + 1e-6)
    }
    expect(gaps[0]).toBeGreaterThan(3)
    expect(gaps.at(-1)!).toBeCloseTo(0, 6)
  })
})
