/**
 * Pure helpers behind the day-by-day infographic. Everything that involves
 * time math lives here, testable without a DOM; the SVG component only maps
 * these results to pixels.
 *
 * The chart axis is RIGID: a fixed 24h span of destination local time, the
 * same on every day of the plan. Nothing about the axis moves, so the
 * traveler's body clock, sleep and light windows visibly migrate across it
 * toward fixed goal markers. The axis is anchored at midday so the
 * destination night -- where everything is headed -- sits in the middle
 * rather than being split across both edges.
 */

import { DateTime } from 'luxon'
import { PARAMS, offsetHoursAt, type AdviceKind, type PlanDay } from './circadian'
import { sunTimesAt } from './sun'

/** Destination local hour at the left edge of the axis. */
export const AXIS_ANCHOR_HOUR = 12

export const KIND_EMOJI: Record<AdviceKind, string> = {
  sleep: '😴',
  'seek-light': '☀️',
  'avoid-light': '🕶️',
  melatonin: '💊',
  exercise: '🏃',
  meal: '🍽️',
}

/** A span on the axis in 0..1 coordinates. A wrapped window yields two. */
export interface Seg {
  f0: number
  f1: number
}

function parseHHmm(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h + m / 60
}

function mod24(h: number): number {
  return ((h % 24) + 24) % 24
}

/** Local time of day, in decimal hours, of an instant in a zone. */
export function localHourDecimal(at: Date, zone: string): number {
  const dt = DateTime.fromJSDate(at, { zone })
  return dt.hour + dt.minute / 60 + dt.second / 3600
}

/** Destination local hour at axis position `f`. */
export function axisHourAt(f: number, anchorHour = AXIS_ANCHOR_HOUR): number {
  return mod24(anchorHour + f * 24)
}

/** Axis position of an instant, by its time of day in `axisZone`. */
export function axisFraction(at: Date, axisZone: string, anchorHour = AXIS_ANCHOR_HOUR): number {
  return mod24(localHourDecimal(at, axisZone) - anchorHour) / 24
}

/** Axis position of a bare local hour in the axis zone. */
export function axisFractionOfHour(hour: number, anchorHour = AXIS_ANCHOR_HOUR): number {
  return mod24(hour - anchorHour) / 24
}

/**
 * Segments for a window starting at axis position `f0` and lasting
 * `durationHours`, splitting in two if it runs off the right edge.
 */
export function segmentsFrom(f0: number, durationHours: number): Seg[] {
  if (durationHours >= 24) return [{ f0: 0, f1: 1 }]
  if (durationHours <= 0) return []
  const f1 = f0 + durationHours / 24
  if (f1 <= 1) return [{ f0, f1 }]
  return [
    { f0, f1: 1 },
    { f0: 0, f1: f1 - 1 },
  ]
}

/** Segments for an absolute interval, projected onto the axis. */
export function intervalSegments(
  start: Date,
  end: Date,
  axisZone: string,
  anchorHour = AXIS_ANCHOR_HOUR,
): Seg[] {
  const durationHours = (end.getTime() - start.getTime()) / 3.6e6
  return segmentsFrom(axisFraction(start, axisZone, anchorHour), durationHours)
}

/**
 * Segments for a window expressed on another zone's local clock -- e.g. the
 * traveler's habitual 23:00-07:00 at home, or a city's daylight hours --
 * projected onto the destination-time axis.
 */
export function localWindowSegments(
  zone: string,
  startLocal: string,
  durationHours: number,
  axisZone: string,
  reference: Date,
  anchorHour = AXIS_ANCHOR_HOUR,
): Seg[] {
  const delta = offsetHoursAt(axisZone, reference) - offsetHoursAt(zone, reference)
  const startOnAxis = parseHHmm(startLocal) + delta
  return segmentsFrom(axisFractionOfHour(startOnAxis, anchorHour), durationHours)
}

