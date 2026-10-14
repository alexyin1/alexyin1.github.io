import { formatTime, type ClockFormat, type Plan, type PlanDay } from '../lib/circadian'
import {
  KIND_EMOJI,
  daylightIntervals,
  fractionOf,
  habitualSleepIntervals,
  hourTicks,
  targetTmin,
  temperatureCurve,
} from '../lib/visual'

/**
 * The day infographic: one 24h canvas (this day, wake to wake, in the local
 * time of wherever the traveler is) with
 *   - the schematic body-temperature rhythm and its low point (Tmin), plus a
 *     ghost of where that low must end up,
 *   - this day's light/melatonin/exercise/meal windows,
 *   - the recommended sleep bar against the home and destination habitual
 *     schedules,
 *   - approximate day/night strips for origin and destination.
 */

// Layout constants (SVG user units).
const W = 760
const GUT = 96 // left label gutter
const PW = W - GUT - 10 // plot width
const CURVE_TOP = 16
const CURVE_H = 72
const ROW_ADVICE = CURVE_TOP + CURVE_H + 18
const ROW_SLEEP = ROW_ADVICE + 30
const ROW_ORIGIN = ROW_SLEEP + 30
const ROW_DEST = ROW_ORIGIN + 20
const ROW_TICKS = ROW_DEST + 24
const H = ROW_TICKS + 18

const ADVICE_COLORS: Record<string, string> = {
  'seek-light': '#e8a317',
  'avoid-light': '#5b4a8a',
}

interface Props {
  plan: Plan
  day: PlanDay
  clock: ClockFormat
  originZone: string
  destinationZone: string
  habitualBedLocal: string
  habitualWakeLocal: string
}

