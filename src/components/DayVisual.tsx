import { formatTime, type ClockFormat, type Plan, type PlanDay } from '../lib/circadian'
import {
  KIND_EMOJI,
  type Seg,
  axisFraction,
  axisFractionOfHour,
  axisTicks,
  daylightSegments,
  formatHourLabel,
  intervalSegments,
  localHourDecimal,
  localWindowSegments,
  sleepDurationHours,
  targetTminHour,
  temperatureCurveOnAxis,
} from '../lib/visual'

/**
 * The day infographic.
 *
 * The x-axis is rigid: one fixed 24h span of destination local time, the same
 * on every day. Everything else -- the body-temperature rhythm, the sleep
 * window, the light windows -- migrates across it as the plan progresses,
 * converging on fixed goal markers.
 */

// Layout constants (SVG user units).
const W = 820
const GUT = 104 // left label gutter
const PAD_R = 34 // right padding, so edge tick labels aren't clipped
const PW = W - GUT - PAD_R
const CURVE_TOP = 18
const CURVE_H = 76
const ROW_ADVICE = CURVE_TOP + CURVE_H + 20
const ROW_SLEEP = ROW_ADVICE + 32
const ROW_ORIGIN = ROW_SLEEP + 34
const ROW_DEST = ROW_ORIGIN + 20
const AXIS_Y = ROW_DEST + 20
const H = AXIS_Y + 34

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
  const { plan, day, clock, destinationZone: axisZone } = props
  const sleep = day.advice.find((a) => a.kind === 'sleep')!

  const px = (f: number) => GUT + f * PW
  const segRects = (segs: Seg[]) =>
    segs.map((s) => ({ x: px(s.f0), width: Math.max(2, (s.f1 - s.f0) * PW) }))

  // --- body temperature: today's rhythm against the target rhythm ---------
  const tminHour = localHourDecimal(day.nextCbtMin, axisZone)
  const goalHour = targetTminHour(props.habitualWakeLocal)
  const curve = temperatureCurveOnAxis(tminHour)
  const goalCurve = temperatureCurveOnAxis(goalHour)
  const yOf = (v: number) => CURVE_TOP + ((1 - v) / 2) * CURVE_H
  const pathOf = (pts: { f: number; v: number }[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.f).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ')
  const remaining = Math.abs(day.remainingShiftHours)

  // --- rows ---------------------------------------------------------------
  const sleepSegs = intervalSegments(sleep.start, sleep.end, axisZone)
  const sleepHours = sleepDurationHours(props.habitualBedLocal, props.habitualWakeLocal)
  const targetSleepSegs = localWindowSegments(
    axisZone, props.habitualBedLocal, sleepHours, axisZone, day.wake)
  const originDay = daylightSegments(props.originZone, axisZone, day.wake)
  const destDay = daylightSegments(axisZone, axisZone, day.wake)

  const lightWindows = day.advice.filter((a) => a.kind === 'seek-light' || a.kind === 'avoid-light')
  const pointEvents = day.advice.filter(
    (a) => a.kind === 'melatonin' || a.kind === 'exercise' || a.kind === 'meal')

  const ticks = axisTicks(3)
  const originDelta =
    localHourDecimal(day.wake, props.originZone) - localHourDecimal(day.wake, axisZone)

  return (
    <figure className="dayvis">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Circadian chart for day ${day.index + 1}`}>
        {/* vertical gridlines, drawn first so everything sits on top */}
        {ticks.map((t, i) => (
          <line key={`g${i}`} x1={px(t.f)} x2={px(t.f)} y1={CURVE_TOP} y2={AXIS_Y}
            className="gridline" />
        ))}

        {/* row labels */}
        <text className="rowlab" x={GUT - 10} y={CURVE_TOP + CURVE_H / 2}>body clock</text>
        <text className="rowlab" x={GUT - 10} y={ROW_ADVICE + 13}>what to do</text>
        <text className="rowlab" x={GUT - 10} y={ROW_SLEEP + 13}>sleep</text>
        <text className="rowlab" x={GUT - 10} y={ROW_ORIGIN + 10}>{plan.origin.label}</text>
        <text className="rowlab" x={GUT - 10} y={ROW_DEST + 10}>{plan.destination.label}</text>

        {/* temperature rhythm: target ghost behind, today in front */}
        <path d={pathOf(goalCurve)} className="curve goal" />
        <path d={pathOf(curve)} className="curve today" />
        <circle cx={px(axisFractionOfHour(goalHour))} cy={yOf(-1)} r={5} className="tmin goal" />
        <circle cx={px(axisFraction(day.nextCbtMin, axisZone))} cy={yOf(-1)} r={4.5}
          className="tmin today" />
        <text className="annot" x={px(axisFraction(day.nextCbtMin, axisZone))}
          y={yOf(-1) + 15} textAnchor="middle">
          {formatTime(day.nextCbtMin, axisZone, clock)}
        </text>

        {/* light windows, with point events marked above them */}
        {lightWindows.flatMap((a, i) =>
          segRects(intervalSegments(a.start, a.end, axisZone)).map((r, j) => (
            <rect key={`lw${i}-${j}`} x={r.x} y={ROW_ADVICE} width={r.width} height={17}
              rx={3} fill={ADVICE_COLORS[a.kind]} opacity={0.85} />
          )),
        )}
        {lightWindows.map((a, i) => (
          <text key={`le${i}`} className="emoji"
            x={px(axisFraction(a.start, axisZone)) + 3} y={ROW_ADVICE + 14}>
            {KIND_EMOJI[a.kind]}
          </text>
        ))}
        {pointEvents.map((a, i) => (
          <text key={`pe${i}`} className="emoji"
            x={px(axisFraction(a.start, axisZone)) - 6} y={ROW_ADVICE - 4}>
            {KIND_EMOJI[a.kind]}
          </text>
        ))}

        {/* sleep: target outline fixed on the axis, tonight's bar moving */}
        {segRects(targetSleepSegs).map((r, i) => (
          <rect key={`ts${i}`} x={r.x} y={ROW_SLEEP - 2} width={r.width} height={23} rx={4}
            className="sleeptarget" />
        ))}
        {segRects(sleepSegs).map((r, i) => (
          <rect key={`s${i}`} x={r.x} y={ROW_SLEEP} width={r.width} height={19} rx={4}
            className="sleepbar" />
        ))}
        <text className="emoji" x={px(axisFraction(sleep.start, axisZone)) + 4} y={ROW_SLEEP + 15}>
          {KIND_EMOJI.sleep}
        </text>

        {/* day/night strips: fixed, since both are tied to the local clocks */}
        <rect x={GUT} y={ROW_ORIGIN} width={PW} height={12} className="nightband" />
        {segRects(originDay).map((r, i) => (
          <rect key={`od${i}`} x={r.x} y={ROW_ORIGIN} width={r.width} height={12}
            className="dayband" />
        ))}
        <rect x={GUT} y={ROW_DEST} width={PW} height={12} className="nightband" />
        {segRects(destDay).map((r, i) => (
          <rect key={`dd${i}`} x={r.x} y={ROW_DEST} width={r.width} height={12}
            className="dayband" />
        ))}

        {/* rigid axis: destination time, with home time underneath */}
        <line x1={GUT} x2={GUT + PW} y1={AXIS_Y} y2={AXIS_Y} className="axisline" />
        {ticks.map((t, i) => {
          const anchor = i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'
          return (
            <g key={`t${i}`}>
              <text className="tick" x={px(t.f)} y={AXIS_Y + 13} textAnchor={anchor}>
                {formatHourLabel(t.hour, clock)}
              </text>
              <text className="tick home" x={px(t.f)} y={AXIS_Y + 26} textAnchor={anchor}>
                {formatHourLabel(t.hour + originDelta, clock)}
              </text>
            </g>
          )
        })}
        <text className="axislab" x={GUT - 10} y={AXIS_Y + 13}>
          {plan.destination.label} time
        </text>
        <text className="axislab home" x={GUT - 10} y={AXIS_Y + 26}>
          {plan.origin.label} time
        </text>
      </svg>

      <ul className="legend">
        {(['sleep', 'seek-light', 'avoid-light', 'melatonin', 'exercise', 'meal'] as const).map(
          (k) => (
            <li key={k}>
              <span className="lg-emoji" aria-hidden="true">{KIND_EMOJI[k]}</span>
              {k === 'seek-light' ? 'Seek light' : k === 'avoid-light' ? 'Avoid light'
                : k[0].toUpperCase() + k.slice(1)}
            </li>
          ),
        )}
        <li><span className="lg-swatch curve-goal" /> Target rhythm</li>
        <li><span className="lg-swatch sleep-target" /> Target sleep time</li>
        <li><span className="lg-swatch dayband" /> Daylight (approx.)</li>
      </ul>

      <figcaption>
        The axis is fixed to {plan.destination.label} time — everything else moves.
        The solid wave is your body clock (lowest point = the anchor the plan steers);
        the dashed wave and outline are where it and your sleep need to end up.{' '}
        {remaining > 0.01
          ? `About ${remaining.toFixed(1)}h left to shift on this day — the ${KIND_EMOJI['seek-light']} and ${KIND_EMOJI['avoid-light']} windows sit on the side of the low that pushes it the right way.`
          : 'The two now line up: your clock has arrived.'}
      </figcaption>
    </figure>
  )
}
