import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import {
  type Advice,
  type Trip,
  PARAMS,
  computeShift,
  formatTime,
  formatWindow,
  normalizeShift,
  offsetHoursAt,
  plan,
  zoneCityName,
  zoneOffsetLabel,
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
  // Each day spans two CBTmins: `cbtMin` just before it began, and
  // `nextCbtMin` inside its trailing sleep. Morning advice is positioned
  // against the former, evening advice against the latter.
  it('advancing puts bright light after CBTmin and darkness before the next', () => {
    const day = plan(eastward).days[0]
    expect(firstOfKind(day.advice, 'seek-light').start.getTime()).toBeGreaterThan(
      day.cbtMin.getTime(),
    )
    expect(firstOfKind(day.advice, 'avoid-light').end.getTime()).toBeLessThan(
      day.nextCbtMin.getTime(),
    )
  })

  it('delaying puts bright light before the next CBTmin and darkness after the last', () => {
    const day = plan(westward).days[0]
    expect(firstOfKind(day.advice, 'seek-light').end.getTime()).toBeLessThanOrEqual(
      day.nextCbtMin.getTime(),
    )
    expect(firstOfKind(day.advice, 'avoid-light').start.getTime()).toBeGreaterThan(
      day.cbtMin.getTime(),
    )
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

describe('plan: day orientation', () => {
  it('starts each day at wake and ends it with sleep', () => {
    for (const trip of [eastward, westward]) {
      for (const day of plan(trip).days) {
        const first = day.advice[0]
        const last = day.advice.at(-1)!
        expect(first.start.getTime()).toBe(day.wake.getTime())
        expect(last.kind).toBe('sleep')
        expect(last.start.getTime()).toBe(day.bed.getTime())
        // Nothing is scheduled outside the wake..sleep-end span.
        for (const a of day.advice) {
          expect(a.start.getTime()).toBeGreaterThanOrEqual(day.wake.getTime())
          expect(a.end.getTime()).toBeLessThanOrEqual(last.end.getTime())
        }
      }
    }
  })

  it('hands off cleanly: each day ends exactly where the next begins', () => {
    const days = plan(eastward).days
    for (let i = 1; i < days.length; i++) {
      const prevSleep = firstOfKind(days[i - 1].advice, 'sleep')
      expect(prevSleep.end.getTime()).toBe(days[i].wake.getTime())
    }
  })

  it('labels a day by its wake date, not by where the sleep window ends', () => {
    const p = plan({ ...eastward, preTravelDays: 2 })
    const day = p.days[0]
    expect(day.date).toBe(
      DateTime.fromJSDate(day.wake, { zone: day.zone }).toFormat('yyyy-MM-dd'),
    )
    // The trailing sleep runs past local midnight onto the following date.
    const sleep = firstOfKind(day.advice, 'sleep')
    const sleepEndDate = DateTime.fromJSDate(sleep.end, { zone: day.zone }).toFormat('yyyy-MM-dd')
    expect(sleepEndDate).not.toBe(day.date)
  })

  it('keeps a post-midnight bedtime attached to the day it belongs to', () => {
    // A westward shift pushes bedtime past midnight within a few days. That
    // late bedtime must stay on the day the traveler woke up, not jump to the
    // next one.
    const p = plan({ ...westward, preTravelDays: 4 })
    const lateNight = p.days.find((d) => {
      const bedLocal = DateTime.fromJSDate(d.bed, { zone: d.zone })
      return bedLocal.hour < 6
    })
    expect(lateNight).toBeDefined()
    expect(lateNight!.bed.getTime()).toBeGreaterThan(lateNight!.wake.getTime())
    const bedDate = DateTime.fromJSDate(lateNight!.bed, { zone: lateNight!.zone }).toFormat(
      'yyyy-MM-dd',
    )
    expect(bedDate).not.toBe(lateNight!.date) // past midnight...
    expect(firstOfKind(lateNight!.advice, 'sleep').start.getTime()).toBe(lateNight!.bed.getTime())
  })

  it('places each day between its two CBTmins', () => {
    for (const day of plan(eastward).days) {
      expect(day.cbtMin.getTime()).toBeLessThan(day.wake.getTime())
      expect(day.nextCbtMin.getTime()).toBeGreaterThan(day.bed.getTime())
    }
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

describe('place labelling', () => {
  it('derives a readable city name from a zone', () => {
    expect(zoneCityName('Asia/Shanghai')).toBe('Shanghai')
    expect(zoneCityName('America/Los_Angeles')).toBe('Los Angeles')
    expect(zoneCityName('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
    expect(zoneCityName('UTC')).toBe('UTC')
  })

  it('formats offsets, including DST and half-hour zones', () => {
    expect(zoneOffsetLabel('Asia/Shanghai', iso('2026-06-01T00:00:00Z'))).toBe('UTC+8')
    expect(zoneOffsetLabel('America/Los_Angeles', iso('2026-06-01T00:00:00Z'))).toBe('UTC-7')
    expect(zoneOffsetLabel('America/Los_Angeles', iso('2026-01-01T00:00:00Z'))).toBe('UTC-8')
    expect(zoneOffsetLabel('Asia/Kolkata', iso('2026-06-01T00:00:00Z'))).toBe('UTC+5:30')
  })

  it('uses the caller-supplied label over the zone city', () => {
    // Someone flying out of Oakland is not flying out of "Los Angeles".
    const p = plan({ ...eastward, originLabel: 'Oakland', destinationLabel: 'Cambridge' })
    expect(p.origin).toEqual({
      label: 'Oakland',
      zone: 'America/Los_Angeles',
      offsetLabel: 'UTC-7',
    })
    expect(p.destination.label).toBe('Cambridge')
    expect(p.destination.zone).toBe('Europe/London')
  })

  it('falls back to the zone city when no label is given or it is blank', () => {
    expect(plan(eastward).origin.label).toBe('Los Angeles')
    expect(plan({ ...eastward, originLabel: '   ' }).origin.label).toBe('Los Angeles')
  })

  it('labels each day with wherever the traveler is that day', () => {
    const p = plan({ ...eastward, originLabel: 'Oakland', destinationLabel: 'Cambridge' })
    expect(p.days[0].place.label).toBe('Oakland')
    expect(p.days.at(-1)!.place.label).toBe('Cambridge')
    for (const d of p.days) expect(d.place.zone).toBe(d.zone)
  })
})

describe('clock formatting', () => {
  const sample = plan(eastward).timeline.find((a) => a.kind === 'sleep')!

  it('formats 24h by default', () => {
    expect(formatWindow(sample)).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}–\d{2}:\d{2}( \+1)?$/)
    expect(formatWindow(sample, '24h')).toBe(formatWindow(sample))
  })

  it('formats 12h with meridiems', () => {
    expect(formatWindow(sample, '12h')).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M–\d{1,2}:\d{2} [AP]M( \+1)?$/,
    )
  })

  it("marks windows that end on the next local date, so 23:00-07:00 doesn't read backwards", () => {
    const p = plan(eastward)
    const sleep = firstOfKind(p.days[0].advice, 'sleep')
    expect(formatWindow(sleep)).toMatch(/ \+1$/)
    // Day 1 wakes at the habitual 07:00, but its bedtime is already pulled an
    // hour earlier: the trailing sleep is the first shifted night.
    expect(formatWindow(sleep)).toBe('Fri 22:00–06:00 +1')
    expect(formatWindow(sleep, '12h')).toBe('Fri 10:00 PM–6:00 AM +1')

    const breakfast = p.days[0].advice.find((a) => a.kind === 'meal')!
    expect(formatWindow(breakfast)).not.toMatch(/\+1/)
  })

  it('represents the same instants in both formats', () => {
    const noonUtc = iso('2026-06-01T19:00:00Z') // 12:00 PDT
    expect(formatTime(noonUtc, 'America/Los_Angeles', '24h')).toBe('12:00')
    expect(formatTime(noonUtc, 'America/Los_Angeles', '12h')).toBe('12:00 PM')

    const midnight = iso('2026-06-01T07:00:00Z') // 00:00 PDT
    expect(formatTime(midnight, 'America/Los_Angeles', '24h')).toBe('00:00')
    expect(formatTime(midnight, 'America/Los_Angeles', '12h')).toBe('12:00 AM')

    const evening = iso('2026-06-02T06:00:00Z') // 23:00 PDT
    expect(formatTime(evening, 'America/Los_Angeles', '24h')).toBe('23:00')
    expect(formatTime(evening, 'America/Los_Angeles', '12h')).toBe('11:00 PM')
  })
})

describe('plan: Los Angeles <-> Beijing', () => {
  const toBeijing: Trip = {
    originZone: 'America/Los_Angeles',
    destinationZone: 'Asia/Shanghai',
    originLabel: 'Los Angeles',
    destinationLabel: 'Beijing',
    departUtc: iso('2026-06-01T20:00:00Z'), // 13:00 PDT
    arriveUtc: iso('2026-06-02T08:30:00Z'), // 16:30 CST next day
    habitualBedLocal: '23:00',
    habitualWakeLocal: '07:00',
    preTravelDays: 3,
  }

  it('is a 9h delay, not a 15h advance', () => {
    // PDT is UTC-7 and Beijing UTC+8, a raw +15h. Going the short way round
    // that is a 9h delay, which also happens to be the cheaper direction.
    const p = plan(toBeijing)
    expect(p.shiftHours).toBe(-9)
    expect(p.direction).toBe('delay')
    expect(p.daysToAdjust).toBe(6) // 9h at 1.5h/day
  })

  it('is a 9h advance in the other direction', () => {
    const p = plan({
      ...toBeijing,
      originZone: 'Asia/Shanghai',
      destinationZone: 'America/Los_Angeles',
      originLabel: 'Beijing',
      destinationLabel: 'Los Angeles',
    })
    expect(p.shiftHours).toBe(9)
    expect(p.direction).toBe('advance')
  })

  it('reaches the habitual local schedule in Beijing', () => {
    const p = plan(toBeijing)
    const last = p.days.at(-1)!
    expect(last.place).toEqual({ label: 'Beijing', zone: 'Asia/Shanghai', offsetLabel: 'UTC+8' })
    const sleep = firstOfKind(last.advice, 'sleep')
    const bed = DateTime.fromJSDate(sleep.start, { zone: 'Asia/Shanghai' })
    expect(bed.hour + bed.minute / 60).toBeCloseTo(23, 1)
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
