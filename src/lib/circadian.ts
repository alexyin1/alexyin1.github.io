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
 * Days are oriented the way a person lives them: each PlanDay starts at wake
 * and ends with falling asleep, so its sleep window trails off the end and
 * crosses local midnight. Each day therefore contains exactly one CBTmin,
 * `nextCbtMin`, sitting inside that trailing sleep.
 *
 * Sleep timing and circadian phase are different things, and only phase is
 * rate-limited. Before the flight, shifting the sleep schedule *is* the
 * mechanism, so sleep tracks CBTmin. After arrival, sleep is behavior: it
 * snaps to the habitual schedule in destination time (eased in over the first
 * couple of nights), while CBTmin keeps moving at its physiological rate
 * underneath and the light windows -- now keyed to CBTmin, not to sleep -- do
 * the circadian work.
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
  /**
   * Max clock advance per day after arrival. Advances are hard: ~1h/day is
   * about the physiological ceiling, so there is little headroom to be more
   * aggressive once you land.
   */
  advanceHoursPerDay: 1,
  /**
   * Max clock delay per day after arrival. Delays come easier than advances,
   * because the free-running human clock is slightly longer than 24h.
   */
  delayHoursPerDay: 1.5,
  /**
   * Before departure the traveler still has work, school and family on home
   * time, so shifting is capped at a gentler rate in both directions.
   */
  preTravelHoursPerDay: 1,
  /**
   * And capped in total: moving more than this before you fly is unpleasant
   * and rarely sustained. The remainder is left for after arrival, where the
   * destination's own light and social cues do most of the work.
   */
  maxPreTravelShiftHours: 3,
  /**
   * After arrival, recommended sleep snaps to the habitual schedule in local
   * time rather than tracking the body clock: sleep timing is behavior and
   * can jump, even though circadian phase cannot. The first nights are eased
   * in, offset toward the body clock by up to this many hours, shrinking by
   * an hour a night (2h, 1h, 0 -- settled by the third night).
   */
  arrivalEaseHours: 2,
  /** Don't produce schedules longer than this many days. */
  maxPlanDays: 16,
}

// --- Types -----------------------------------------------------------------

export type Direction = 'advance' | 'delay' | 'none'

/** Which way round the clock the destination lies. */
export type TravelDirection = 'eastward' | 'westward' | 'none'

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

/**
 * One waking day, running from the moment the traveler gets up to the end of
 * the sleep that follows it. The trailing sleep window normally crosses local
 * midnight, and on aggressive shifts can start well after it.
 */
export interface PlanDay {
  /** 0-based index from the start of the plan. */
  index: number
  /**
   * Calendar date of this day's *wake* time, 'yyyy-MM-dd', in the zone the
   * traveler is in. The day's trailing sleep may end on the following date.
   */
  date: string
  zone: string
  /** Fully labelled location for this day, for display. */
  place: Place
  /** When this day starts: the traveler gets up. */
  wake: Date
  /** When this day ends: the traveler goes to sleep. */
  bed: Date
  /** CBTmin that preceded this day's wake time. */
  cbtMin: Date
  /** CBTmin falling inside this day's trailing sleep window. */
  nextCbtMin: Date
  /** Hours still to shift at the start of this day (signed). */
  remainingShiftHours: number
  /** True if this day overlaps the flight. */
  transit: boolean
  /**
   * On transit days only: the other endpoint, so the UI can show the day in
   * both origin and destination time.
   */
  otherPlace?: Place
  advice: Advice[]
}

