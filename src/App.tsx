import { useEffect, useState } from 'react'
import {
  plan,
  formatTime,
  formatWindow,
  type ClockFormat,
  type Place,
  type Trip,
} from './lib/circadian'
import { briefing } from './lib/briefing'
import { SOURCES } from './lib/sources'
import './App.css'

// Placeholder trip. Step 3 replaces this with a real input form.
// Beijing has no separate IANA zone -- all of China uses Asia/Shanghai.
const demoTrip: Trip = {
  originZone: 'America/Los_Angeles',
  destinationZone: 'Asia/Shanghai',
  originLabel: 'Los Angeles',
  destinationLabel: 'Beijing',
  departUtc: new Date('2026-06-01T20:00:00Z'), // 13:00 PDT
  arriveUtc: new Date('2026-06-02T08:30:00Z'), // 16:30 CST, next day
  habitualBedLocal: '23:00',
  habitualWakeLocal: '07:00',
  preTravelDays: 3,
}

const CLOCK_KEY = 'jetlag.clock'

function useClockFormat(): [ClockFormat, (c: ClockFormat) => void] {
  const [clock, setClock] = useState<ClockFormat>(() =>
    localStorage.getItem(CLOCK_KEY) === '12h' ? '12h' : '24h',
  )
  useEffect(() => {
    localStorage.setItem(CLOCK_KEY, clock)
  }, [clock])
  return [clock, setClock]
}

function PlaceTag({ place }: { place: Place }) {
  return (
    <span className="place">
      {place.label}{' '}
      <span className="zone">
        · {place.zone} ({place.offsetLabel})
      </span>
    </span>
  )
}

export default function App() {
  const [clock, setClock] = useClockFormat()
  const result = plan(demoTrip)
  const brief = briefing(result)

  return (
    <main>
      <header className="page-head">
        <h1>Jet Lag Planner</h1>
        <div className="clock-toggle" role="group" aria-label="Clock format">
          {(['24h', '12h'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setClock(c)}
              aria-pressed={clock === c}
              className={clock === c ? 'active' : ''}
            >
              {c === '24h' ? '24h' : 'AM/PM'}
            </button>
          ))}
        </div>
      </header>

      <p className="route">
        <PlaceTag place={result.origin} /> → <PlaceTag place={result.destination} />
      </p>

      <section className="briefing">
        <h2 className={`direction ${result.travelDirection}`}>{brief.headline}</h2>
        <p className="summary">{brief.summary}</p>
        <ul className="tips">
          {brief.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {result.notes.map((n) => (
          <p key={n} className="note-line">
            {n}
          </p>
        ))}
      </section>

      <h2 className="itinerary-head">Day by day</h2>

      {result.days.map((day) => (
        <section key={day.index}>
          <h2>
            Day {day.index + 1} — {day.date} <PlaceTag place={day.place} />
            {day.otherPlace && (
              <>
                {' / '}
                <PlaceTag place={day.otherPlace} />
              </>
            )}
            <span className="span">
              up {formatTime(day.wake, day.zone, clock)} → bed{' '}
              {formatTime(day.bed, day.zone, clock)}
            </span>
          </h2>
          {day.transit && (
            <p className="transit-note">
              Travel day — times shown in both {day.place.label} and{' '}
              {day.otherPlace!.label} clocks.
            </p>
          )}
          <ul>
            {day.advice.map((a, i) => (
              <li key={i} className={a.kind}>
                <span className="window">
                  {formatWindow(a, clock)}
                  {day.otherPlace && (
                    <span className="alt-window">
                      {formatWindow(a, clock, day.otherPlace.zone)} {day.otherPlace.label}
                    </span>
                  )}
                </span>
                <span className="kind">{a.kind.replace('-', ' ')}</span>
                <span className="note">
                  {a.note}
                  {a.inFlight ? ' (in flight)' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer>
        <p>
          Recommendations follow the published protocol of Eastman &amp; Burgess, with
          exercise and meal timing from the sources below. Educational tool — not
          medical advice.
        </p>
        <ul className="sources">
          {SOURCES.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.citation}
              </a>{' '}
              — {s.basis}
            </li>
          ))}
        </ul>
      </footer>
    </main>
  )
}
