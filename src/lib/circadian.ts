/**
 * Jet lag adaptation model.
 *
 * Pure functions only -- no DOM, no React. Everything here is a deterministic
 * function of the trip input, which is what makes it testable in a terminal.
 *
 * The model is a day-by-day simulation of a single phase marker, CBTmin (the
 * core body temperature minimum). Light, melatonin, exercise and meal timing
 * are all emitted relative to wherever CBTmin currently sits, and CBTmin is
 * stepped by a fixed amount each day until it lines up with the destination.
 *
 * Sign conventions, which are the easiest thing to get backwards:
 *   - ADVANCE  = clock moves earlier = eastward travel.
 *   - DELAY    = clock moves later   = westward travel.
 *   - Light AFTER CBTmin advances the clock; light BEFORE CBTmin delays it.
 *
 * NOT medical advice. Parameters are coarse approximations of published
 * phase-response curves and are flagged for review in PARAMS below.
 */

import { DateTime, Duration } from 'luxon'

// --- Parameters ------------------------------------------------------------
// All of these are first-pass estimates. Revisit against the literature.

export const PARAMS = {
  /** Hours CBTmin precedes habitual wake time. */
  cbtMinBeforeWakeHours: 2,
  /** Max clock advance achievable per day. */
  advanceHoursPerDay: 1,
  /** Max clock delay achievable per day. Delays come easier than advances. */
  delayHoursPerDay: 1.5,
  /** Don't produce schedules longer than this many days. */
  maxPlanDays: 16,
}

// --- Types -----------------------------------------------------------------

export type Direction = 'advance' | 'delay' | 'none'

export type AdviceKind =
  | 'sleep'
  | 'seek-light'
  | 'avoid-light'
  | 'melatonin'
  | 'caffeine'
  | 'exercise'
  | 'meal'

export interface Trip {
  /** IANA zone, e.g. 'America/Los_Angeles'. */
  originZone: string
  destinationZone: string
  /**
   * Human-readable place names, e.g. 'Oakland' / 'Beijing'. Travelers often
   * start or end somewhere the zone isn't named after, so these are shown
   * alongside the zone rather than derived from it. Falls back to the zone's
   * own city segment when omitted.
   */
  originLabel?: string
  destinationLabel?: string
  /** Instants, as ISO 8601 strings with offset, or Date. */
  departUtc: Date
  arriveUtc: Date
  /** Habitual schedule at home, as 'HH:mm' local to originZone. */
  habitualBedLocal: string
  habitualWakeLocal: string
  /** How many days before departure the traveler is willing to start shifting. */
  preTravelDays?: number
  usesMelatonin?: boolean
  usesCaffeine?: boolean
  /** Override the automatic eastward/westward strategy choice. */
  strategy?: 'auto' | 'advance' | 'delay'
}

export interface Advice {
  kind: AdviceKind
  start: Date
  end: Date
  /** IANA zone this window should be displayed in. */
  zone: string
  /** True if the window overlaps the flight. */
  inFlight: boolean
  note: string
}

/** Where the traveler is on a given day, and how to label it. */
export interface Place {
  /** Human-readable place name, e.g. 'Beijing'. */
  label: string
  /** IANA zone, e.g. 'Asia/Shanghai'. */
  zone: string
  /** Offset at the relevant instant, e.g. 'UTC+8'. */
  offsetLabel: string
}

export interface PlanDay {
  /** 0-based index from the start of the plan. */
  index: number
  /** Calendar date label in the zone the traveler is in, 'yyyy-MM-dd'. */
  date: string
  zone: string
  /** Fully labelled location for this day, for display. */
  place: Place
  /** CBTmin for this day. */
  cbtMin: Date
  /** Hours still to shift at the start of this day (signed). */
  remainingShiftHours: number
  advice: Advice[]
}

export interface Plan {
  /** Signed hours the body clock must move. Positive = advance. */
  shiftHours: number
  direction: Direction
  /** Labelled endpoints, resolved at departure and arrival respectively. */
  origin: Place
  destination: Place
  /** Days of shifting the plan actually schedules. */
  daysToAdjust: number
  days: PlanDay[]
  /** Flattened, chronologically sorted advice across all days. */
  timeline: Advice[]
  notes: string[]
}

// --- Helpers ---------------------------------------------------------------

function parseHHmm(s: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) throw new Error(`Expected 'HH:mm', got '${s}'`)
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) throw new Error(`Invalid time '${s}'`)
  return { hour, minute }
}

/** Offset of a zone, in hours, at a given instant (DST-aware). */
export function offsetHoursAt(zone: string, at: Date): number {
  const dt = DateTime.fromJSDate(at, { zone })
  if (!dt.isValid) throw new Error(`Invalid zone '${zone}': ${dt.invalidReason}`)
  return dt.offset / 60
}

/**
 * Fallback place name derived from a zone, e.g. 'Asia/Shanghai' -> 'Shanghai'.
 * Only used when the caller didn't supply a real label.
 */
export function zoneCityName(zone: string): string {
  const segment = zone.split('/').pop() ?? zone
  return segment.replace(/_/g, ' ')
}

