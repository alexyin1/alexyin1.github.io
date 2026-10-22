import { describe, expect, it } from 'vitest'
import { NO_PLAN_MESSAGE, briefing, needsPlan } from './briefing'
import { plan, type Trip } from './circadian'

const base: Trip = {
  originZone: 'America/Los_Angeles',
  destinationZone: 'Asia/Shanghai',
  originLabel: 'Los Angeles',
  destinationLabel: 'Beijing',
  departUtc: new Date('2026-06-01T20:00:00Z'),
  arriveUtc: new Date('2026-06-02T08:30:00Z'),
  habitualBedLocal: '23:00',
  habitualWakeLocal: '07:00',
  preTravelDays: 3,
}

const eastbound: Trip = {
  ...base,
  originZone: 'Asia/Shanghai',
  destinationZone: 'America/Los_Angeles',
  originLabel: 'Beijing',
  destinationLabel: 'Los Angeles',
}

describe('briefing: rate caveat', () => {
  it('notes that shift rates are individual estimates', () => {
    for (const trip of [base, eastbound]) {
      expect(
        briefing(plan(trip)).tips.some((t) => /rates are estimates/.test(t) && /target, not a guarantee/.test(t)),
      ).toBe(true)
    }
  })
})

describe('needsPlan', () => {
  it('draws the line at two time zones', () => {
    expect(needsPlan(plan(base))).toBe(true) // 9h
    expect(needsPlan(plan({ ...base, destinationZone: 'America/Denver' }))).toBe(false) // 1h
    expect(needsPlan(plan({ ...base, destinationZone: 'America/Chicago' }))).toBe(false) // 2h
    expect(
      needsPlan(plan({ ...base, destinationZone: 'America/New_York' })), // 3h
    ).toBe(true)
    expect(needsPlan(plan({ ...base, destinationZone: 'America/Los_Angeles' }))).toBe(false)
    expect(NO_PLAN_MESSAGE).toMatch(/more than two time zones/)
  })
})

