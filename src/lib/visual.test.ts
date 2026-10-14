import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { PARAMS, type AdviceKind } from './circadian'
import {
  KIND_EMOJI,
  daylightIntervals,
  fractionOf,
  habitualSleepIntervals,
  hourTicks,
  targetTmin,
  temperatureCurve,
} from './visual'

const iso = (s: string) => new Date(s)

describe('KIND_EMOJI', () => {
  it('covers every advice kind', () => {
    const kinds: AdviceKind[] = ['sleep', 'seek-light', 'avoid-light', 'melatonin', 'exercise', 'meal']
    for (const k of kinds) {
      expect(KIND_EMOJI[k]).toBeTruthy()
    }
  })
})

describe('daylightIntervals', () => {
  it('returns 06:00-18:00 local blocks clipped to the range', () => {
    // 24h window starting at noon Beijing: expect the back half of today's
    // daylight and the front half of tomorrow's.
    const start = iso('2026-06-02T04:00:00Z') // 12:00 Beijing
    const end = iso('2026-06-03T04:00:00Z')
    const spans = daylightIntervals('Asia/Shanghai', start, end)
    expect(spans).toHaveLength(2)
    expect(DateTime.fromJSDate(spans[0].start, { zone: 'Asia/Shanghai' }).hour).toBe(12)
    expect(DateTime.fromJSDate(spans[0].end, { zone: 'Asia/Shanghai' }).hour).toBe(18)
    expect(DateTime.fromJSDate(spans[1].start, { zone: 'Asia/Shanghai' }).hour).toBe(6)
    expect(DateTime.fromJSDate(spans[1].end, { zone: 'Asia/Shanghai' }).hour).toBe(12)
  })

  it('never emits an interval outside the requested range', () => {
    const start = iso('2026-06-02T04:00:00Z')
    const end = iso('2026-06-03T04:00:00Z')
    for (const zone of ['Asia/Shanghai', 'America/Los_Angeles']) {
      for (const s of daylightIntervals(zone, start, end)) {
        expect(s.start.getTime()).toBeGreaterThanOrEqual(start.getTime())
        expect(s.end.getTime()).toBeLessThanOrEqual(end.getTime())
        expect(s.end.getTime()).toBeGreaterThan(s.start.getTime())
      }
    }
  })
})

describe('habitualSleepIntervals', () => {
  it('finds the overnight window crossing midnight', () => {
    const start = iso('2026-06-02T00:00:00Z')
    const end = iso('2026-06-03T00:00:00Z')
    const spans = habitualSleepIntervals('America/Los_Angeles', '23:00', '07:00', start, end)
    // The LA night of June 1->2 is in progress at range start (23:00 June 1
    // PDT = 06:00Z June 2), and the June 2->3 night starts 06:00Z June 3...
    // clipped out. Expect exactly the in-progress night.
    expect(spans.length).toBeGreaterThanOrEqual(1)
    const first = spans[0]
    const localEnd = DateTime.fromJSDate(first.end, { zone: 'America/Los_Angeles' })
    expect(localEnd.hour).toBe(7)
    expect((first.end.getTime() - first.start.getTime()) / 3.6e6).toBeLessThanOrEqual(8)
  })

  it('handles a non-crossing window', () => {
    const start = iso('2026-06-02T00:00:00Z')
    const end = iso('2026-06-04T00:00:00Z')
    const spans = habitualSleepIntervals('Asia/Shanghai', '01:00', '09:00', start, end)
    for (const s of spans) {
      expect((s.end.getTime() - s.start.getTime()) / 3.6e6).toBeLessThanOrEqual(8)
    }
    expect(spans.length).toBeGreaterThanOrEqual(2)
  })
})

describe('targetTmin', () => {
  it('is the destination habitual wake minus the Tmin offset, nearest the probe', () => {
    // Habitual wake 07:00 Beijing, offset 3.5h -> Tmin target 03:30 Beijing.
    const near = iso('2026-06-05T18:00:00Z') // 02:00 Beijing June 6
    const t = targetTmin('Asia/Shanghai', '07:00', near)
    const local = DateTime.fromJSDate(t, { zone: 'Asia/Shanghai' })
    expect(local.hour).toBe(7 - Math.ceil(PARAMS.cbtMinBeforeWakeHours))
    expect(local.minute).toBe(30)
    // Nearest occurrence: same local morning (June 6), not a day off.
    expect(local.day).toBe(6)
  })

  it('picks the occurrence across a date boundary when closer', () => {
    const near = iso('2026-06-06T14:00:00Z') // 22:00 Beijing June 6
    const t = targetTmin('Asia/Shanghai', '07:00', near)
    const local = DateTime.fromJSDate(t, { zone: 'Asia/Shanghai' })
    expect(local.day).toBe(7) // next morning is closer than this morning
  })
})

describe('temperatureCurve', () => {
  it('has its minimum at Tmin and peak ~12h away', () => {
    const start = iso('2026-06-02T00:00:00Z')
    const end = iso('2026-06-03T00:00:00Z')
    const tmin = iso('2026-06-02T06:00:00Z')
    const pts = temperatureCurve(tmin, start, end, 241)
    const minPt = pts.reduce((a, b) => (b.v < a.v ? b : a))
    expect(minPt.f).toBeCloseTo(0.25, 2) // 06:00 of a 24h axis
    expect(minPt.v).toBeCloseTo(-1, 3)
    const maxPt = pts.reduce((a, b) => (b.v > a.v ? b : a))
    expect(maxPt.f).toBeCloseTo(0.75, 2)
  })
})

describe('axis helpers', () => {
  it('fractionOf clamps and interpolates', () => {
    const start = iso('2026-06-02T00:00:00Z')
    const end = iso('2026-06-03T00:00:00Z')
    expect(fractionOf(iso('2026-06-02T12:00:00Z'), start, end)).toBeCloseTo(0.5, 6)
    expect(fractionOf(iso('2026-06-01T00:00:00Z'), start, end)).toBe(0)
    expect(fractionOf(iso('2026-06-04T00:00:00Z'), start, end)).toBe(1)
  })

  it('hourTicks lands on local-clock multiples of the step', () => {
    const start = iso('2026-06-02T04:30:00Z')
    const end = iso('2026-06-03T04:30:00Z')
    const ticks = hourTicks('Asia/Shanghai', start, end, 6)
    expect(ticks.length).toBeGreaterThanOrEqual(4)
    for (const t of ticks) {
      const local = DateTime.fromJSDate(t.at, { zone: 'Asia/Shanghai' })
      expect(local.hour % 6).toBe(0)
      expect(local.minute).toBe(0)
      expect(t.at.getTime()).toBeGreaterThanOrEqual(start.getTime())
      expect(t.at.getTime()).toBeLessThanOrEqual(end.getTime())
    }
  })
})
