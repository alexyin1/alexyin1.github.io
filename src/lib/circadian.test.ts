import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import {
  type Advice,
  type Trip,
  PARAMS,
  computeShift,
  normalizeShift,
  offsetHoursAt,
  plan,
} from './circadian'

const iso = (s: string) => new Date(s)

/** SFO -> LHR, a canonical 8h eastward trip. */
const eastward: Trip = {
  originZone: 'America/Los_Angeles',
  destinationZone: 'Europe/London',
  departUtc: iso('2026-06-01T22:00:00Z'), // 15:00 PDT
  arriveUtc: iso('2026-06-02T08:00:00Z'), // 09:00 BST
  habitualBedLocal: '23:00',
  habitualWakeLocal: '07:00',
  preTravelDays: 3,
}

/** LHR -> SFO, the same hop westward. */
const westward: Trip = {
  ...eastward,
  originZone: 'Europe/London',
  destinationZone: 'America/Los_Angeles',
  departUtc: iso('2026-06-01T10:00:00Z'),
  arriveUtc: iso('2026-06-01T21:00:00Z'),
}

function firstOfKind(advice: Advice[], kind: Advice['kind']): Advice {
  const found = advice.find((a) => a.kind === kind)
  if (!found) throw new Error(`no '${kind}' advice in day`)
  return found
}

describe('offsetHoursAt', () => {
  it('is DST-aware', () => {
    expect(offsetHoursAt('America/Los_Angeles', iso('2026-01-15T12:00:00Z'))).toBe(-8)
    expect(offsetHoursAt('America/Los_Angeles', iso('2026-06-15T12:00:00Z'))).toBe(-7)
  })

  it('rejects unknown zones', () => {
    expect(() => offsetHoursAt('Mars/Olympus', new Date())).toThrow(/Invalid zone/)
  })
})

describe('normalizeShift', () => {
  it('maps differences into (-12, 12]', () => {
    expect(normalizeShift(8)).toBe(8)
    expect(normalizeShift(-8)).toBe(-8)
    expect(normalizeShift(16)).toBe(-8)
    expect(normalizeShift(-16)).toBe(8)
    expect(normalizeShift(12)).toBe(12)
    expect(normalizeShift(-12)).toBe(-12)
    expect(normalizeShift(0)).toBe(0)
  })
})

describe('computeShift', () => {
  it('treats eastward travel as an advance', () => {
    expect(computeShift(eastward)).toEqual({ shiftHours: 8, direction: 'advance' })
  })

  it('treats westward travel as a delay', () => {
    expect(computeShift(westward)).toEqual({ shiftHours: -8, direction: 'delay' })
  })

  it('reports no shift within a single zone', () => {
    const same = { ...eastward, destinationZone: 'America/Los_Angeles' }
    expect(computeShift(same)).toEqual({ shiftHours: 0, direction: 'none' })
  })

  it('wraps raw offsets greater than 12h to the short way round the clock', () => {
    // LA -> Tokyo is +16h of raw offset, but the body only has to travel 8h,
    // and it goes the short way: an 8h delay, not a 16h advance.
    const tokyo = { ...eastward, destinationZone: 'Asia/Tokyo' }
    expect(computeShift(tokyo)).toEqual({ shiftHours: -8, direction: 'delay' })
  })

  it('prefers a delay when advancing the same distance would take longer', () => {
    // LA -> Dubai is +11h: an 11h advance costs 11 days at 1h/day, while the
    // equivalent 13h delay costs ~8.7 days at 1.5h/day. Delay wins.
    const dubai = { ...eastward, destinationZone: 'Asia/Dubai' }
    expect(computeShift(dubai)).toEqual({ shiftHours: -13, direction: 'delay' })

    // A 6h advance, by contrast, is cheaper advanced (6 days vs 12).
    const paris = { ...eastward, destinationZone: 'Europe/Paris' } // CEST +2 vs PDT -7
    expect(computeShift(paris)).toEqual({ shiftHours: 9, direction: 'advance' })
  })

  it('honours a forced strategy', () => {
    const forced = computeShift({ ...eastward, strategy: 'delay' })
    expect(forced).toEqual({ shiftHours: -16, direction: 'delay' })
  })
})

