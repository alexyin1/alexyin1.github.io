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

describe('DayVisual', () => {
  it('renders every day of both directions without NaN geometry', () => {
    for (const trip of trips) {
      const p = plan(trip)
      for (const day of p.days) {
        const html = renderToStaticMarkup(
          <DayVisual
            plan={p} day={day} clock="24h"
            originZone={trip.originZone} destinationZone={trip.destinationZone}
            habitualBedLocal={trip.habitualBedLocal} habitualWakeLocal={trip.habitualWakeLocal}
          />,
        )
        expect(html).toContain('<svg')
        expect(html).not.toContain('NaN')
        expect(html).toContain('body clock')
        // Tonight's sleep bar and both day/night strips are always present.
        expect(html).toContain('sleepbar')
        expect(html).toContain('nightband')
      }
    }
  })

  it('keeps the axis rigid and moves the body clock across it', () => {
    const p = plan(trips[0])
    const render = (day: (typeof p.days)[number]) =>
      renderToStaticMarkup(
        <DayVisual
          plan={p} day={day} clock="24h"
          originZone={trips[0].originZone} destinationZone={trips[0].destinationZone}
          habitualBedLocal={trips[0].habitualBedLocal} habitualWakeLocal={trips[0].habitualWakeLocal}
        />,
      )
    const goalX = (html: string) => /class="tmin goal"/.exec(html) && /cx="([\d.]+)" cy="\d+" r="5"/.exec(html)![1]
    const todayX = (html: string) => /cx="([\d.]+)" cy="\d+" r="4.5"/.exec(html)![1]

    const first = render(p.days[0])
    const last = render(p.days.at(-1)!)
    // The goal marker and the axis labels never move...
    expect(goalX(first)).toBe(goalX(last))
    expect(first).toContain('>12:00</text>')
    expect(last).toContain('>12:00</text>')
    // ...while the body-clock low travels to meet the goal.
    expect(todayX(first)).not.toBe(goalX(first))
    expect(todayX(last)).toBe(goalX(last))
  })

  it('says the clock has arrived on adapted days', () => {
    const p = plan(trips[0])
    const adapted = p.days.find((d) => d.adapted)!
    const html = renderToStaticMarkup(
      <DayVisual
        plan={p} day={adapted} clock="24h"
        originZone={trips[0].originZone} destinationZone={trips[0].destinationZone}
        habitualBedLocal={trips[0].habitualBedLocal} habitualWakeLocal={trips[0].habitualWakeLocal}
      />,
    )
    expect(html).toContain('your clock has arrived')
  })
})