/** Offset of a zone at an instant, as 'UTC+8' / 'UTC-7' / 'UTC+5:30'. */
export function zoneOffsetLabel(zone: string, at: Date): string {
  const offset = offsetHoursAt(zone, at)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  const whole = Math.floor(abs)
  const minutes = Math.round((abs - whole) * 60)
  return minutes === 0
    ? `UTC${sign}${whole}`
    : `UTC${sign}${whole}:${String(minutes).padStart(2, '0')}`
}

function makePlace(zone: string, label: string | undefined, at: Date): Place {
  return {
    label: label?.trim() || zoneCityName(zone),
    zone,
    offsetLabel: zoneOffsetLabel(zone, at),
  }
}

/** Normalize an hour difference into (-12, 12]. */
export function normalizeShift(hours: number): number {
  let h = ((hours + 12) % 24 + 24) % 24 - 12
  // The modulo above maps 12 -> -12; prefer the positive representative only
  // when the input genuinely was +12 after wrapping.
  if (h === -12 && hours > 0) h = 12
  return h
}

/**
 * Hours the body clock must move for this trip, and in which direction.
 *
 * Strategy 'auto' picks whichever direction finishes sooner, which is why a
 * large eastward shift (say +10h) is handled as a westward delay: delays run
 * at a higher hours-per-day rate.
 */
export function computeShift(trip: Trip): { shiftHours: number; direction: Direction } {
  const raw =
    offsetHoursAt(trip.destinationZone, trip.arriveUtc) -
    offsetHoursAt(trip.originZone, trip.arriveUtc)
  const advanceOption = normalizeShift(raw)

  if (Math.abs(advanceOption) < 1e-9) return { shiftHours: 0, direction: 'none' }

  const forced = trip.strategy && trip.strategy !== 'auto' ? trip.strategy : null
  // The same destination phase is reachable either way around the clock.
  const alternative = advanceOption > 0 ? advanceOption - 24 : advanceOption + 24

  const daysFor = (s: number) =>
    s > 0 ? s / PARAMS.advanceHoursPerDay : -s / PARAMS.delayHoursPerDay

  let shiftHours: number
  if (forced === 'advance') shiftHours = advanceOption > 0 ? advanceOption : alternative
  else if (forced === 'delay') shiftHours = advanceOption < 0 ? advanceOption : alternative
  else shiftHours = daysFor(alternative) < daysFor(advanceOption) ? alternative : advanceOption

  return { shiftHours, direction: shiftHours > 0 ? 'advance' : 'delay' }
}

function hours(n: number): Duration {
  return Duration.fromObject({ hours: n })
}

// --- Plan generation -------------------------------------------------------

