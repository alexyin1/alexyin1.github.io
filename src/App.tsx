import { useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import {
  PARAMS,
  plan,
  formatTime,
  formatWindow,
  strategyChoice,
  windowParts,
  zoneOffsetLabel,
  type Advice,
  type ClockFormat,
  type Place,
  type TimeParts,
  type Trip,
} from './lib/circadian'
import { NO_PLAN_MESSAGE, briefing, needsPlan } from './lib/briefing'
import { estimateArrival, resolveFlight } from './lib/flight'
import { formatClockText, parseClockText } from './lib/clocktext'
import { KIND_EMOJI, KIND_LABEL, SPAN_HINT } from './lib/visual'
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

// Initial form values: the LAX -> Beijing demo itinerary, departing 13:00
// Pacific. The arrival is estimated from the route until the user edits it.
const FORM_DEFAULTS = {
  habitualBedLocal: '23:00',
  habitualWakeLocal: '07:00',
  departDate: '2026-06-01',
  departTimeLocal: '13:00',
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
  // While the field is being edited the typed draft is authoritative; the
  // rest of the time it shows the current pick as a real value, not as a
  // placeholder, so a chosen airport reads in full colour like any other
  // filled-in field.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? `${selected.iata} · ${selected.city}`
  const suggestions = airports && draft ? searchAirports(airports, draft) : []
  return (
    <div className="airport-input">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="text"
        list={`${id}-list`}
        placeholder="Airport code or city"
        value={text}
        disabled={!airports}
        // Select the current pick on focus so typing replaces it outright.
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const value = e.target.value
          setDraft(value)
          if (!airports) return
          const hit = resolveAirport(airports, value)
          if (!hit) return
          // Only commit on an unambiguous pick: a chosen suggestion settles
          // the field at once; an exact code commits but stays editable
          // until blur, so typing past it does not fight the user.
          if (value.includes('·')) {
            props.onSelect(hit)
            setDraft(null)
          } else if (value.trim().length === 3) {
            props.onSelect(hit)
          }
        }}
        onBlur={() => {
          if (airports && draft?.trim()) {
            const hit = resolveAirport(airports, draft)
            if (hit) props.onSelect(hit)
          }
          setDraft(null)
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

/**
 * A time field that follows the page's clock toggle. A native time input
 * takes its 12h/24h rendering from the browser locale with no way to
 * override it, so this is a text input over the same 'HH:mm' value,
 * accepting either spelling on the way in.
 */
function TimeInput(props: {
  id: string
  value: string
  onChange: (hhmm: string) => void
  clock: ClockFormat
  ariaLabel?: string
}) {
  const { id, value, onChange, clock } = props
  // While the field has focus the typed draft is authoritative; the rest of
  // the time the text is derived from the value, which is how the clock
  // toggle reaches it.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? formatClockText(value, clock)
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      aria-label={props.ariaLabel}
      placeholder={clock === '12h' ? 'h:mm AM' : 'HH:mm'}
      value={text}
      onChange={(e) => {
        setDraft(e.target.value)
        const parsed = parseClockText(e.target.value)
        if (parsed) onChange(parsed)
      }}
      onBlur={() => {
        const parsed = parseClockText(text)
        if (parsed) onChange(parsed)
        setDraft(null)
      }}
    />
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

/**
 * One clock time. The hour and the meridiem are fixed-width, so '9:00 PM'
 * and '12:00 AM' put their colons and their AM/PM in the same place and a
 * column of times reads straight down.
 */
function ClockTime({ t }: { t: TimeParts }) {
  return (
    <>
      <span className="w-h">{t.hour}</span>:{t.minute}
      {t.meridiem && <span className="w-ap">{t.meridiem}</span>}
    </>
  )
}

/**
 * An advice window as a row of aligned cells: weekday, start, dash, end,
 * next-day marker. Point advice -- melatonin, breakfast -- is a single time,
 * so everything after the start is simply absent.
 */
function WindowLine(props: {
  advice: Advice
  clock: ClockFormat
  zone?: string
  /** Names the zone on the alternate transit line. On screen that line is
      told apart by colour, so the name is read aloud but not shown. */
  place?: string
  className: string
}) {
  const p = windowParts(props.advice, props.clock, props.zone)
  return (
    <span className={props.className}>
      {/* Screen readers get the window as one phrase; the cells that make it
          line up on screen would otherwise be read out piece by piece. */}
      <span className="sr-only">
        {formatWindow(props.advice, props.clock, props.zone)}
        {props.place ? ` ${props.place}` : ''}
      </span>
      <span className="wcells" aria-hidden="true">
        <span className="w-day">{p.day}</span>
        <span className="w-time"><ClockTime t={p.start} /></span>
        <span className="w-dash">{p.end ? '–' : ''}</span>
        <span className="w-time">{p.end && <ClockTime t={p.end} />}</span>
        <span className="w-next">{p.endsNextDay ? '+1' : ''}</span>
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

  // How far off the regular bedtime the plan may schedule sleep, both for the
  // pre-flight shift cap and the post-departure snap toward local time.
  const [zonesOff, setZonesOff] = useState<number>(PARAMS.zonesOffRegular)
  // Preparation days track the nightly shift cap: the default 3, but a
  // traveler who will only move their bedtime 1-2h has correspondingly
  // fewer useful days to prepare in.
  const preTravelDays = Math.min(FORM_DEFAULTS.preTravelDays, Math.round(zonesOff))

  // Trip form state. Times are 'HH:mm', the travel date 'yyyy-MM-dd'.
  const [habitualBed, setHabitualBed] = useState(FORM_DEFAULTS.habitualBedLocal)
  const [habitualWake, setHabitualWake] = useState(FORM_DEFAULTS.habitualWakeLocal)
  const [departDate, setDepartDate] = useState(FORM_DEFAULTS.departDate)
  const [departTime, setDepartTime] = useState(FORM_DEFAULTS.departTimeLocal)
  const initialArrival = estimateArrival(
    FORM_DEFAULTS.departDate, FORM_DEFAULTS.departTimeLocal, DEFAULT_ORIGIN, DEFAULT_DESTINATION,
  )
  const [arriveDate, setArriveDate] = useState(initialArrival?.date ?? '')
  const [arriveTime, setArriveTime] = useState(initialArrival?.time ?? '')
  // Arrival follows a typical direct-flight estimate until the user types
  // their own; picking a different airport hands it back to the estimate.
  const [arrivalManual, setArrivalManual] = useState(false)
  useEffect(() => {
    setArrivalManual(false)
  }, [origin, destination])
  useEffect(() => {
    if (arrivalManual) return
    const est = estimateArrival(departDate, departTime, origin, destination)
    if (est) {
      setArriveDate(est.date)
      setArriveTime(est.time)
    }
  }, [arrivalManual, departDate, departTime, origin, destination])

  const flight = resolveFlight(
    departDate, departTime, origin.tz, arriveDate, arriveTime, destination.tz,
  )
  // Zone offsets shown under each airport, at the moment the traveler is there.
  const departInstant = 'error' in flight ? new Date() : flight.departUtc
  const arriveInstant = 'error' in flight ? new Date() : flight.arriveUtc
  const flightError = 'error' in flight ? flight.error : null
  const sleepError =
    !habitualBed || !habitualWake ? 'Enter your usual bedtime and wake time.' : null
  const formError = sleepError ?? flightError

  const baseTrip: Trip | null =
    'error' in flight || sleepError
      ? null
      : {
          originZone: origin.tz,
          destinationZone: destination.tz,
          originLabel: origin.city || origin.name,
          destinationLabel: destination.city || destination.name,
          departUtc: flight.departUtc,
          arriveUtc: flight.arriveUtc,
          habitualBedLocal: habitualBed,
          habitualWakeLocal: habitualWake,
          preTravelDays,
          zonesOffRegular: zonesOff,
        }
  // 8-12h eastward is the genuine judgment call: advance (shorter) or delay
  // (gentler). Default to delay per the chronotype rule of thumb; the toggle
  // lets early birds take the advance.
  const choice = baseTrip ? strategyChoice(baseTrip) : null
  const [strategyPick, setStrategyPick] = useState<'delay' | 'advance'>('delay')
  const trip: Trip | null = baseTrip
    ? { ...baseTrip, strategy: choice ? strategyPick : 'auto' }
    : null
  // Whole days are the only meaningful states; fractional positions exist
  // only to smooth the eye between them. So the chart always rests on an
  // integer `targetDay`, and `pos` is the animated position easing there.
  const [targetDay, setTargetDay] = useState(0)
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const posRef = useRef(0)
  posRef.current = pos
  const result = trip ? plan(trip) : null
  const dayCount = result ? result.days.length : 0
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

  const brief = result ? briefing(result) : null
  const planNeeded = result ? needsPlan(result) : false
  // The baseline "day 0" is the calendar day before the plan starts.
  const baselineDate = result
    ? DateTime.fromISO(result.days[0].date).minus({ days: 1 }).toFormat('yyyy-MM-dd')
    : ''

  return (
    // The itinerary's time column is sized for the clock in use: 'Sat 9:00
    // PM–12:00 AM +1' needs noticeably more room than 'Sat 21:00–00:00 +1'.
    <main data-clock={clock}>
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
        <div className="leg">
          <AirportInput id="origin" label="From" airports={airports}
            selected={origin} onSelect={setOrigin} />
          <p className="leg-zone">
            {origin.city || origin.name} · {origin.tz} ({zoneOffsetLabel(origin.tz, departInstant)})
          </p>
          <div className="field">
            <label htmlFor="departdate">Departure <span className="muted">({origin.iata} local)</span></label>
            <div className="when">
              <input id="departdate" type="date" value={departDate}
                onChange={(e) => setDepartDate(e.target.value)} />
              <TimeInput id="departtime" ariaLabel="Departure time" clock={clock}
                value={departTime} onChange={setDepartTime} />
            </div>
          </div>
        </div>
        <div className="leg">
          <AirportInput id="destination" label="To" airports={airports}
            selected={destination} onSelect={setDestination} />
          <p className="leg-zone">
            {destination.city || destination.name} · {destination.tz} ({zoneOffsetLabel(destination.tz, arriveInstant)})
          </p>
          <div className="field">
            <label htmlFor="arrivedate">
              Arrival <span className="muted">({destination.iata} local)</span>
            </label>
            <div className="when">
              <input id="arrivedate" type="date" value={arriveDate}
                onChange={(e) => { setArrivalManual(true); setArriveDate(e.target.value) }} />
              <TimeInput id="arrivetime" ariaLabel="Arrival time" clock={clock}
                value={arriveTime}
                onChange={(v) => { setArrivalManual(true); setArriveTime(v) }} />
            </div>
          </div>
        </div>
      </div>

      <div className="trip-form">
        <div className="field">
          <label htmlFor="bedtime">Usual bedtime</label>
          <TimeInput id="bedtime" clock={clock} value={habitualBed}
            onChange={setHabitualBed} />
        </div>
        <div className="field">
          <label htmlFor="waketime">Usual wake time</label>
          <TimeInput id="waketime" clock={clock} value={habitualWake}
            onChange={setHabitualWake} />
        </div>
      </div>
      {formError && <p className="form-error">{formError}</p>}

      <div className="zones-off">
        <label htmlFor="zonesoff">
          Max hours off your regular bedtime: <strong>{zonesOff}h</strong>
        </label>
        <input
          id="zonesoff"
          type="range"
          min={1}
          max={5}
          step={1}
          value={zonesOff}
          onChange={(e) => setZonesOff(Number(e.target.value))}
        />
        <p className="strategy-tip">
          Caps how far the plan shifts your bedtime while you are still at home,
          and how far off the regular local bedtime your first destination
          nights start before easing onto it. Most people manage about 3 hours.
          It also sets how many days of preparation the plan uses before you
          fly: {preTravelDays} {preTravelDays === 1 ? 'day' : 'days'}.
        </p>
      </div>

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
            This far east, both directions work — in lab studies of large advances,
            up to half of participants' clocks drifted into a delay on their own
            (Eastman et al. 2015). Night owls usually find delaying easier; early
            birds may prefer advancing.
          </p>
        </div>
      )}

      {result && !planNeeded && <p className="no-plan">{NO_PLAN_MESSAGE}</p>}

      {result && brief && planNeeded && (
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
          {/* Constant shape -- Day X of Y, date, city -- with a status suffix
              on the endpoints, so the text does not jump between formats. */}
          Day {visDay} of {dayCount} —{' '}
          {visDay === 0 ? baselineDate : result.days[visDay - 1].date}{' '}
          <span className="zone">
            ({visDay === 0 ? result.origin.label : result.days[visDay - 1].place.label})
          </span>
          {visDay === 0 && <span className="day-status"> — baseline, before any shifting</span>}
          {visDay === dayCount && <span className="day-status"> — fully adjusted</span>}
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
        originZone={origin.tz}
        destinationZone={destination.tz}
        habitualBedLocal={habitualBed}
        habitualWakeLocal={habitualWake}
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
              Travel day — <span className="alt-zone">{day.otherPlace!.label} time shown in orange</span>.
            </p>
          )}
          <ul>
            {day.advice.map((a, i) => (
              <li key={i} className={a.kind}>
                <span className="window">
                  <WindowLine advice={a} clock={clock} className="wline" />
                  {day.otherPlace && (
                    <WindowLine
                      advice={a}
                      clock={clock}
                      zone={day.otherPlace.zone}
                      place={day.otherPlace.label}
                      className="wline alt-window alt-zone"
                    />
                  )}
                </span>
                <span className="kind">
                  <span className="k-emoji" aria-hidden="true">{KIND_EMOJI[a.kind]}</span>{' '}
                  {KIND_LABEL[a.kind]}
                </span>
                <span className="note">
                  {a.inFlight && <span className="in-flight">in flight</span>}
                  {a.inFlight && SPAN_HINT[a.span] && ' · '}
                  {SPAN_HINT[a.span]}
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
          Light and melatonin recommendations follow the published protocol of
          Eastman &amp; Burgess; post-flight sleep scheduling follows a capped
          version of Roach &amp; Sargent&apos;s sleep-on-local-time strategy, with
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
