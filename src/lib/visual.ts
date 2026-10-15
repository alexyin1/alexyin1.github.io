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
import { PARAMS, offsetHoursAt, type AdviceKind } from './circadian'

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
 * Approximate daylight for a zone on the axis. Daylight is taken as
 * 06:00-18:00 local, i.e. equinox at the zone's reference meridian -- good
 * enough to show "your evening is their morning". Real sunrise/sunset needs
 * coordinates, which arrive with airport data.
 */
export function daylightSegments(
  zone: string,
  axisZone: string,
  reference: Date,
  anchorHour = AXIS_ANCHOR_HOUR,
): Seg[] {
  return localWindowSegments(zone, '06:00', 12, axisZone, reference, anchorHour)
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