describe('plan: shifting', () => {
  it('moves CBTmin toward the destination at the advance rate, then stops', () => {
    const p = plan(eastward)
    const steps = p.days
      .slice(1)
      .map((d, i) => DateTime.fromJSDate(d.cbtMin).diff(DateTime.fromJSDate(p.days[i].cbtMin), 'hours').hours)

    // Each day moves 24h of wall clock minus up to the daily advance.
    for (const s of steps) {
      expect(s).toBeLessThanOrEqual(24)
      expect(s).toBeGreaterThanOrEqual(24 - PARAMS.advanceHoursPerDay - 1e-9)
    }

    // Total movement equals the full shift once adaptation completes.
    const totalShifted = steps.reduce((acc, s) => acc + (24 - s), 0)
    expect(totalShifted).toBeCloseTo(8, 6)
    expect(p.days.at(-1)!.remainingShiftHours).toBeCloseTo(0, 6)
  })

  it('moves CBTmin later for westward travel, at the faster delay rate', () => {
    const p = plan(westward)
    const steps = p.days
      .slice(1)
      .map((d, i) => DateTime.fromJSDate(d.cbtMin).diff(DateTime.fromJSDate(p.days[i].cbtMin), 'hours').hours)

    for (const s of steps) expect(s).toBeGreaterThanOrEqual(24 - 1e-9)
    const totalShifted = steps.reduce((acc, s) => acc + (s - 24), 0)
    expect(totalShifted).toBeCloseTo(8, 6)
    expect(p.daysToAdjust).toBe(Math.ceil(8 / PARAMS.delayHoursPerDay))
  })

  it('starts the plan preTravelDays before departure', () => {
    const p = plan({ ...eastward, preTravelDays: 2 })
    const firstDate = DateTime.fromJSDate(p.days[0].cbtMin).setZone(eastward.originZone).toISODate()
    expect(firstDate).toBe('2026-05-30') // departure 2026-06-01 PDT, minus 2
  })

  it('switches the display zone once the traveler has landed', () => {
    const p = plan(eastward)
    const zones = p.days.map((d) => d.zone)
    expect(zones[0]).toBe('America/Los_Angeles')
    expect(zones.at(-1)).toBe('Europe/London')
    // Zone flips exactly once, and never flips back.
    const flips = zones.filter((z, i) => i > 0 && z !== zones[i - 1])
    expect(flips).toHaveLength(1)
  })
})

describe('plan: phase-response sign conventions', () => {
  it('advancing puts bright light after CBTmin and darkness before it', () => {
    const day = plan(eastward).days[0]
    const cbt = day.cbtMin.getTime()
    expect(firstOfKind(day.advice, 'seek-light').start.getTime()).toBeGreaterThan(cbt)
    expect(firstOfKind(day.advice, 'avoid-light').end.getTime()).toBeLessThan(cbt)
  })

  it('delaying puts bright light before CBTmin and darkness after it', () => {
    const day = plan(westward).days[0]
    const cbt = day.cbtMin.getTime()
    expect(firstOfKind(day.advice, 'seek-light').end.getTime()).toBeLessThanOrEqual(cbt)
    expect(firstOfKind(day.advice, 'avoid-light').start.getTime()).toBeGreaterThan(cbt)
  })

  it('schedules melatonin before bed when advancing, and never when delaying', () => {
    const advancing = plan(eastward).days[0]
    const sleep = firstOfKind(advancing.advice, 'sleep')
    const mel = firstOfKind(advancing.advice, 'melatonin')
    expect(mel.end.getTime()).toBeLessThanOrEqual(sleep.start.getTime())

    const delaying = plan(westward).days[0]
    expect(delaying.advice.some((a) => a.kind === 'melatonin')).toBe(false)
  })

  it('omits melatonin and caffeine when the traveler opts out', () => {
    const p = plan({ ...eastward, usesMelatonin: false, usesCaffeine: false })
    expect(p.timeline.some((a) => a.kind === 'melatonin')).toBe(false)
    expect(p.timeline.some((a) => a.kind === 'caffeine')).toBe(false)
  })
})

describe('plan: sleep windows', () => {
  it('preserves habitual sleep duration across the whole plan', () => {
    for (const trip of [eastward, westward]) {
      for (const day of plan(trip).days) {
        const sleep = firstOfKind(day.advice, 'sleep')
        const dur = (sleep.end.getTime() - sleep.start.getTime()) / 3.6e6
        expect(dur).toBeCloseTo(8, 6)
      }
    }
  })

  it('handles a sleep window that does not cross midnight', () => {
    const p = plan({ ...eastward, habitualBedLocal: '01:00', habitualWakeLocal: '09:00' })
    const sleep = firstOfKind(p.days[0].advice, 'sleep')
    expect((sleep.end.getTime() - sleep.start.getTime()) / 3.6e6).toBeCloseTo(8, 6)
  })

  it('lands on roughly the habitual local schedule at the destination', () => {
    const p = plan(eastward)
    const last = p.days.at(-1)!
    const sleep = firstOfKind(last.advice, 'sleep')
    const localWake = DateTime.fromJSDate(sleep.end, { zone: last.zone })
    // Habitual wake is 07:00; after a completed 8h advance it should be back there.
    expect(localWake.hour + localWake.minute / 60).toBeCloseTo(7, 1)
  })
})

