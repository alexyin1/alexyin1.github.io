import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DayVisual from './DayVisual'
import { plan, type Trip } from '../lib/circadian'

const trips: Trip[] = [
  {
    originZone: 'America/Los_Angeles', destinationZone: 'Asia/Shanghai',
    originLabel: 'Los Angeles', destinationLabel: 'Beijing',
    departUtc: new Date('2026-06-01T20:00:00Z'), arriveUtc: new Date('2026-06-02T08:30:00Z'),
    habitualBedLocal: '23:00', habitualWakeLocal: '07:00', preTravelDays: 3,
  },
  {
    originZone: 'Asia/Shanghai', destinationZone: 'America/Los_Angeles',
    originLabel: 'Beijing', destinationLabel: 'Los Angeles',
    departUtc: new Date('2026-06-01T20:00:00Z'), arriveUtc: new Date('2026-06-02T08:30:00Z'),
    habitualBedLocal: '23:00', habitualWakeLocal: '07:00', preTravelDays: 3,
  },
]

const render = (trip: Trip, pos: number) =>
  renderToStaticMarkup(
    <DayVisual
      plan={plan(trip)} pos={pos} clock="24h"
      originZone={trip.originZone} destinationZone={trip.destinationZone}
      habitualBedLocal={trip.habitualBedLocal} habitualWakeLocal={trip.habitualWakeLocal}
    />,
  )

const todayTminX = (html: string) => Number(/cx="([\d.]+)" cy="[\d.]+" r="5.5"/.exec(html)![1])
const goalTminX = (html: string) => Number(/cx="([\d.]+)" cy="[\d.]+" r="6"/.exec(html)![1])

describe('DayVisual', () => {
  it('renders every day of both directions without NaN geometry', () => {
    for (const trip of trips) {
      const p = plan(trip)
      for (let i = 0; i < p.days.length; i++) {
        const html = render(trip, i)
        expect(html).toContain('<svg')
        expect(html).not.toContain('NaN')
        expect(html).toContain('body temp')
        expect(html).toContain('CBTmin')
        expect(html).toContain('sleepbar')
        expect(html).toContain('nightband')
      }
    }
  })

  it('renders fractional positions without NaN, including past the ends', () => {
    for (const pos of [-1, 0, 0.01, 0.5, 2.37, 3.999, 99]) {
      expect(render(trips[0], pos)).not.toContain('NaN')
    }
  })

  it('keeps the axis rigid while CBTmin moves across it', () => {
    const p = plan(trips[0])
    // Position 0 is the untouched baseline; days.length is the final day.
    const first = render(trips[0], 0)
    const last = render(trips[0], p.days.length)
    // Goal marker and axis labels are identical on both...
    expect(goalTminX(first)).toBe(goalTminX(last))
    expect(first).toContain('>12:00</text>')
    expect(last).toContain('>12:00</text>')
    // ...while today's CBTmin travels to meet the goal.
    expect(todayTminX(first)).not.toBe(goalTminX(first))
    expect(todayTminX(last)).toBeCloseTo(goalTminX(last), 6)
  })

  it('interpolates CBTmin smoothly between days', () => {
    const a = todayTminX(render(trips[0], 3))
    const mid = todayTminX(render(trips[0], 3.5))
    const b = todayTminX(render(trips[0], 4))
    // The midpoint sits strictly between the two whole-day positions.
    expect(mid).toBeGreaterThan(Math.min(a, b))
    expect(mid).toBeLessThan(Math.max(a, b))
    expect(mid).toBeCloseTo((a + b) / 2, 0)
  })

  it('labels the day by the nearest whole position, with 0 as baseline', () => {
    const label = (pos: number) => /aria-label="Circadian chart for day (\d+)"/.exec(render(trips[0], pos))![1]
    expect(label(0)).toBe('0')
    expect(label(0.4)).toBe('0')
    expect(label(2)).toBe('2')
    expect(label(2.4)).toBe('2')
    expect(label(2.6)).toBe('3')
    expect(label(3)).toBe('3')
  })

  it('shows the baseline with habitual sleep and no advice windows', () => {
    const html = render(trips[0], 0)
    // No seek/avoid windows exist before the plan starts.
    expect(html).not.toContain('fill="#e8a317"')
    expect(html).not.toContain('fill="#5b4a8a"')
    // The full shift is still ahead.
    expect(html).toContain('About 9.0h of shifting left')
  })

  it('puts origin time above destination time on the axis', () => {
    const html = render(trips[0], 0)
    const originLabel = html.indexOf('Los Angeles time')
    const destLabel = html.indexOf('Beijing time')
    expect(originLabel).toBeGreaterThan(-1)
    expect(destLabel).toBeGreaterThan(originLabel)
    // Rows keep semantic origin/dest classes (used for ordering and tests);
    // their colour is neutral so the axis does not compete with the data.
    expect(html).toContain('class="axislab origin"')
    expect(html).toContain('class="axislab dest"')
    expect(html).toContain('class="tick origin"')
    expect(html).toContain('class="tick dest"')
  })

  it('explains the circadian premise and uses CBTmin language', () => {
    const html = render(trips[0], 0)
    expect(html).toContain('circadian (24-hour) rhythm')
    expect(html).toContain('CBTmin')
    expect(html).not.toContain('body clock')
  })

  it('colour-codes CBTmin in the caption to match the curve', () => {
    for (const pos of [0, plan(trips[0]).days.length]) {
      const html = render(trips[0], pos)
      // Only the defining mention is tinted; the rest of the prose is plain.
      const tagged = (html.match(/class="cbt">CBTmin</g) ?? []).length
      expect(tagged).toBe(1)
    }
  })

  it('omits the melatonin legend entry on delay plans, keeps it on advances', () => {
    // trips[0] is a westward delay: no melatonin anywhere in the plan.
    const delay = render(trips[0], 0)
    expect(delay).not.toContain('Melatonin')
    expect(delay).not.toContain('💊')
    // trips[1] is the eastward advance, where melatonin is scheduled.
    const advance = render(trips[1], 0)
    expect(advance).toContain('Melatonin')
  })

  it('rules the exercise window, which has a range, but not the point advice', () => {
    // Melatonin and the first meal happen at a time; exercise is a slot to
    // fit a session into, so only it gets a range rule under its marker.
    const html = render(trips[1], 1)
    expect(html).toContain('💊')
    expect(html).toContain('🏃')
    const rules = (html.match(/height="3"/g) ?? []).length
    expect(rules).toBe(1)
    expect(html).toContain('fill="#c2553f"')
  })

  it('says CBTmin has arrived on the final day', () => {
    const p = plan(trips[0])
    expect(render(trips[0], p.days.length)).toContain('has arrived on destination time')
  })
})
