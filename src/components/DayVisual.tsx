import type { ClockFormat, Plan } from '../lib/circadian'
import {
  KIND_EMOJI,
  type Seg,
  type VisualFrame,
  axisTicks,
  buildFrame,
  formatHourLabel,
} from '../lib/visual'

/**
 * The day infographic.
 *
 * The x-axis is rigid: one fixed 24h span of destination local time, the same
 * on every day. Everything else -- the body-temperature rhythm, the sleep
 * window, the light windows -- migrates across it as the plan progresses,
 * converging on fixed goal markers.
 *
 * Geometry comes from buildFrame() at a fractional day position, so playback
 * is continuous rather than stepping between days.
 */

// Layout constants (SVG user units). The viewBox is deliberately narrow so
// that stretching it to the column width scales text up rather than down.
const W = 660
const GUT = 116 // left label gutter
const PAD_R = 32 // right padding, so edge tick labels aren't clipped
const PW = W - GUT - PAD_R
const CURVE_TOP = 20
const CURVE_H = 104
const ROW_ADVICE = CURVE_TOP + CURVE_H + 30
const ADVICE_H = 22
const ROW_SLEEP = ROW_ADVICE + 46
const SLEEP_H = 24
const ROW_ORIGIN = ROW_SLEEP + 50
const STRIP_H = 16
const ROW_DEST = ROW_ORIGIN + 24
const AXIS_Y = ROW_DEST + STRIP_H + 14
const H = AXIS_Y + 46

const ADVICE_COLORS: Record<string, string> = {
  'seek-light': '#e8a317',
  'avoid-light': '#5b4a8a',
}

interface Props {
  plan: Plan
  /** Fractional day position; 2.5 is halfway between days 3 and 4. */
  pos: number
  clock: ClockFormat
  originZone: string
  destinationZone: string
  habitualBedLocal: string
  habitualWakeLocal: string
}