export default function DayVisual(props: Props) {
  const { plan, day, clock } = props
  const sleep = day.advice.find((a) => a.kind === 'sleep')!
  const axisStart = day.wake
  const axisEnd = sleep.end
  const x = (at: Date) => GUT + fractionOf(at, axisStart, axisEnd) * PW

  // Body temperature curve for today, dip at the Tmin inside tonight's sleep.
  const curve = temperatureCurve(day.nextCbtMin, axisStart, axisEnd)
  const yOf = (v: number) => CURVE_TOP + ((1 - v) / 2) * CURVE_H
  const pathOf = (pts: { f: number; v: number }[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${(GUT + p.f * PW).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ')

  // Ghost curve: where the rhythm must end up (dip at the destination-aligned
  // Tmin nearest tonight's).
  const goal = targetTmin(props.destinationZone, props.habitualWakeLocal, day.nextCbtMin)
  const goalCurve = temperatureCurve(goal, axisStart, axisEnd)
  const remaining = Math.abs(day.remainingShiftHours)

  const originDay = daylightIntervals(props.originZone, axisStart, axisEnd)
  const destDay = daylightIntervals(props.destinationZone, axisStart, axisEnd)
  const homeSleep = habitualSleepIntervals(
    props.originZone, props.habitualBedLocal, props.habitualWakeLocal, axisStart, axisEnd)
  const destSleep = habitualSleepIntervals(
    props.destinationZone, props.habitualBedLocal, props.habitualWakeLocal, axisStart, axisEnd)

  const ticks = hourTicks(day.zone, axisStart, axisEnd, 6)
  const lightWindows = day.advice.filter((a) => a.kind === 'seek-light' || a.kind === 'avoid-light')
  const pointEvents = day.advice.filter(
    (a) => a.kind === 'melatonin' || a.kind === 'exercise' || a.kind === 'meal')

  return (
    <figure className="dayvis">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Circadian chart for day ${day.index + 1}`}>
        {/* row labels */}
        <text className="rowlab" x={GUT - 8} y={CURVE_TOP + CURVE_H / 2}>body temp</text>
        <text className="rowlab" x={GUT - 8} y={ROW_ADVICE + 12}>light & more</text>
        <text className="rowlab" x={GUT - 8} y={ROW_SLEEP + 12}>sleep</text>
        <text className="rowlab" x={GUT - 8} y={ROW_ORIGIN + 10}>{plan.origin.label} ☀</text>
        <text className="rowlab" x={GUT - 8} y={ROW_DEST + 10}>{plan.destination.label} ☀</text>

        {/* temperature rhythm: goal ghost, then today */}
        <path d={pathOf(goalCurve)} className="curve goal" />
        <path d={pathOf(curve)} className="curve today" />
        <circle cx={x(day.nextCbtMin)} cy={yOf(-1)} r={4} className="tmin today" />
        <circle cx={x(goal)} cy={yOf(-1)} r={4} className="tmin goal" />
        <text className="annot" x={x(day.nextCbtMin)} y={yOf(-1) + 14} textAnchor="middle">
          low {formatTime(day.nextCbtMin, day.zone, clock)}
        </text>
        {remaining > 0.01 && (
          <text className="annot goal" x={x(goal)} y={CURVE_TOP + 10} textAnchor="middle">
            goal {formatTime(goal, day.zone, clock)}
          </text>
        )}

        {/* advice windows */}
        {lightWindows.map((a, i) => (
          <g key={`lw${i}`}>
            <rect
              x={x(a.start)} y={ROW_ADVICE}
              width={Math.max(2, x(a.end) - x(a.start))} height={16}
              rx={3} fill={ADVICE_COLORS[a.kind]} opacity={0.85}
            />
            <text className="emoji" x={x(a.start) + 3} y={ROW_ADVICE + 13}>
              {KIND_EMOJI[a.kind]}
            </text>
          </g>
        ))}
        {pointEvents.map((a, i) => (
          <text key={`pe${i}`} className="emoji" x={x(a.start)} y={ROW_ADVICE + 13}>
            {KIND_EMOJI[a.kind]}
          </text>
        ))}

        {/* sleep: habitual references (ghosts), then tonight's bar */}
        {homeSleep.map((s, i) => (
          <rect key={`hs${i}`} x={x(s.start)} y={ROW_SLEEP + 2}
            width={Math.max(2, x(s.end) - x(s.start))} height={14} rx={3}
            className="sleepref home" />
        ))}
        {destSleep.map((s, i) => (
          <rect key={`ds${i}`} x={x(s.start)} y={ROW_SLEEP + 2}
            width={Math.max(2, x(s.end) - x(s.start))} height={14} rx={3}
            className="sleepref dest" />
        ))}
        <rect
          x={x(sleep.start)} y={ROW_SLEEP}
          width={Math.max(2, x(sleep.end) - x(sleep.start))} height={18} rx={4}
          className="sleepbar"
        />
        <text className="emoji" x={x(sleep.start) + 4} y={ROW_SLEEP + 14}>
          {KIND_EMOJI.sleep}
        </text>

        {/* day/night strips */}
        <rect x={GUT} y={ROW_ORIGIN} width={PW} height={12} className="nightband" />
        {originDay.map((s, i) => (
          <rect key={`od${i}`} x={x(s.start)} y={ROW_ORIGIN}
            width={Math.max(1, x(s.end) - x(s.start))} height={12} className="dayband" />
        ))}
        <rect x={GUT} y={ROW_DEST} width={PW} height={12} className="nightband" />
        {destDay.map((s, i) => (
          <rect key={`dd${i}`} x={x(s.start)} y={ROW_DEST}
            width={Math.max(1, x(s.end) - x(s.start))} height={12} className="dayband" />
        ))}

        {/* time axis in the local clock of where the traveler is */}
        {ticks.map((t, i) => (
          <g key={`tk${i}`}>
            <line x1={x(t.at)} x2={x(t.at)} y1={CURVE_TOP} y2={ROW_TICKS - 8} className="gridline" />
            <text className="tick" x={x(t.at)} y={ROW_TICKS + 6} textAnchor="middle">
              {clock === '12h'
                ? formatTime(t.at, day.zone, '12h').replace(':00 ', '')
                : t.label}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>
        The wave is your body-temperature rhythm; its nightly <strong>low</strong> is the
        clock's anchor. The plan moves the low toward the <strong>goal</strong> — into your
        destination night — by {remaining > 0.01
          ? `placing ${KIND_EMOJI['seek-light']} bright light and ${KIND_EMOJI['avoid-light']} dim windows on the correct side of it (about ${remaining.toFixed(1)}h to go on this day)`
          : 'holding your normal routine — it has arrived'}.
        Day/night strips are approximate (06:00–18:00 local).
      </figcaption>
    </figure>
  )
}