describe('briefing', () => {
  it('leads with the travel direction', () => {
    expect(briefing(plan(base)).headline).toBe('Westward travel')
    expect(briefing(plan(eastbound)).headline).toBe('Eastward travel')
  })

  it('carries both directions in the headline when they disagree', () => {
    const dubai = plan({ ...base, destinationZone: 'Asia/Dubai', destinationLabel: 'Dubai' })
    expect(briefing(dubai).headline).toBe('Eastward travel · westward shift')
  })

  it('leads the summary with the direction verb', () => {
    expect(briefing(plan(base)).summary).toBe(
      'Delay your body clock by 9 hours over about 7 days.',
    )
    expect(briefing(plan(eastbound)).summary).toBe(
      'Advance your body clock by 9 hours over about 9 days.',
    )
  })

  it('gets singular units right', () => {
    const oneHour = plan({ ...base, destinationZone: 'America/Denver' })
    expect(briefing(oneHour).summary).toBe(
      'Advance your body clock by 1 hour over about 1 day.',
    )
  })

  it('leads the tips with the light rule, pointed the right way', () => {
    expect(briefing(plan(base)).tips[0]).toMatch(/dim morning and bright evening/)
    expect(briefing(plan(eastbound)).tips[0]).toMatch(
      /[Bb]right light in the morning and a dim evening/,
    )
  })

  it('explains the gentle-then-faster pacing and quantifies both halves', () => {
    const tip = briefing(plan(base)).tips[1]
    expect(tip).toMatch(/3 hours while you are still at home/)
    expect(tip).toMatch(/remaining 6 hours happen after you land/)
  })

  it('does all shifting en route when there is no run-up', () => {
    // With preTravelDays: 0, day one is the travel day and its night already
    // runs at the full post-departure rate -- nothing happens "at home".
    const p = plan({ ...base, preTravelDays: 0 })
    expect(p.preTravelShiftHours).toBeCloseTo(0, 6)
    expect(briefing(p).tips[1]).toMatch(/all of its shifting after you land/)
  })

  it('quantifies the remainder that happens after departure', () => {
    // 9h delay: 3h at home, 6h after.
    expect(briefing(plan(base)).tips[1]).toMatch(/remaining 6 hours happen after you land/)
    // 4h advance: 2 pre-travel days, 2h after.
    const fourHours = plan({ ...base, destinationZone: 'America/Halifax' }) // PDT -7 -> ADT -3
    expect(briefing(fourHours).tips[1]).toMatch(/remaining 2 hours happen after you land/)
  })

  it('flags when the clock goes the opposite way to the flight', () => {
    // LA -> Dubai: flying east, but the clock is taken west as a delay.
    const p = plan({ ...base, destinationZone: 'Asia/Dubai', destinationLabel: 'Dubai' })
    expect(p.travelDirection).toBe('eastward')
    expect(p.direction).toBe('delay')
    const tip = briefing(p).tips.find((t) => t.includes('flying east'))
    expect(tip).toBeDefined()
    expect(tip).toMatch(/13 hours later rather than 11 hours earlier/)
  })

  it('does not raise the strategy caveat when the directions agree', () => {
    for (const trip of [base, eastbound]) {
      expect(briefing(plan(trip)).tips.some((t) => t.includes('takes your clock the other way round'))).toBe(
        false,
      )
    }
  })

  it('estimates days of jet lag discomfort from days still >2h misaligned', () => {
    // Beijing delay at 1.5h/night: 6, 4.5 and 3h days exceed the 2h bar.
    expect(briefing(plan(base)).tips.some((t) => /Prepare for about 3 days of jet lag discomfort/.test(t))).toBe(true)
    // Beijing -> LA advance at 1h/night: 6, 5, 4 and 3h days.
    expect(briefing(plan(eastbound)).tips.some((t) => /Prepare for about 4 days of jet lag discomfort/.test(t))).toBe(true)
  })

  it('promises little discomfort when the shift is under two time zones', () => {
    const oneHour = plan({ ...base, destinationZone: 'America/Denver' })
    const tips = briefing(oneHour).tips
    expect(tips.some((t) => /expect little jet lag discomfort/.test(t))).toBe(true)
    expect(tips.some((t) => /Prepare for/.test(t))).toBe(false)
  })

  it('carries the standing meal rules that left the itinerary', () => {
    const tips = briefing(plan(base)).tips
    expect(tips.some((t) => /dinner at least 3 hours before sleeping/.test(t))).toBe(true)
    expect(tips.some((t) => /meal timing helps/.test(t))).toBe(true)
  })

  it('never mentions caffeine — out of scope for circadian re-entrainment', () => {
    for (const trip of [base, eastbound]) {
      expect(briefing(plan(trip)).tips.some((t) => /caffeine/i.test(t))).toBe(false)
    }
  })

  it('only gives melatonin dosing advice when it is actually scheduled', () => {
    // Melatonin is advance-only in the model. The general-principles caveat
    // names it in passing on every trip; the dosing tip is the one that
    // must only appear when the schedule contains it.
    const dosing = (t: string) => /0\.5 mg/.test(t)
    expect(briefing(plan(base)).tips.some(dosing)).toBe(false)
    expect(briefing(plan(eastbound)).tips.some(dosing)).toBe(true)
    expect(briefing(plan({ ...eastbound, usesMelatonin: false })).tips.some(dosing)).toBe(false)
  })

  it('handles a trip with no time zone change', () => {
    const b = briefing(plan({ ...base, destinationZone: 'America/Los_Angeles' }))
    expect(b.headline).toBe('No time zone change')
    expect(b.summary).toMatch(/nothing to shift/)
    expect(b.tips.length).toBeGreaterThan(0)
  })

  it('reassures on very long shifts that partial adaptation is fine', () => {
    const p = plan({ ...base, destinationZone: 'Pacific/Kiritimati', strategy: 'advance' })
    expect(briefing(p).tips.some((t) => /Partial adaptation/.test(t))).toBe(true)
  })

  it('never emits an empty or untrimmed tip', () => {
    for (const trip of [base, eastbound, { ...base, preTravelDays: 0 }]) {
      for (const tip of briefing(plan(trip)).tips) {
        expect(tip).toBe(tip.trim())
        expect(tip.length).toBeGreaterThan(10)
        expect(tip).not.toMatch(/\s{2,}/)
      }
    }
  })
})
