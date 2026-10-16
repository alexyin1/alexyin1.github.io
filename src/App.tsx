import { useEffect, useRef, useState } from 'react'
import {
  plan,
  formatTime,
  formatWindow,
  strategyChoice,
  type ClockFormat,
  type Place,
  type Trip,
} from './lib/circadian'
import { NO_PLAN_MESSAGE, briefing, needsPlan } from './lib/briefing'
import { KIND_EMOJI } from './lib/visual'
import DayVisual from './components/DayVisual'
import { SOURCES } from './lib/sources'
import {
  type Airport,
  airportLabel,
  loadAirports,
  resolveAirport,
  searchAirports,
} from './lib/airports'
import './App.css'

// Flight times are still fixed demo values; the full trip form (dates and
// habitual sleep) is the next step. Origin and destination are live.
const DEMO_TIMES = {
  departUtc: new Date('2026-06-01T20:00:00Z'),
  arriveUtc: new Date('2026-06-02T08:30:00Z'),
  habitualBedLocal: '23:00',
  habitualWakeLocal: '07:00',
  preTravelDays: 3,
}

// Defaults so the page renders before the airport dataset chunk loads.
// Beijing has no separate IANA zone -- all of China uses Asia/Shanghai.
const DEFAULT_ORIGIN: Airport = {
  iata: 'LAX', name: 'Los Angeles International Airport', city: 'Los Angeles',
  country: 'US', lat: 33.942, lon: -118.408, tz: 'America/Los_Angeles',
}
const DEFAULT_DESTINATION: Airport = {
  iata: 'PEK', name: 'Beijing Capital International Airport', city: 'Beijing',
  country: 'CN', lat: 40.08, lon: 116.585, tz: 'Asia/Shanghai',
}