/**
 * Approximate daylight for a zone on the axis: 06:00-18:00 local, i.e.
 * equinox at the zone's reference meridian. The fallback when no coordinates
 * are known.
 */
export function daylightSegments(
  zone: string,
  axisZone: string,
  reference: Date,
  anchorHour = AXIS_ANCHOR_HOUR,
): Seg[] {
  return localWindowSegments(zone, '06:00', 12, axisZone, reference, anchorHour)
}

export interface Coords {
  lat: number
  lon: number
}

/**
 * Daylight on the axis for a real place: actual sunrise-to-sunset computed
 * from coordinates for the civil date the reference instant falls on there.
 * Falls back to the 06:00-18:00 approximation without coordinates. Polar
 * edge cases render honestly: all day or none of it.
 */
export function daylightSegmentsAt(
  coords: Coords | null | undefined,
  zone: string,
  axisZone: string,
  reference: Date,
  anchorHour = AXIS_ANCHOR_HOUR,
): Seg[] {
  if (!coords) return daylightSegments(zone, axisZone, reference, anchorHour)
  const sun = sunTimesAt(reference, zone, coords.lat, coords.lon)
  if (sun.polar === 'night') return []
  if (sun.polar === 'day') return [{ f0: 0, f1: 1 }]
  return intervalSegments(sun.sunrise!, sun.sunset!, axisZone, anchorHour)
}

/** Hours between a habitual bed and wake time, handling the midnight wrap. */
export function sleepDurationHours(bedLocal: string, wakeLocal: string): number {
  const d = parseHHmm(wakeLocal) - parseHHmm(bedLocal)
  return d <= 0 ? d + 24 : d
}

/**
 * Destination local hour the body-clock low should end up at: habitual wake
 * minus the Tmin offset. Fixed on the axis, so it makes a stable goal marker.
 */
export function targetTminHour(habitualWakeLocal: string): number {
  return mod24(parseHHmm(habitualWakeLocal) - PARAMS.cbtMinBeforeWakeHours)
}

/**
 * Schematic core-body-temperature curve sampled in axis coordinates: a 24h
 * cosine with its minimum at local hour `tminHour`, returning {f, v} with
 * v from -1 (the low) to +1 (the afternoon peak).
 */
export function temperatureCurveOnAxis(
  tminHour: number,
  anchorHour = AXIS_ANCHOR_HOUR,
  samples = 145,
): { f: number; v: number }[] {
  const out: { f: number; v: number }[] = []
  for (let i = 0; i < samples; i++) {
    const f = i / (samples - 1)
    const hoursFromTmin = anchorHour + f * 24 - tminHour
    out.push({ f, v: -Math.cos((2 * Math.PI * hoursFromTmin) / 24) })
  }
  return out
}

/** Evenly spaced axis ticks, as destination local hours. */
export function axisTicks(stepHours = 3, anchorHour = AXIS_ANCHOR_HOUR): { f: number; hour: number }[] {
  const out: { f: number; hour: number }[] = []
  for (let h = 0; h <= 24; h += stepHours) {
    out.push({ f: h / 24, hour: mod24(anchorHour + h) })
  }
  return out
}

/** Short label for a whole local hour, e.g. '15:00' or '3 PM'. */
export function formatHourLabel(hour: number, clock: '24h' | '12h'): string {
  const h = mod24(Math.round(hour))
  if (clock === '24h') return `${String(h).padStart(2, '0')}:00`
  const suffix = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display} ${suffix}`
}

/** Local time of day as 'HH:mm' / 'h:mm AM', for fractional (animated) hours. */
export function formatDecimalHour(hour: number, clock: '24h' | '12h'): string {
  const total = Math.round(mod24(hour) * 60)
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  const mm = String(m).padStart(2, '0')
  if (clock === '24h') return `${String(h).padStart(2, '0')}:${mm}`
  const suffix = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:${mm} ${suffix}`
}