export function plan(trip: Trip): Plan {
  const depart = DateTime.fromJSDate(trip.departUtc)
  const arrive = DateTime.fromJSDate(trip.arriveUtc)
  if (!depart.isValid || !arrive.isValid) throw new Error('Invalid departure/arrival instant')
  if (arrive <= depart) throw new Error('Arrival must be after departure')

  const bed = parseHHmm(trip.habitualBedLocal)
  const wake = parseHHmm(trip.habitualWakeLocal)
  const { shiftHours, direction } = computeShift(trip)
  const notes: string[] = []

  // Habitual sleep duration, handling the usual overnight wrap.
  let sleepHours = wake.hour + wake.minute / 60 - (bed.hour + bed.minute / 60)
  if (sleepHours <= 0) sleepHours += 24

  const preTravelDays = Math.max(0, Math.min(trip.preTravelDays ?? 3, 7))

  // Day 0 is `preTravelDays` before departure, in the origin zone.
  const day0 = depart.setZone(trip.originZone).startOf('day').minus({ days: preTravelDays })

  // CBTmin on day 0: it occurs shortly before that morning's wake time.
  let cbt = day0
    .set({ hour: wake.hour, minute: wake.minute, second: 0, millisecond: 0 })
    .minus(hours(PARAMS.cbtMinBeforeWakeHours))

  const ratePerDay =
    direction === 'advance' ? PARAMS.advanceHoursPerDay : PARAMS.delayHoursPerDay
  let remaining = shiftHours

  const daysNeeded =
    direction === 'none' ? 0 : Math.ceil(Math.abs(shiftHours) / ratePerDay)
  // Run until the shift is done, but always cover at least one full day past
  // arrival so the traveler gets on-the-ground guidance.
  const daysAfterArrival = Math.ceil(arrive.diff(day0, 'days').days) + 1
  const totalDays = Math.min(
    PARAMS.maxPlanDays,
    Math.max(daysNeeded + preTravelDays, daysAfterArrival, 1),
  )

  if (daysNeeded + preTravelDays > PARAMS.maxPlanDays) {
    notes.push(
      `Full adaptation would take about ${daysNeeded} days of shifting; this plan is ` +
        `truncated to ${PARAMS.maxPlanDays} days.`,
    )
  }

  const origin = makePlace(trip.originZone, trip.originLabel, trip.departUtc)
  const destination = makePlace(trip.destinationZone, trip.destinationLabel, trip.arriveUtc)

  const days: PlanDay[] = []

  for (let i = 0; i < totalDays; i++) {
    const landed = cbt.toJSDate() >= trip.arriveUtc
    const zone = landed ? trip.destinationZone : trip.originZone
    // Re-resolve the offset per day so a DST transition mid-plan shows up.
    const place = landed
      ? makePlace(trip.destinationZone, trip.destinationLabel, cbt.toJSDate())
      : makePlace(trip.originZone, trip.originLabel, cbt.toJSDate())
    const wakeAt = cbt.plus(hours(PARAMS.cbtMinBeforeWakeHours))
    const bedAt = wakeAt.minus(hours(sleepHours))

    const advice: Advice[] = []
    const add = (kind: AdviceKind, start: DateTime, end: DateTime, note: string) => {
      if (end <= start) return
      advice.push({
        kind,
        start: start.toJSDate(),
        end: end.toJSDate(),
        zone,
        inFlight: start.toJSDate() < trip.arriveUtc && end.toJSDate() > trip.departUtc,
        note,
      })
    }

    add('sleep', bedAt, wakeAt, 'Target sleep window.')

    if (direction === 'advance') {
      // Light after CBTmin advances. Practically: bright light on waking.
      add('seek-light', wakeAt, wakeAt.plus(hours(3)), 'Bright light on waking — outdoors if possible.')
      // Evening light before CBTmin would undo the advance.
      add('avoid-light', bedAt.minus(hours(4)), bedAt, 'Dim the lights; avoid screens and bright indoor light.')
      add('exercise', wakeAt, wakeAt.plus(hours(2)), 'Morning exercise reinforces the advance.')
      if (trip.usesMelatonin !== false) {
        const mel = bedAt.minus(hours(5))
        add('melatonin', mel, mel.plus(hours(1)), 'Low dose (0.5 mg) to pull the clock earlier.')
      }
    } else if (direction === 'delay') {
      // Light before CBTmin delays. Practically: bright light in the evening.
      add('seek-light', bedAt.minus(hours(5)), bedAt, 'Stay in bright light through the evening.')
      // Morning light after CBTmin would undo the delay.
      add('avoid-light', wakeAt, wakeAt.plus(hours(4)), 'Sunglasses outdoors; keep the morning dim.')
      add('exercise', bedAt.minus(hours(6)), bedAt.minus(hours(3)), 'Late-afternoon exercise reinforces the delay.')
    }

    // The following night's bedtime, which trails the day's waking hours.
    const nextBed = bedAt.plus({ days: 1 })

    if (trip.usesCaffeine !== false) {
      // Useful for alertness early in the waking day, but cut it well before bed.
      const caffeineEnd = DateTime.min(wakeAt.plus(hours(5)), nextBed.minus(hours(8)))
      add('caffeine', wakeAt, caffeineEnd, 'Caffeine is fine here; avoid it within 8h of your target bedtime.')
    }

    add('meal', wakeAt.plus(hours(0.5)), wakeAt.plus(hours(1.5)), 'Breakfast — meal timing helps anchor the shift.')
    add('meal', wakeAt.plus(hours(5)), wakeAt.plus(hours(6)), 'Lunch.')
    add('meal', nextBed.minus(hours(4)), nextBed.minus(hours(3)), 'Dinner — keep it at least 3h before bed.')

    advice.sort((a, b) => a.start.getTime() - b.start.getTime())

    days.push({
      index: i,
      date: cbt.setZone(zone).toFormat('yyyy-MM-dd'),
      zone,
      place,
      cbtMin: cbt.toJSDate(),
      remainingShiftHours: remaining,
      advice,
    })

    // Step the clock for tomorrow, capped by whatever shift is left. An
    // advance (positive) moves CBTmin *earlier*, hence the subtraction.
    // `plus({ days: 1 })` is calendar-aware, so local wake time survives DST.
    const step = Math.sign(remaining) * Math.min(ratePerDay, Math.abs(remaining))
    remaining -= step
    cbt = cbt.plus({ days: 1 }).minus(hours(step))
  }

  if (direction === 'none') {
    notes.push('No time zone change — this is a sleep-schedule plan only.')
  }

  const timeline = days
    .flatMap((d) => d.advice)
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  return {
    shiftHours,
    direction,
    origin,
    destination,
    daysToAdjust: daysNeeded,
    days,
    timeline,
    notes,
  }
}

export type ClockFormat = '24h' | '12h'

/** Format a single instant in a zone, e.g. '07:00' or '7:00 AM'. */
export function formatTime(at: Date, zone: string, clock: ClockFormat = '24h'): string {
  const dt = DateTime.fromJSDate(at, { zone })
  return clock === '12h' ? dt.toFormat('h:mm a') : dt.toFormat('HH:mm')
}

/** Format an advice window for display, in its own zone. */
export function formatWindow(a: Advice, clock: ClockFormat = '24h'): string {
  const s = DateTime.fromJSDate(a.start, { zone: a.zone })
  const day = s.toFormat('EEE')
  return `${day} ${formatTime(a.start, a.zone, clock)}–${formatTime(a.end, a.zone, clock)}`
}