/** Airport picker: a text input with ranked suggestions via datalist. */
function AirportInput(props: {
  id: string
  label: string
  airports: Airport[] | null
  selected: Airport
  onSelect: (a: Airport) => void
}) {
  const { id, airports, selected } = props
  const [text, setText] = useState('')
  const suggestions = airports && text ? searchAirports(airports, text) : []
  return (
    <div className="airport-input">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="text"
        list={`${id}-list`}
        placeholder={`${selected.iata} · ${selected.city}`}
        value={text}
        disabled={!airports}
        onChange={(e) => {
          const value = e.target.value
          setText(value)
          if (!airports) return
          const hit = resolveAirport(airports, value)
          // Only commit on an unambiguous pick: an exact code or a chosen
          // suggestion. Free text commits on blur instead.
          if (hit && (value.trim().length === 3 || value.includes('·'))) {
            props.onSelect(hit)
          }
        }}
        onBlur={() => {
          if (!airports || !text.trim()) return
          const hit = resolveAirport(airports, text)
          if (hit) {
            props.onSelect(hit)
            setText('')
          }
        }}
      />
      <datalist id={`${id}-list`}>
        {suggestions.map((a) => (
          <option key={a.iata} value={airportLabel(a)} />
        ))}
      </datalist>
    </div>
  )
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
  const [airports, setAirports] = useState<Airport[] | null>(null)
  const [origin, setOrigin] = useState<Airport>(DEFAULT_ORIGIN)
  const [destination, setDestination] = useState<Airport>(DEFAULT_DESTINATION)
  useEffect(() => {
    let alive = true
    loadAirports().then((list) => {
      if (alive) setAirports(list)
    })
    return () => {
      alive = false
    }
  }, [])

  const baseTrip: Trip = {
    ...DEMO_TIMES,
    originZone: origin.tz,
    destinationZone: destination.tz,
    originLabel: origin.city || origin.name,
    destinationLabel: destination.city || destination.name,
  }
  // 8-12h eastward is the genuine judgment call: advance (shorter) or delay
  // (gentler). Default to delay per the chronotype rule of thumb; the toggle
  // lets early birds take the advance.
  const choice = strategyChoice(baseTrip)
  const [strategyPick, setStrategyPick] = useState<'delay' | 'advance'>('delay')
  const trip: Trip = { ...baseTrip, strategy: choice ? strategyPick : 'auto' }
  // Whole days are the only meaningful states; fractional positions exist
  // only to smooth the eye between them. So the chart always rests on an
  // integer `targetDay`, and `pos` is the animated position easing there.
  const [targetDay, setTargetDay] = useState(0)
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const posRef = useRef(0)
  posRef.current = pos
  const result = plan(trip)
  const dayCount = result.days.length
  // Chart positions run 0..dayCount: position 0 is the baseline day 0, and
  // position k is plan day k (the itinerary's "Day k").
  const visDay = Math.min(dayCount, Math.round(pos))

  const TRANSITION_MS = 450
  const DWELL_MS = 900
  const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

  // Playback: dwell on each day, then a quick eased hop to the next.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let start: number | null = null
    const fromDay = Math.min(dayCount, Math.round(posRef.current))
    const cycle = DWELL_MS + TRANSITION_MS
    const step = (ts: number) => {
      if (start === null) start = ts
      const t = ts - start
      const k = Math.floor(t / cycle)
      const day = fromDay + k
      if (day >= dayCount) {
        setPos(dayCount)
        setTargetDay(dayCount)
        setPlaying(false)
        return
      }
      const inCycle = t - k * cycle
      const frac = inCycle <= DWELL_MS ? 0 : easeInOut((inCycle - DWELL_MS) / TRANSITION_MS)
      setPos(day + frac)
      setTargetDay(day + (frac > 0.5 ? 1 : 0))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, dayCount])

  // Manual navigation: one quick eased glide to the selected day, however
  // far away it is. The chart never parks between days.
  useEffect(() => {
    if (playing) return
    const from = posRef.current
    if (Math.abs(from - targetDay) < 1e-6) return
    let raf = 0
    let start: number | null = null
    const step = (ts: number) => {
      if (start === null) start = ts
      const f = Math.min(1, (ts - start) / TRANSITION_MS)
      setPos(from + (targetDay - from) * easeInOut(f))
      if (f < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDay, playing])

  const brief = briefing(result)
  const planNeeded = needsPlan(result)

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

      <div className="route-form">
        <AirportInput id="origin" label="From" airports={airports}
          selected={origin} onSelect={setOrigin} />
        <AirportInput id="destination" label="To" airports={airports}
          selected={destination} onSelect={setDestination} />
      </div>
      <p className="route">
        <PlaceTag place={result.origin} /> → <PlaceTag place={result.destination} />
      </p>

      {choice && (
        <div className="strategy-choice">
          <span className="strategy-label">Shift direction:</span>
          <div className="clock-toggle" role="group" aria-label="Shift direction">
            <button
              type="button"
              onClick={() => setStrategyPick('delay')}
              aria-pressed={strategyPick === 'delay'}
              className={strategyPick === 'delay' ? 'active' : ''}
            >
              Delay · stay up later ({choice.delay.days} days)
            </button>
            <button
              type="button"
              onClick={() => setStrategyPick('advance')}
              aria-pressed={strategyPick === 'advance'}
              className={strategyPick === 'advance' ? 'active' : ''}
            >
              Advance · sleep earlier ({choice.advance.days} days)
            </button>
          </div>
          <p className="strategy-tip">
            This far east, both directions work. Night owls usually find delaying
            easier; early birds may prefer advancing.
          </p>
        </div>
      )}

      {!planNeeded && <p className="no-plan">{NO_PLAN_MESSAGE}</p>}

      {planNeeded && (
      <>
      <section className="briefing">
        <h2 className={`direction ${result.travelDirection}`}>{brief.headline}</h2>
        <p className="summary">
          {(() => {
            const m = /^(Delay|Advance)([\s\S]*)$/.exec(brief.summary)
            return m ? (
              <>
                <strong>{m[1]}</strong>
                {m[2]}
              </>
            ) : (
              brief.summary
            )
          })()}
        </p>
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

      <h2 className="itinerary-head">What the plan is doing</h2>

      <div className="vis-controls">
        <label htmlFor="dayslider" className="vis-day">
          {visDay === 0 ? (
            <>
              Day 0 of {dayCount} — baseline, before any shifting{' '}
              <span className="zone">({result.origin.label})</span>
            </>
          ) : (
            <>
              Day {visDay} of {dayCount} — {result.days[visDay - 1].date}{' '}
              <span className="zone">({result.days[visDay - 1].place.label})</span>
            </>
          )}
        </label>
        <div className="vis-row">
        <button
          type="button"
          className="play"
          onClick={() => {
            if (!playing && pos >= dayCount) {
              setPos(0)
              setTargetDay(0)
            }
            setPlaying((p) => !p)
          }}
          aria-label={playing ? 'Pause animation' : 'Play animation'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          id="dayslider"
          type="range"
          min={0}
          max={dayCount}
          step={1}
          list="day-ticks"
          value={targetDay}
          onChange={(e) => {
            setPlaying(false)
            setTargetDay(Number(e.target.value))
          }}
        />
        <datalist id="day-ticks">
          {Array.from({ length: dayCount + 1 }, (_, i) => (
            <option key={i} value={i} label={`Day ${i}`} />
          ))}
        </datalist>
        </div>
      </div>
      <DayVisual
        plan={result}
        pos={pos}
        clock={clock}
        originZone={trip.originZone}
        destinationZone={trip.destinationZone}
        habitualBedLocal={trip.habitualBedLocal}
        habitualWakeLocal={trip.habitualWakeLocal}
        originCoords={origin}
        destinationCoords={destination}
      />

      <h2 className="itinerary-head">Day by day</h2>

      {result.days.map((day) => (
        <section key={day.index}>
          <h2>
            Day {day.index + 1} — {day.date} <PlaceTag place={day.place} />
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
                <span className="kind">
                  <span className="k-emoji" aria-hidden="true">{KIND_EMOJI[a.kind]}</span>{' '}
                  {a.kind.replace('-', ' ')}
                </span>
                <span className="note">
                  {a.note}
                  {a.inFlight ? ' (in flight)' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {result.completed && (
        <p className="adapted-note closing">
          Your circadian clock should now be synchronized to local time. Regular
          sleep habits are enough from here — no extra jet-lag measures needed.
        </p>
      )}
      </>
      )}

      <footer>
        <p>
          Recommendations follow the published protocol of Eastman &amp; Burgess, with
          exercise and meal timing from the sources below. Educational tool — not
          medical advice.
        </p>
        <p>
          Caffeine is omitted intentionally due to evidence indicating it has limited
          effect on circadian entrainment.
        </p>
        <p>
          This tool is intended to optimize circadian entrainment and help travelers
          with jet lag. It is not a substitute for general sleep hygiene, which should
          still be practiced while traveling.
        </p>
        <p>
          Airport data from{' '}
          <a href="https://github.com/mwgg/Airports" target="_blank" rel="noreferrer">
            mwgg/Airports
          </a>{' '}
          (MIT). Sunrise and sunset are computed from airport coordinates.
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