// --- Interpolation ---------------------------------------------------------
// The chart animates continuously between plan days, so geometry is built at
// a fractional day position rather than per-day. Positions live on a circular
// axis, so they interpolate the short way round.

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Signed distance from a to b on a 0..1 circle, in (-0.5, 0.5]. */
export function shortestFracDelta(a: number, b: number): number {
  const d = ((((b - a) % 1) + 1.5) % 1) - 0.5
  return d
}

/** Interpolate between two axis positions the short way round. */
export function lerpFrac(a: number, b: number, t: number): number {
  const f = a + shortestFracDelta(a, b) * t
  return ((f % 1) + 1) % 1
}

export interface FrameWindow {
  kind: AdviceKind
  startF: number
  hours: number
  segs: Seg[]
  opacity: number
}

export interface VisualFrame {
  /** Nearest whole day, for labels and text that should not flicker. */
  dayIndex: number
  curve: { f: number; v: number }[]
  goalCurve: { f: number; v: number }[]
  tminF: number
  tminHour: number
  goalF: number
  goalHour: number
  sleepSegs: Seg[]
  sleepStartF: number
  targetSleepSegs: Seg[]
  windows: FrameWindow[]
  points: FrameWindow[]
  originDay: Seg[]
  destDay: Seg[]
  originDeltaHours: number
  remainingHours: number
}

interface DayGeom {
  tminF: number
  sleepStartF: number
  sleepHours: number
  windows: { kind: AdviceKind; startF: number; hours: number }[]
  points: { kind: AdviceKind; startF: number; hours: number }[]
  remaining: number
}

const LIGHT_KINDS: AdviceKind[] = ['seek-light', 'avoid-light']

function dayGeometry(day: PlanDay, axisZone: string): DayGeom {
  const sleep = day.advice.find((a) => a.kind === 'sleep')!
  const windows: DayGeom['windows'] = []
  const points: DayGeom['points'] = []
  for (const a of day.advice) {
    if (a.kind === 'sleep') continue
    const entry = {
      kind: a.kind,
      startF: axisFraction(a.start, axisZone),
      hours: (a.end.getTime() - a.start.getTime()) / 3.6e6,
    }
    if (LIGHT_KINDS.includes(a.kind)) windows.push(entry)
    else points.push(entry)
  }
  return {
    tminF: axisFraction(day.nextCbtMin, axisZone),
    sleepStartF: axisFraction(sleep.start, axisZone),
    sleepHours: (sleep.end.getTime() - sleep.start.getTime()) / 3.6e6,
    windows,
    points,
    // The chart shows tonight's CBTmin, so the caption counts what is
    // left after tonight -- zero on the night the shift completes.
    remaining: Math.abs(day.remainingAfterTonightHours),
  }
}

/**
 * Blend two days' window sets. Entries are matched by kind and position
 * within kind so they slide; anything unmatched fades instead, which is what
 * happens when a day gains or loses a window.
 */
function blendWindows(
  a: { kind: AdviceKind; startF: number; hours: number }[],
  b: { kind: AdviceKind; startF: number; hours: number }[],
  t: number,
): FrameWindow[] {
  const out: FrameWindow[] = []
  const kinds = Array.from(new Set([...a.map((w) => w.kind), ...b.map((w) => w.kind)]))
  for (const kind of kinds) {
    const as = a.filter((w) => w.kind === kind)
    const bs = b.filter((w) => w.kind === kind)
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
      const x = as[i]
      const y = bs[i]
      if (x && y) {
        const startF = lerpFrac(x.startF, y.startF, t)
        const hours = lerp(x.hours, y.hours, t)
        out.push({ kind, startF, hours, segs: segmentsFrom(startF, hours), opacity: 1 })
      } else if (x) {
        out.push({ ...x, segs: segmentsFrom(x.startF, x.hours), opacity: 1 - t })
      } else {
        out.push({ ...y!, segs: segmentsFrom(y!.startF, y!.hours), opacity: t })
      }
    }
  }
  return out
}

