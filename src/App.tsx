import { plan, formatWindow, type Trip } from './lib/circadian'
import './App.css'

// Placeholder trip. Step 3 replaces this with a real input form.
const demoTrip: Trip = {
  originZone: 'America/Los_Angeles',
  destinationZone: 'Europe/London',
  departUtc: new Date('2026-06-01T22:00:00Z'),
  arriveUtc: new Date('2026-06-02T08:00:00Z'),
  habitualBedLocal: '23:00',
  habitualWakeLocal: '07:00',
  preTravelDays: 3,
}

export default function App() {
  const result = plan(demoTrip)

  return (
    <main>
      <h1>Jet Lag Planner</h1>
      <p className="summary">
        SFO → LHR · {result.direction === 'advance' ? 'Advance' : 'Delay'} your clock by{' '}
        {Math.abs(result.shiftHours)}h over ~{result.daysToAdjust} days.
      </p>

      {result.days.map((day) => (
        <section key={day.index}>
          <h2>
            Day {day.index + 1} — {day.date}{' '}
            <span className="zone">{day.zone.split('/')[1].replace('_', ' ')}</span>
          </h2>
          <ul>
            {day.advice.map((a, i) => (
              <li key={i} className={a.kind}>
                <span className="window">{formatWindow(a)}</span>
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
        Educational tool based on published circadian research. Not medical advice.
      </footer>
    </main>
  )
}