export default function DayVisual(props: Props) {
  const { plan, clock } = props
  const frame: VisualFrame = buildFrame(plan.days, props.pos, {
    axisZone: props.destinationZone,
    originZone: props.originZone,
    habitualBedLocal: props.habitualBedLocal,
    habitualWakeLocal: props.habitualWakeLocal,
  })

  const px = (f: number) => GUT + f * PW
  const rects = (segs: Seg[]) =>
    segs.map((s) => ({ x: px(s.f0), width: Math.max(2, (s.f1 - s.f0) * PW) }))
  const yOf = (v: number) => CURVE_TOP + ((1 - v) / 2) * CURVE_H
  const pathOf = (pts: { f: number; v: number }[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.f).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ')

  const ticks = axisTicks(3)

  return (
    <figure className="dayvis">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Circadian chart for day ${frame.dayIndex + 1}`}>
        {ticks.map((t, i) => (
          <line key={`g${i}`} x1={px(t.f)} x2={px(t.f)} y1={CURVE_TOP} y2={AXIS_Y}
            className="gridline" />
        ))}

        <text className="rowlab" x={GUT - 12} y={CURVE_TOP + CURVE_H / 2}>body temp</text>
        <text className="rowlab" x={GUT - 12} y={ROW_ADVICE + 16}>what to do</text>
        <text className="rowlab" x={GUT - 12} y={ROW_SLEEP + 17}>sleep</text>
        <text className="rowlab origin" x={GUT - 12} y={ROW_ORIGIN + 12}>
          {plan.origin.label}
        </text>
        <text className="rowlab dest" x={GUT - 12} y={ROW_DEST + 12}>
          {plan.destination.label}
        </text>

        {/* body temperature: target rhythm behind, today's in front */}
        <path d={pathOf(frame.goalCurve)} className="curve goal" />
        <path d={pathOf(frame.curve)} className="curve today" />
        <circle cx={px(frame.goalF)} cy={yOf(-1)} r={6} className="tmin goal" />
        <circle cx={px(frame.tminF)} cy={yOf(-1)} r={5.5} className="tmin today" />
        <text className="annot" x={px(frame.tminF)} y={yOf(-1) + 19} textAnchor="middle">
          CBTmin
        </text>

        {/* light windows, with point events marked above */}
        {frame.windows.flatMap((w, i) =>
          rects(w.segs).map((r, j) => (
            <rect key={`w${i}-${j}`} x={r.x} y={ROW_ADVICE} width={r.width} height={ADVICE_H}
              rx={4} fill={ADVICE_COLORS[w.kind]} opacity={0.85 * w.opacity} />
          )),
        )}
        {frame.windows.map((w, i) => (
          <text key={`we${i}`} className="emoji" x={px(w.startF) + 4} y={ROW_ADVICE + 17}
            opacity={w.opacity}>
            {KIND_EMOJI[w.kind]}
          </text>
        ))}
        {frame.points.map((w, i) => (
          <text key={`pe${i}`} className="emoji" x={px(w.startF) - 8} y={ROW_ADVICE - 8}
            opacity={w.opacity}>
            {KIND_EMOJI[w.kind]}
          </text>
        ))}

        {/* sleep: fixed target outline, moving bar */}
        {rects(frame.targetSleepSegs).map((r, i) => (
          <rect key={`ts${i}`} x={r.x} y={ROW_SLEEP - 3} width={r.width} height={SLEEP_H + 6}
            rx={5} className="sleeptarget" />
        ))}
        {rects(frame.sleepSegs).map((r, i) => (
          <rect key={`s${i}`} x={r.x} y={ROW_SLEEP} width={r.width} height={SLEEP_H} rx={5}
            className="sleepbar" />
        ))}
        <text className="emoji" x={px(frame.sleepStartF) + 5} y={ROW_SLEEP + 18}>
          {KIND_EMOJI.sleep}
        </text>

        {/* day/night strips: origin first, matching the axis label order */}
        <rect x={GUT} y={ROW_ORIGIN} width={PW} height={STRIP_H} className="nightband" />
        {rects(frame.originDay).map((r, i) => (
          <rect key={`od${i}`} x={r.x} y={ROW_ORIGIN} width={r.width} height={STRIP_H}
            className="dayband" />
        ))}
        <rect x={GUT} y={ROW_DEST} width={PW} height={STRIP_H} className="nightband" />
        {rects(frame.destDay).map((r, i) => (
          <rect key={`dd${i}`} x={r.x} y={ROW_DEST} width={r.width} height={STRIP_H}
            className="dayband" />
        ))}

        {/* rigid axis: origin time first, destination beneath, colour-matched
            to the day/night strips and row labels above */}
        <line x1={GUT} x2={GUT + PW} y1={AXIS_Y} y2={AXIS_Y} className="axisline" />
        {ticks.map((t, i) => {
          const anchor = i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'
          return (
            <g key={`t${i}`}>
              <text className="tick origin" x={px(t.f)} y={AXIS_Y + 16} textAnchor={anchor}>
                {formatHourLabel(t.hour + frame.originDeltaHours, clock)}
              </text>
              <text className="tick dest" x={px(t.f)} y={AXIS_Y + 33} textAnchor={anchor}>
                {formatHourLabel(t.hour, clock)}
              </text>
            </g>
          )
        })}
        <text className="axislab origin" x={GUT - 12} y={AXIS_Y + 16}>
          {plan.origin.label} time
        </text>
        <text className="axislab dest" x={GUT - 12} y={AXIS_Y + 33}>
          {plan.destination.label} time
        </text>
      </svg>

      <ul className="legend">
        {(['sleep', 'seek-light', 'avoid-light', 'melatonin', 'exercise', 'meal'] as const)
          .filter((k) => plan.timeline.some((a) => a.kind === k))
          .map((k) => (
            <li key={k}>
              <span className="lg-emoji" aria-hidden="true">{KIND_EMOJI[k]}</span>
              {k === 'seek-light' ? 'Seek light' : k === 'avoid-light' ? 'Avoid light'
                : k[0].toUpperCase() + k.slice(1)}
            </li>
          ))}
        <li><span className="lg-swatch curve-goal" /> Target rhythm</li>
        <li><span className="lg-swatch sleep-target" /> Target sleep time</li>
        <li><span className="lg-swatch dayband" /> Daylight (approx.)</li>
      </ul>

      <figcaption>
        <p>
          Body temperature follows a circadian (24-hour) rhythm. The planner anchors on
          the daily temperature minimum (<strong>CBTmin</strong>) and shifts it using
          external cues — light, food, exercise and melatonin.
        </p>
        <p>
          The axis is fixed to {plan.destination.label} time, so everything else moves.
          The solid wave is your CBTmin rhythm today; the dashed wave and outline mark
          where your CBTmin and sleep need to end up.{' '}
          {frame.remainingHours > 0.05
            ? `About ${frame.remainingHours.toFixed(1)}h of shifting left — the ${KIND_EMOJI['seek-light']} and ${KIND_EMOJI['avoid-light']} windows sit on the side of CBTmin that pushes it the right way.`
            : 'The two now line up: your CBTmin has arrived on destination time.'}
        </p>
      </figcaption>
    </figure>
  )
}