/**
 * Build the chart geometry at a fractional position on a 0..days.length
 * scale, where position 0 is "day 0": the untouched baseline -- habitual
 * sleep on the home clock, CBTmin where it started, nothing to do yet --
 * and position k (k >= 1) is plan day k. Everything continuous (the rhythm,
 * the sleep bar, the light windows) is interpolated between positions, while
 * labels snap to the nearest whole position so text does not flicker.
 */
export function buildFrame(
  days: PlanDay[],
  pos: number,
  opts: {
    axisZone: string
    originZone: string
    habitualBedLocal: string
    habitualWakeLocal: string
    originCoords?: Coords | null
    destinationCoords?: Coords | null
    anchorHour?: number
  },
): VisualFrame {
  const anchorHour = opts.anchorHour ?? AXIS_ANCHOR_HOUR

  // Day 0: the traveler's life before the plan touches it.
  const baselineGeometry = (): DayGeom => {
    const ref = days[0].wake
    const delta = offsetHoursAt(opts.axisZone, ref) - offsetHoursAt(opts.originZone, ref)
    const [bh, bm] = opts.habitualBedLocal.split(':').map(Number)
    return {
      tminF: axisFraction(days[0].cbtMin, opts.axisZone, anchorHour),
      sleepStartF: axisFractionOfHour(bh + bm / 60 + delta, anchorHour),
      sleepHours: sleepDurationHours(opts.habitualBedLocal, opts.habitualWakeLocal),
      windows: [],
      points: [],
      remaining: Math.abs(days[0].remainingShiftHours),
    }
  }

  const clamped = Math.max(0, Math.min(pos, days.length))
  const i0 = Math.floor(clamped)
  const i1 = Math.min(i0 + 1, days.length)
  const t = clamped - i0
  const geomAt = (i: number) => (i === 0 ? baselineGeometry() : dayGeometry(days[i - 1], opts.axisZone))
  const g0 = geomAt(i0)
  const g1 = geomAt(i1)
  const dayIndex = Math.min(days.length, Math.round(clamped))
  const reference = days[Math.max(0, dayIndex - 1)].wake

  const tminF = lerpFrac(g0.tminF, g1.tminF, t)
  const goalHour = targetTminHour(opts.habitualWakeLocal)
  const sleepStartF = lerpFrac(g0.sleepStartF, g1.sleepStartF, t)
  const sleepHours = lerp(g0.sleepHours, g1.sleepHours, t)

  return {
    dayIndex,
    curve: temperatureCurveOnAxis(axisHourAt(tminF, anchorHour), anchorHour),
    goalCurve: temperatureCurveOnAxis(goalHour, anchorHour),
    tminF,
    tminHour: axisHourAt(tminF, anchorHour),
    goalF: axisFractionOfHour(goalHour, anchorHour),
    goalHour,
    sleepSegs: segmentsFrom(sleepStartF, sleepHours),
    sleepStartF,
    targetSleepSegs: localWindowSegments(
      opts.axisZone,
      opts.habitualBedLocal,
      sleepDurationHours(opts.habitualBedLocal, opts.habitualWakeLocal),
      opts.axisZone,
      reference,
      anchorHour,
    ),
    windows: blendWindows(g0.windows, g1.windows, t),
    points: blendWindows(g0.points, g1.points, t),
    originDay: daylightSegmentsAt(opts.originCoords, opts.originZone, opts.axisZone, reference, anchorHour),
    destDay: daylightSegmentsAt(opts.destinationCoords, opts.axisZone, opts.axisZone, reference, anchorHour),
    originDeltaHours:
      localHourDecimal(reference, opts.originZone) - localHourDecimal(reference, opts.axisZone),
    remainingHours: lerp(g0.remaining, g1.remaining, t),
  }
}
