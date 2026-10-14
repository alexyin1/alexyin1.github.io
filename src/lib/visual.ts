/**
 * Pure helpers behind the day-by-day infographic. Everything that involves
 * time math lives here, testable without a DOM; the SVG component only maps
 * these results to pixels.
 */

import { DateTime, Duration } from 'luxon'
import { PARAMS, type AdviceKind } from './circadian'

export const KIND_EMOJI: Record<AdviceKind, string> = {
  'seek-light': '🌞',
  'avoid-light': '🕶️',
  sleep: '😴',
  melatonin: '💊',
  exercise: '🏃‍♀️',
  meal: '🍽️',
}

export interface Interval {
  start: Date
  end: Date
}

function hoursDur(n: number): Duration {
  return Duration.fromObject({ hours: n })
}

/**
 * Daylight intervals for a zone, clipped to [start, end].
 *
 * Approximation: daylight is 06:00-18:00 local, i.e. equinox at the zone's
 * reference meridian. Good enough to show "your evening is their morning";
 * real sunrise/sunset needs coordinates, which arrive with airport data.
 */
export function daylightIntervals(zone: string, start: Date, end: Date): Interval[] {
  const out: Interval[] = []
  let cursor = DateTime.fromJSDate(start, { zone }).startOf('day').minus({ days: 1 })
  const stop = DateTime.fromJSDate(end, { zone })
  while (cursor <= stop) {
    const dayStart = cursor.set({ hour: 6 })
    const dayEnd = cursor.set({ hour: 18 })
    const s = Math.max(dayStart.toMillis(), start.getTime())
    const e = Math.min(dayEnd.toMillis(), end.getTime())
    if (e > s) out.push({ start: new Date(s), end: new Date(e) })
    cursor = cursor.plus({ days: 1 })
  }
  return out
}

/**
 * Occurrences of the habitual sleep window ('HH:mm' bed to wake, local to
 * `zone`), clipped to [start, end]. Used to draw the reference schedule a
 * traveler is coming from or heading toward.
 */
export function habitualSleepIntervals(
  zone: string,
  bedLocal: string,
  wakeLocal: string,
  start: Date,
  end: Date,
): Interval[] {
  const [bh, bm] = bedLocal.split(':').map(Number)
  const [wh, wm] = wakeLocal.split(':').map(Number)
  const out: Interval[] = []
  let cursor = DateTime.fromJSDate(start, { zone }).startOf('day').minus({ days: 1 })
  const stop = DateTime.fromJSDate(end, { zone }).plus({ days: 1 })
  while (cursor <= stop) {
    const bed = cursor.set({ hour: bh, minute: bm })
    let wake = cursor.set({ hour: wh, minute: wm })
    if (wake <= bed) wake = wake.plus({ days: 1 })
    const s = Math.max(bed.toMillis(), start.getTime())
    const e = Math.min(wake.toMillis(), end.getTime())
    if (e > s) out.push({ start: new Date(s), end: new Date(e) })
    cursor = cursor.plus({ days: 1 })
  }
  return out
}

/**
 * Where the body-clock low (Tmin) should end up: the habitual wake time in
 * destination local time minus the Tmin offset, at the occurrence nearest
 * `near`. The gap between a day's simulated Tmin and this target is the
 * remaining shift, made visible.
 */
export function targetTmin(destinationZone: string, habitualWakeLocal: string, near: Date): Date {
  const [wh, wm] = habitualWakeLocal.split(':').map(Number)
  const base = DateTime.fromJSDate(near, { zone: destinationZone })
  let best: DateTime | null = null
  for (const dayOffset of [-1, 0, 1]) {
    const candidate = base
      .plus({ days: dayOffset })
      .set({ hour: wh, minute: wm, second: 0, millisecond: 0 })
      .minus(hoursDur(PARAMS.cbtMinBeforeWakeHours))
    if (!best || Math.abs(candidate.toMillis() - near.getTime()) < Math.abs(best.toMillis() - near.getTime())) {
      best = candidate
    }
  }
  return best!.toJSDate()
}

/**
 * Schematic core-body-temperature curve: a 24h cosine with its minimum at
 * `tminAt`, sampled across [start, end] as {f, v} pairs where f is the 0..1
 * position on the x-axis and v is -1 (the low) to +1 (the afternoon peak).
 */
export function temperatureCurve(
  tminAt: Date,
  start: Date,
  end: Date,
  samples = 97,
): { f: number; v: number }[] {
  const span = end.getTime() - start.getTime()
  const out: { f: number; v: number }[] = []
  for (let i = 0; i < samples; i++) {
    const f = i / (samples - 1)
    const t = start.getTime() + f * span
    const phaseHours = (t - tminAt.getTime()) / 3.6e6
    out.push({ f, v: -Math.cos((2 * Math.PI * phaseHours) / 24) })
  }
  return out
}

/** 0..1 position of an instant on the [start, end] axis, clamped. */
export function fractionOf(at: Date, start: Date, end: Date): number {
  const f = (at.getTime() - start.getTime()) / (end.getTime() - start.getTime())
  return Math.max(0, Math.min(1, f))
}

/** Hour ticks (every `stepHours` on the local clock of `zone`) within the axis. */
export function hourTicks(
  zone: string,
  start: Date,
  end: Date,
  stepHours = 6,
): { at: Date; label: string }[] {
  const out: { at: Date; label: string }[] = []
  let cursor = DateTime.fromJSDate(start, { zone }).startOf('hour')
  // Advance to the next multiple of stepHours on the local clock.
  while (cursor.hour % stepHours !== 0 || cursor.toJSDate() < start) {
    cursor = cursor.plus({ hours: 1 })
  }
  const stop = DateTime.fromJSDate(end, { zone })
  while (cursor <= stop) {
    out.push({ at: cursor.toJSDate(), label: cursor.toFormat('HH:mm') })
    cursor = cursor.plus({ hours: stepHours })
  }
  return out
}