export interface Plan {
  /** Signed hours the body clock must move. Positive = advance. */
  shiftHours: number
  direction: Direction
  /**
   * Which way round the clock the destination lies, before any strategy
   * choice. Usually agrees with `direction`, but not always: a long eastward
   * hop can be cheaper to treat as a delay, and then the traveler is flying
   * east while their clock moves west.
   */
  travelDirection: TravelDirection
  /** Labelled endpoints, resolved at departure and arrival respectively. */
  origin: Place
  destination: Place
  /** Days of shifting the plan actually schedules. */
  daysToAdjust: number
  /** How much of the shift happens before arrival (unsigned hours). */
  preTravelShiftHours: number
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
export function computeShift(trip: Trip): {
  shiftHours: number
  direction: Direction
  travelDirection: TravelDirection
} {
  const raw =
    offsetHoursAt(trip.destinationZone, trip.arriveUtc) -
    offsetHoursAt(trip.originZone, trip.arriveUtc)
  const advanceOption = normalizeShift(raw)

  // The short way round the clock is also the direction the traveler is
  // really going, independent of which strategy we end up choosing.
  const travelDirection: TravelDirection =
    advanceOption > 0 ? 'eastward' : advanceOption < 0 ? 'westward' : 'none'

  if (Math.abs(advanceOption) < 1e-9) {
    return { shiftHours: 0, direction: 'none', travelDirection: 'none' }
  }

  const forced = trip.strategy && trip.strategy !== 'auto' ? trip.strategy : null
  // The same destination phase is reachable either way around the clock.
  const alternative = advanceOption > 0 ? advanceOption - 24 : advanceOption + 24

  // Estimated days to complete a shift, accounting for the slower pre-travel
  // phase: the first hours happen at the capped home rate regardless of
  // direction, which moves the advance/delay breakeven from 9.6h to ~10.2h.
  const daysFor = (s: number) => {
    const mag = Math.abs(s)
    const pre = Math.min(PARAMS.maxPreTravelShiftHours, mag)
    const rate = s > 0 ? PARAMS.advanceHoursPerDay : PARAMS.delayHoursPerDay
    return pre / PARAMS.preTravelHoursPerDay + (mag - pre) / rate
  }

  let shiftHours: number
  if (forced === 'advance') shiftHours = advanceOption > 0 ? advanceOption : alternative
  else if (forced === 'delay') shiftHours = advanceOption < 0 ? advanceOption : alternative
  else shiftHours = daysFor(alternative) < daysFor(advanceOption) ? alternative : advanceOption

  return {
    shiftHours,
    direction: shiftHours > 0 ? 'advance' : 'delay',
    travelDirection,
  }
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
  const { shiftHours, direction, travelDirection } = computeShift(trip)
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

  const arrivalRate =
    direction === 'advance' ? PARAMS.advanceHoursPerDay : PARAMS.delayHoursPerDay

  const origin = makePlace(trip.originZone, trip.originLabel, trip.departUtc)
  const destination = makePlace(trip.destinationZone, trip.destinationLabel, trip.arriveUtc)

  /**
   * Pass 1: walk the clock forward and record the shape of each day. We need
   * this before emitting advice, because how long the plan runs depends on
   * when the shift finishes, and that in turn depends on the pre-travel cap.
   */
  interface Frame {
    cbt: DateTime
    nextCbt: DateTime
    wake: DateTime
    nextWake: DateTime
    bed: DateTime
    landed: boolean
    remainingAtStart: number
    step: number
  }

  /**
   * Tonight's bedtime anchored to the destination's wall clock: the habitual
   * bed time in destination-local terms, offset by `easeHours` toward the
   * body clock, on the first such instant after `after`.
   */
  const anchoredBed = (after: DateTime, easeHours: number): DateTime => {
    let candidate = after
      .setZone(trip.destinationZone)
      .startOf('day')
      .set({ hour: bed.hour, minute: bed.minute, second: 0, millisecond: 0 })
      .plus(hours(easeHours))
    while (candidate <= after) candidate = candidate.plus({ days: 1 })
    return candidate
  }

  const frames: Frame[] = []
  let remaining = shiftHours
  let preTravelShiftUsed = 0
  let anchoredNights = 0
  let completedOnDay = -1
  // Wake is carried separately from CBTmin: they track each other before the
  // flight, but decouple once sleep snaps to destination time.
  let wakeCursor: DateTime = cbt.plus(hours(PARAMS.cbtMinBeforeWakeHours))

  for (let i = 0; i < PARAMS.maxPlanDays; i++) {
    const wakeAt = wakeCursor
    const landed = wakeAt.toJSDate() >= trip.arriveUtc
    // Tonight is spent at the destination if a body-schedule bedtime estimate
    // falls after arrival. This covers the travel day, whose waking hours
    // start at home but whose night is the first one in the new zone.
    const estimatedBed = wakeAt.plus(hours(24 - sleepHours))
    const nightAtDestination = estimatedBed.toJSDate() >= trip.arriveUtc

    // Before that first destination night the traveler is still living on
    // home time, so shifting is slower and capped in total; afterwards the
    // destination's own light and social cues support the full rate.
    const allowance = nightAtDestination
      ? arrivalRate
      : Math.min(
          PARAMS.preTravelHoursPerDay,
          Math.max(0, PARAMS.maxPreTravelShiftHours - preTravelShiftUsed),
        )
    const magnitude = Math.min(allowance, Math.abs(remaining))
    const step = Math.sign(remaining) * magnitude
    if (!nightAtDestination) preTravelShiftUsed += magnitude

    // A plan day runs from waking to falling asleep, the way a person
    // experiences it -- so the trailing sleep window belongs to this day even
    // though it usually spills past local midnight. That means we need
    // tomorrow's CBTmin up front, since it sets tonight's bedtime.
    //
    // An advance (positive) moves CBTmin *earlier*, hence the subtraction.
    // `plus({ days: 1 })` is calendar-aware, so local wake time survives DST.
    const nextCbt = cbt.plus({ days: 1 }).minus(hours(step))
    const remainingAfter = remaining - step

    let bedAt: DateTime
    let nextWake: DateTime
    if (nightAtDestination) {
      // Local-anchored night: habitual destination bedtime, offset toward the
      // body clock by an allowance that shrinks an hour a night (2h, 1h, 0).
      // The offset is signed like the shift: an advancing traveler gets a
      // *later* first bedtime, a delaying one an *earlier* crash.
      const ease =
        Math.sign(remainingAfter) *
        Math.min(Math.abs(remainingAfter), Math.max(0, PARAMS.arrivalEaseHours - anchoredNights))
      bedAt = anchoredBed(wakeAt, ease)
      // A late-evening arrival can put the eased bedtime before the plane is
      // on the ground; you sleep when you land, not mid-descent.
      if (bedAt.toJSDate() < trip.arriveUtc) bedAt = arrive.setZone(trip.destinationZone)
      nextWake = bedAt.plus(hours(sleepHours))
      anchoredNights += 1
    } else {
      // Body-schedule night: sleep tracks the shifting CBTmin.
      nextWake = nextCbt.plus(hours(PARAMS.cbtMinBeforeWakeHours))
      bedAt = nextWake.minus(hours(sleepHours))
    }

    frames.push({
      cbt,
      nextCbt,
      wake: wakeAt,
      nextWake,
      bed: bedAt,
      landed,
      remainingAtStart: remaining,
      step,
    })

    remaining = remainingAfter
    if (completedOnDay < 0 && Math.abs(remaining) < 1e-9) completedOnDay = i
    cbt = nextCbt
    wakeCursor = nextWake
  }

  const daysNeeded = frames.filter((f) => f.step !== 0).length
  const preTravelShiftHours = preTravelShiftUsed
  // Run until the shift is done, showing one settled day at the end, but
  // always cover at least one full day past arrival so the traveler gets
  // on-the-ground guidance.
  const daysAfterArrival = Math.ceil(arrive.diff(day0, 'days').days) + 1
  const totalDays = Math.min(
    PARAMS.maxPlanDays,
    Math.max(completedOnDay < 0 ? PARAMS.maxPlanDays : completedOnDay + 2, daysAfterArrival, 1),
  )

  if (completedOnDay < 0 && direction !== 'none') {
    notes.push(
      `This shift takes longer than ${PARAMS.maxPlanDays} days at a sustainable rate; ` +
        `the plan is truncated and you will still be adapting at the end of it.`,
    )
  }

  // Pass 2: emit advice for the days we are actually going to show.
  const days: PlanDay[] = []

  for (let i = 0; i < totalDays; i++) {
    const { wake: wakeAt, nextWake, bed: bedAt, landed, remainingAtStart } = frames[i]
    const zone = landed ? trip.destinationZone : trip.originZone
    // Re-resolve the offset per day so a DST transition mid-plan shows up.
    const place = landed
      ? makePlace(trip.destinationZone, trip.destinationLabel, wakeAt.toJSDate())
      : makePlace(trip.originZone, trip.originLabel, wakeAt.toJSDate())

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

    // Once the shift is complete there is nothing left to push: settled days
    // keep the sleep/caffeine/meal scaffolding but drop the shift advice.
    const stillShifting = Math.abs(remainingAtStart) > 1e-9

    // Notes stay terse: the standing rules (dinner before bed, caffeine
    // cutoff, why light timing works) live in the trip briefing, so the
    // itinerary only has to say what to do and when.
    if (stillShifting && direction === 'advance') {
      // Light after CBTmin advances; light before it delays. Pre-arrival,
      // sleep tracks CBTmin so waking *is* just-after-CBTmin and the simple
      // on-waking rule is exact. Post-arrival, sleep is on local time while
      // CBTmin lags behind it, so the morning splits in two around CBTmin.
      const cbtAt = frames[i].cbt
      if (landed && cbtAt > wakeAt) {
        // The traveler wakes while their clock still reads night: early light
        // would push the wrong way until CBTmin passes.
        const morningCap = wakeAt.plus(hours(4))
        add(
          'avoid-light',
          wakeAt,
          cbtAt < morningCap ? cbtAt : morningCap,
          'Keep the early morning dim — your clock still reads it as night.',
        )
        add('seek-light', cbtAt, cbtAt.plus(hours(3)), 'Bright light from here pulls your clock earlier.')
        add('exercise', cbtAt, cbtAt.plus(hours(2)), 'Exercise with the light.')
      } else {
        add(
          'seek-light',
          wakeAt,
          wakeAt.plus(hours(3)),
          landed
            ? 'Seek light as soon as you wake — open the blinds or take a morning walk.'
            : 'Bright light on waking, outdoors if you can.',
        )
        add('exercise', wakeAt, wakeAt.plus(hours(2)), 'Morning exercise.')
      }
      // Evening light falls before tomorrow's CBTmin and would undo the advance.
      add('avoid-light', bedAt.minus(hours(4)), bedAt, 'Keep the evening dim.')
      if (trip.usesMelatonin !== false) {
        const mel = bedAt.minus(hours(5))
        add('melatonin', mel, mel.plus(hours(1)), 'Low dose, 0.5 mg.')
      }
    } else if (stillShifting && direction === 'delay') {
      // Light before CBTmin delays. Practically: bright light in the evening,
      // which stays correct post-arrival too -- the lagging CBTmin sits in or
      // after the local night, so the whole evening is on its delay side.
      add('seek-light', bedAt.minus(hours(5)), bedAt, 'Bright light through the evening.')
      // Morning light after CBTmin would undo the delay.
      add('avoid-light', wakeAt, wakeAt.plus(hours(4)), 'Keep the morning dim.')
      add('exercise', bedAt.minus(hours(6)), bedAt.minus(hours(3)), 'Late-afternoon exercise.')
    }

    if (trip.usesCaffeine !== false) {
      // Useful for alertness early in the waking day, but cut it well before bed.
      const caffeineEnd = DateTime.min(wakeAt.plus(hours(5)), bedAt.minus(hours(8)))
      add('caffeine', wakeAt, caffeineEnd, 'Caffeine window — nothing after this.')
    }

    // Only the first meal is scheduled. It is the one with real phase-setting
    // value, and the dinner-before-bed rule is a standing tip, not a slot.
    add('meal', wakeAt.plus(hours(0.5)), wakeAt.plus(hours(1.5)), 'First meal.')

    // The day closes with the night's sleep, which runs into tomorrow.
    add('sleep', bedAt, nextWake, 'Target sleep window.')

    advice.sort((a, b) => a.start.getTime() - b.start.getTime())

    // A day that overlaps the flight is shown in both endpoint clocks, since
    // the traveler wakes in one and goes to bed in the other.
    const transit =
      wakeAt.toJSDate() < trip.arriveUtc && nextWake.toJSDate() > trip.departUtc
    const otherPlace = transit
      ? landed
        ? makePlace(trip.originZone, trip.originLabel, wakeAt.toJSDate())
        : makePlace(trip.destinationZone, trip.destinationLabel, wakeAt.toJSDate())
      : undefined

    days.push({
      index: i,
      // Labelled by the morning the traveler wakes up, not by when the
      // trailing sleep window happens to end.
      date: wakeAt.setZone(zone).toFormat('yyyy-MM-dd'),
      zone,
      place,
      wake: wakeAt.toJSDate(),
      bed: bedAt.toJSDate(),
      cbtMin: frames[i].cbt.toJSDate(),
      nextCbtMin: frames[i].nextCbt.toJSDate(),
      remainingShiftHours: remainingAtStart,
      transit,
      otherPlace,
      advice,
    })
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
    travelDirection,
    origin,
    destination,
    daysToAdjust: daysNeeded,
    preTravelShiftHours,
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

/**
 * Format an advice window for display. A window that ends on a later local
 * date -- a sleep window, usually -- is marked '+1', since otherwise
 * 'Mon 23:00–07:00' reads as going backwards. `zoneOverride` renders the same
 * instants in another zone, used to show transit days in both endpoint clocks.
 */
export function formatWindow(
  a: Advice,
  clock: ClockFormat = '24h',
  zoneOverride?: string,
): string {
  const zone = zoneOverride ?? a.zone
  const s = DateTime.fromJSDate(a.start, { zone })
  const e = DateTime.fromJSDate(a.end, { zone })
  const crossesMidnight = !e.hasSame(s, 'day')
  return (
    `${s.toFormat('EEE')} ${formatTime(a.start, zone, clock)}–` +
    `${formatTime(a.end, zone, clock)}${crossesMidnight ? ' +1' : ''}`
  )
}