describe('plan: flight overlap and structure', () => {
  it('flags advice overlapping the flight', () => {
    const p = plan(eastward)
    const flagged = p.timeline.filter((a) => a.inFlight)
    expect(flagged.length).toBeGreaterThan(0)
    for (const a of flagged) {
      expect(a.start.getTime()).toBeLessThan(eastward.arriveUtc.getTime())
      expect(a.end.getTime()).toBeGreaterThan(eastward.departUtc.getTime())
    }
  })

  it('returns a chronologically sorted timeline with no zero-length windows', () => {
    const p = plan(eastward)
    for (let i = 1; i < p.timeline.length; i++) {
      expect(p.timeline[i].start.getTime()).toBeGreaterThanOrEqual(p.timeline[i - 1].start.getTime())
    }
    for (const a of p.timeline) expect(a.end.getTime()).toBeGreaterThan(a.start.getTime())
  })

  it('covers at least one day past arrival even with no pre-travel shifting', () => {
    const p = plan({ ...eastward, preTravelDays: 0 })
    expect(p.days.at(-1)!.cbtMin.getTime()).toBeGreaterThan(eastward.arriveUtc.getTime())
  })

  it('truncates absurdly long plans and says so', () => {
    const p = plan({ ...eastward, destinationZone: 'Pacific/Kiritimati', strategy: 'advance' })
    expect(p.days.length).toBeLessThanOrEqual(PARAMS.maxPlanDays)
    expect(p.notes.join(' ')).toMatch(/truncated/)
  })

  it('still produces a sleep schedule for a zero-shift trip', () => {
    const p = plan({ ...eastward, destinationZone: 'America/Los_Angeles' })
    expect(p.direction).toBe('none')
    expect(p.daysToAdjust).toBe(0)
    expect(p.days.every((d) => d.advice.some((a) => a.kind === 'sleep'))).toBe(true)
    expect(p.timeline.some((a) => a.kind === 'seek-light')).toBe(false)
  })
})

describe('plan: DST correctness', () => {
  it('keeps local sleep times stable across a spring-forward transition', () => {
    // US DST begins 2026-03-08. A same-zone plan spanning it should keep the
    // traveler's local bedtime at 23:00 on both sides.
    const p = plan({
      originZone: 'America/New_York',
      destinationZone: 'America/New_York',
      departUtc: iso('2026-03-09T15:00:00Z'),
      arriveUtc: iso('2026-03-09T18:00:00Z'),
      habitualBedLocal: '23:00',
      habitualWakeLocal: '07:00',
      preTravelDays: 3,
    })
    for (const day of p.days) {
      const sleep = firstOfKind(day.advice, 'sleep')
      const localWake = DateTime.fromJSDate(sleep.end, { zone: 'America/New_York' })
      expect(localWake.hour).toBe(7)
      // Sleep duration is held constant in real hours, so on the night the
      // clocks jump forward the local bedtime label shifts to 22:00 rather
      // than the traveler silently losing an hour of sleep.
      expect((sleep.end.getTime() - sleep.start.getTime()) / 3.6e6).toBeCloseTo(8, 6)
    }
    const bedHours = p.days.map((d) =>
      DateTime.fromJSDate(firstOfKind(d.advice, 'sleep').start, {
        zone: 'America/New_York',
      }).hour,
    )
    expect(new Set(bedHours)).toEqual(new Set([23, 22]))
  })
})

describe('plan: input validation', () => {
  it('rejects arrival before departure', () => {
    expect(() => plan({ ...eastward, arriveUtc: iso('2026-06-01T21:00:00Z') })).toThrow(
      /Arrival must be after departure/,
    )
  })

  it('rejects malformed clock times', () => {
    expect(() => plan({ ...eastward, habitualBedLocal: '11pm' })).toThrow(/Expected 'HH:mm'/)
    expect(() => plan({ ...eastward, habitualWakeLocal: '25:00' })).toThrow(/Invalid time/)
  })
})
