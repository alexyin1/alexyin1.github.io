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
 * `nextCbtMin`, normally sitting inside that trailing sleep (while the
 * post-arrival schedule is snapped off the body clock it can sit just
 * outside it).
 *
 * Sleep timing and circadian phase are different things, and only phase is
 * rate-limited. Before the flight, shifting the sleep schedule *is* the
 * mechanism, so sleep tracks CBTmin. From the travel night onward, sleep is
 * behavior: it snaps toward the habitual schedule in destination time -- a
 * modified "sleep on local time" after Roach & Sargent (2019) -- but never
 * further than `zonesOffRegular` hours from the habitual bedtime. It holds
 * there until the CBTmin-derived bedtime catches up, then follows CBTmin the
 * rest of the way. CBTmin itself keeps moving at its physiological rate
 * underneath, and the light windows do the circadian work.
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
// Primary source: Eastman & Burgess (2009), "How To Travel the World Without
// Jet lag", Sleep Med Clin 4(2):241-255 ("E&B" below). See SCIENCE.md for the
// full recommendation-to-source mapping, including which numbers are ours.

export const PARAMS = {
  /**
   * Hours CBTmin precedes habitual wake time. E&B put Tmin 3-4.5h before wake
   * after a full night; we use the middle of that range.
   */
  cbtMinBeforeWakeHours: 3.5,
  /**
   * Max clock advance per day after departure. E&B state 1.5h/day as an
   * upper bound under ideal light timing, but their worked examples deliver
   * ~1h/day and they advise never advancing a sleep schedule faster than
   * that -- and since sleep tracks CBTmin here, the clock rate IS the sleep
   * rate. Conservative is also the safe direction for a planner: assuming
   * too fast ends the plan while the traveler is still misaligned.
   */
  advanceHoursPerDay: 1,
  /**
   * Max clock delay per day after departure. E&B's stated upper bound is
   * 2h/day; their worked examples deliver ~1.5h/day, which we use for the
   * same reasons as the advance rate.
   */
  delayHoursPerDay: 1.5,
  /**
   * Pre-flight shift rate. E&B's pre-adaptation protocols move bed and wake
   * times 1h/day for the few days before departure.
   */
  preTravelHoursPerDay: 1,
  /**
   * Hours of shift assumed to resolve at the destination without pre-travel
   * preparation. OURS: small misalignments are absorbed by destination cues
   * on their own (and under 2h is beneath the CDC's jet-lag threshold), so
   * pre-travel days are only scheduled for the hours beyond this.
   */
  destinationFreeShiftHours: 2,
  /**
   * How far from the habitual bedtime a scheduled bedtime may sit, in hours.
   * OURS. It plays two symmetric roles: (1) total pre-flight shift cap --
   * E&B describe 3-4 days of pre-shifting, but moving further than this while
   * holding a home work/family schedule rarely sticks; and (2) from the
   * travel night onward, how far off the habitual destination bedtime the
   * snapped sleep schedule may start (see the header comment). Overridable
   * per trip via `Trip.zonesOffRegular`.
   */
  zonesOffRegular: 3,
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
  | 'exercise'
  | 'meal'

/**
 * How a piece of advice occupies its times. Two ranges that print the same
 * can mean quite different things -- light has to be on you for the whole
 * window to do its work, while a run only has to land somewhere inside one --
 * so the distinction is carried in the model rather than left to the reader.
 *
 *   'throughout' -- holds for the entire span (sleep, both light windows).
 *   'within'     -- do it once, anywhere inside the span (exercise).
 *   'point'      -- a single moment; start and end are equal (melatonin, meal).
 */
export type AdviceSpan = 'throughout' | 'within' | 'point'

export const ADVICE_SPAN: Record<AdviceKind, AdviceSpan> = {
  sleep: 'throughout',
  'seek-light': 'throughout',
  'avoid-light': 'throughout',
  melatonin: 'point',
  exercise: 'within',
  meal: 'point',
}

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
  /**
   * Max hours a scheduled bedtime may sit from the habitual bedtime, both
   * pre-flight (total pre-shift cap) and post-departure (how far off the
   * habitual destination bedtime the snapped schedule starts). Defaults to
   * PARAMS.zonesOffRegular.
   */
  zonesOffRegular?: number
  /** Override the automatic eastward/westward strategy choice. */
  strategy?: 'auto' | 'advance' | 'delay'
}

export interface Advice {
  kind: AdviceKind
  /** How to read the times below; always ADVICE_SPAN[kind]. */
  span: AdviceSpan
  start: Date
  /** Equal to `start` when `span` is 'point'. */
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
  /** Hours still to shift after tonight's sleep (signed). */
  remainingAfterTonightHours: number
  /**
   * True once the traveler is at the destination with no shift remaining:
   * the clock is synchronized and ordinary sleep habits are all that's left.
   */
  adapted: boolean
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
  /** True when the full shift completes within the plan. */
  completed: boolean
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
    const pre = Math.min(trip.zonesOffRegular ?? PARAMS.zonesOffRegular, mag)
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

  // Only schedule the pre-travel days actually needed: the first couple of
  // hours of shift resolve at the destination without preparation, so a 3h
  // hop needs one pre-travel day, not three.
  const preTravelDaysNeeded =
    Math.abs(shiftHours) > PARAMS.destinationFreeShiftHours
      ? Math.ceil(
          (Math.abs(shiftHours) - PARAMS.destinationFreeShiftHours) /
            PARAMS.preTravelHoursPerDay,
        )
      : Math.abs(shiftHours) > 1e-9
        ? 0
        : Number.POSITIVE_INFINITY // zero-shift plans keep the requested window
  const preTravelDays = Math.max(
    0,
    Math.min(trip.preTravelDays ?? 3, 7, preTravelDaysNeeded),
  )

  // Day 0 is `preTravelDays` before departure, in the origin zone.
  const day0 = depart.setZone(trip.originZone).startOf('day').minus({ days: preTravelDays })

  // CBTmin on day 0: it occurs shortly before that morning's wake time.
  let cbt = day0
    .set({ hour: wake.hour, minute: wake.minute, second: 0, millisecond: 0 })
    .minus(hours(PARAMS.cbtMinBeforeWakeHours))

  const arrivalRate =
    direction === 'advance' ? PARAMS.advanceHoursPerDay : PARAMS.delayHoursPerDay
  const zonesOff = Math.max(0, trip.zonesOffRegular ?? PARAMS.zonesOffRegular)

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

  const frames: Frame[] = []
  let remaining = shiftHours
  let preTravelShiftUsed = 0
  let completedOnDay = -1
  // Wake is carried separately from CBTmin: they track each other before the
  // flight, but decouple once sleep snaps to destination time.
  let wakeCursor: DateTime = cbt.plus(hours(PARAMS.cbtMinBeforeWakeHours))

  for (let i = 0; i < PARAMS.maxPlanDays; i++) {
    const wakeAt = wakeCursor
    const landed = wakeAt.toJSDate() >= trip.arriveUtc
    // The *rate* switches at departure, not arrival: the gentle pre-travel
    // pace and its cap exist because the traveler is still living on home
    // time around work and family. From the travel night onward (including a
    // night slept mid-flight on a red-eye), the full E&B rate applies. A
    // night counts as pre-departure only when the whole day ends before the
    // flight leaves -- comparing bedtime alone misclassifies the travel night
    // on big advances, where the shifted bedtime creeps ahead of departure.
    const nightAfterDeparture = wakeAt.plus(hours(24)).toJSDate() > trip.departUtc

    const allowance = nightAfterDeparture
      ? arrivalRate
      : Math.min(
          PARAMS.preTravelHoursPerDay,
          Math.max(0, zonesOff - preTravelShiftUsed),
        )
    const magnitude = Math.min(allowance, Math.abs(remaining))
    const step = Math.sign(remaining) * magnitude
    if (!nightAfterDeparture) preTravelShiftUsed += magnitude

    // A plan day runs from waking to falling asleep, the way a person
    // experiences it -- so the trailing sleep window belongs to this day even
    // though it usually spills past local midnight. That means we need
    // tomorrow's CBTmin up front, since it sets tonight's bedtime.
    //
    // An advance (positive) moves CBTmin *earlier*, hence the subtraction.
    // `plus({ days: 1 })` is calendar-aware, so local wake time survives DST.
    const nextCbt = cbt.plus({ days: 1 }).minus(hours(step))
    const remainingAfter = remaining - step

    // Bedtime. Before the flight, sleep tracks CBTmin: shifting the schedule
    // is the mechanism, so no night moves faster than the day's shift rate.
    // From the travel night onward we switch to a capped snap-to-local
    // (modified Roach & Sargent): bedtime jumps straight to the habitual
    // destination bedtime offset `zonesOff` hours toward the body clock
    // (later for an advance, earlier for a delay), holds there while the
    // CBTmin-derived bedtime converges, then follows CBTmin the rest of the
    // way home. The min/max below expresses both phases at once: early on
    // the snap target is the closer-to-local bound, and once CBTmin's
    // bedtime passes it, CBTmin wins every night through the final one,
    // which lands on the habitual local bedtime by construction.
    const cbtBed = nextCbt
      .plus(hours(PARAMS.cbtMinBeforeWakeHours))
      .minus(hours(sleepHours))
    let bedAt = cbtBed
    // The snap starts with the first night that begins after wheels-up: a
    // night that straddles an early-morning departure is still slept at home
    // on home cues, so it shifts at the full rate but is not snapped.
    if (nightAfterDeparture && direction !== 'none' && cbtBed.toJSDate() >= trip.departUtc) {
      const local = cbtBed.setZone(trip.destinationZone)
      let snap = local
        .set({ hour: bed.hour, minute: bed.minute, second: 0, millisecond: 0 })
        .plus(hours(direction === 'advance' ? zonesOff : -zonesOff))
      // Pick the representative of that destination-local time nearest the
      // CBTmin bedtime, so the comparison is between the same night.
      const gap = snap.diff(local).as('hours')
      if (gap > 12) snap = snap.minus({ days: 1 })
      else if (gap < -12) snap = snap.plus({ days: 1 })
      bedAt = direction === 'advance'
        ? (snap < cbtBed ? snap : cbtBed) // advance: earlier wins
        : (snap > cbtBed ? snap : cbtBed) // delay: later wins
    }
    const nextWake = bedAt.plus(hours(sleepHours))

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
  // The travel day is the one whose wake-to-wake span contains the departure
  // instant; days partition time, so exactly one qualifies. It anchors both
  // the transit flag and the plan-length floor.
  const departureDayIndex = frames.findIndex(
    (f) => f.wake.toJSDate() <= trip.departUtc && trip.departUtc < f.nextWake.toJSDate(),
  )

  // Run until the night the shift completes -- no trailing settled day, the
  // itinerary ends when the work does -- but always cover through the first
  // day after the travel day, so the traveler gets on-the-ground guidance.
  // (Keying this on the arrival frame instead overshoots by a day whenever a
  // shifted wake lands minutes before touchdown.)
  const coverThroughArrival = departureDayIndex >= 0 ? departureDayIndex + 2 : 1
  const totalDays = Math.min(
    PARAMS.maxPlanDays,
    Math.max(
      completedOnDay < 0 ? PARAMS.maxPlanDays : completedOnDay + 1,
      coverThroughArrival,
      1,
    ),
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
    const { wake: wakeAt, nextWake, bed: bedAt, remainingAtStart } = frames[i]
    // At the destination once past the travel day, even if that day's wake
    // technically precedes touchdown (a wake mid-flight on a long red-eye):
    // such a day is lived at the destination and should be labelled -- and
    // advised -- as there.
    const landed =
      frames[i].landed || (departureDayIndex >= 0 && i > departureDayIndex)
    const zone = landed ? trip.destinationZone : trip.originZone
    // Re-resolve the offset per day so a DST transition mid-plan shows up.
    const place = landed
      ? makePlace(trip.destinationZone, trip.destinationLabel, wakeAt.toJSDate())
      : makePlace(trip.originZone, trip.originLabel, wakeAt.toJSDate())

    const advice: Advice[] = []
    const push = (kind: AdviceKind, start: DateTime, end: DateTime, note: string) => {
      const s = start.toJSDate()
      const e = end.toJSDate()
      advice.push({
        kind,
        span: ADVICE_SPAN[kind],
        start: s,
        end: e,
        zone,
        // A point event is in flight when the moment itself falls between
        // wheels-up and wheels-down; a window, when it overlaps that span.
        inFlight:
          s.getTime() === e.getTime()
            ? s >= trip.departUtc && s <= trip.arriveUtc
            : s < trip.arriveUtc && e > trip.departUtc,
        note,
      })
    }
    /** A window: the advice applies across the span it covers. */
    const add = (kind: AdviceKind, start: DateTime, end: DateTime, note: string) => {
      if (end <= start) return
      push(kind, start, end, note)
    }
    /** A moment: melatonin and the first meal are taken at a time, not over one. */
    const addAt = (kind: AdviceKind, at: DateTime, note: string) => {
      push(kind, at, at, note)
    }

    // Once the shift is complete there is nothing left to push: settled days
    // keep the sleep/meal scaffolding but drop the shift advice.
    const stillShifting = Math.abs(remainingAtStart) > 1e-9

    // Notes stay terse: the standing rules (dinner before bed, why light
    // timing works) live in the trip briefing, so the itinerary only has to
    // say what to do and when. Sources per recommendation are in SCIENCE.md.
    if (stillShifting && direction === 'advance') {
      // Light after CBTmin advances; light before it delays (Khalsa 2003 PRC,
      // as operationalized by E&B). Sleep tracks CBTmin throughout, so waking
      // is always just-after-CBTmin and E&B's light-on-waking rule is exact.
      //
      // E&B pre-flight advance: bright light the first 3-4h after waking.
      // Morning exercise also advances (Youngstedt 2019 exercise PRC).
      add(
        'seek-light',
        wakeAt,
        wakeAt.plus(hours(3)),
        landed
          ? 'Seek light as soon as you wake — open the blinds or take a morning walk.'
          : 'Bright light on waking, outdoors if you can.',
      )
      add('exercise', wakeAt, wakeAt.plus(hours(2)), 'Morning exercise.')
      // Evening light falls before tomorrow's CBTmin and would undo the advance.
      add('avoid-light', bedAt.minus(hours(4)), bedAt, 'Keep the evening dim.')
      if (trip.usesMelatonin !== false) {
        // E&B advance protocol: 0.5 mg about 5h before bedtime (the low-dose
        // melatonin PRC's advance region; Revell 2006 showed 0.5 mg matches
        // 3 mg). The dose hour moves earlier with the shifting bedtime.
        addAt('melatonin', bedAt.minus(hours(5)), 'Low dose, 0.5 mg.')
      }
      // No melatonin on delays: E&B leave it out of westward plans — no
      // evidence it adds anything to well-timed light.
    } else if (stillShifting && direction === 'delay') {
      if (landed) {
        // Post-arrival the operative anchor is CBTmin, not the sleep window.
        // Tonight's light delays only while it falls before tomorrow's CBTmin;
        // the useful zone is roughly the 6h leading up to it, clipped to the
        // waking evening.
        const nextCbtAt = frames[i].nextCbt
        const seekStart = nextCbtAt.minus(hours(6))
        add(
          'seek-light',
          seekStart > wakeAt ? seekStart : wakeAt,
          bedAt,
          'Bright light until bedtime pushes your clock later.',
        )
        // Light in the ~6h after this morning's CBTmin would advance -- the
        // wrong way. Once CBTmin has drifted deep into the night this window
        // shrinks and eventually clears the morning entirely.
        const cbtAt = frames[i].cbt
        const avoidEnd = cbtAt.plus(hours(6))
        if (avoidEnd > wakeAt) {
          add(
            'avoid-light',
            cbtAt > wakeAt ? cbtAt : wakeAt,
            avoidEnd < bedAt ? avoidEnd : bedAt,
            'Keep the morning dim — early light here pushes your clock the wrong way.',
          )
        }
      } else {
        // E&B pre-flight delay: bright light the last 3-4h before bedtime.
        add('seek-light', bedAt.minus(hours(4)), bedAt, 'Bright light through the evening.')
        add('avoid-light', wakeAt, wakeAt.plus(hours(4)), 'Keep the morning dim.')
      }
      // Evening exercise delays (Youngstedt 2019: ~7-10pm region).
      add('exercise', bedAt.minus(hours(4)), bedAt.minus(hours(1)), 'Evening exercise.')
    }

    // Only the first meal is scheduled: meal timing sets peripheral clocks
    // (Wehrens 2017), so eating on the new schedule helps the body fall in
    // line even though it does not move the central clock. The
    // dinner-before-bed rule is a standing tip, not a slot.
    addAt('meal', wakeAt.plus(hours(0.5)), 'First meal.')

    // The day closes with the night's sleep, which runs into tomorrow.
    add('sleep', bedAt, nextWake, 'Target sleep window.')

    advice.sort(
      (a, b) =>
        a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime(),
    )

    // The departure day is shown in both endpoint clocks, since the traveler
    // wakes in one zone and goes to bed in the other.
    const transit = i === departureDayIndex
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
      remainingAfterTonightHours: remainingAtStart - frames[i].step,
      adapted: landed && !stillShifting,
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
    .sort(
      (a, b) =>
        a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime(),
    )

  return {
    shiftHours,
    direction,
    travelDirection,
    origin,
    destination,
    daysToAdjust: daysNeeded,
    completed: completedOnDay >= 0,
    preTravelShiftHours,
    days,
    timeline,
    notes,
  }
}

/**
 * For eastward trips of 8-11h both directions round the clock are defensible:
 * a hard advance or a longer-but-gentler delay -- and in lab studies of large
 * advances a substantial fraction of clocks delay on their own (antidromic
 * re-entrainment; Eastman et al. 2015), so the choice is real. Returns both
 * options with day counts so the traveler can choose, or null outside the
 * band. At 12h the advance/delay distinction collapses and auto always
 * resolves to the gentler delay, so no choice is offered.
 */
export function strategyChoice(trip: Trip): {
  advance: { shiftHours: number; days: number }
  delay: { shiftHours: number; days: number }
} | null {
  const adv = computeShift({ ...trip, strategy: 'advance' })
  if (adv.travelDirection !== 'eastward') return null
  const magnitude = Math.abs(adv.shiftHours)
  if (magnitude < 8 || magnitude >= 12) return null
  const del = computeShift({ ...trip, strategy: 'delay' })
  return {
    advance: {
      shiftHours: adv.shiftHours,
      days: plan({ ...trip, strategy: 'advance' }).daysToAdjust,
    },
    delay: {
      shiftHours: del.shiftHours,
      days: plan({ ...trip, strategy: 'delay' }).daysToAdjust,
    },
  }
}

export type ClockFormat = '24h' | '12h'

/** Format a single instant in a zone, e.g. '07:00' or '7:00 AM'. */
export function formatTime(at: Date, zone: string, clock: ClockFormat = '24h'): string {
  const dt = DateTime.fromJSDate(at, { zone })
  return clock === '12h' ? dt.toFormat('h:mm a') : dt.toFormat('HH:mm')
}

/**
 * A clock time split into the pieces the itinerary lays out in columns, so
 * the colons and meridiems line up down the page instead of drifting with
 * the digit count. `meridiem` is absent on the 24h clock.
 */
export interface TimeParts {
  hour: string
  minute: string
  meridiem?: string
}

/** An advice window broken into its displayable pieces. */
export interface WindowParts {
  /** Weekday the window starts on, e.g. 'Sat'. */
  day: string
  start: TimeParts
  /** Null for a point in time, where there is only a start. */
  end: TimeParts | null
  /** True when the end falls on a later local date -- rendered as '+1'. */
  endsNextDay: boolean
}

function timeParts(at: Date, zone: string, clock: ClockFormat): TimeParts {
  const dt = DateTime.fromJSDate(at, { zone })
  return clock === '12h'
    ? { hour: dt.toFormat('h'), minute: dt.toFormat('mm'), meridiem: dt.toFormat('a') }
    : { hour: dt.toFormat('HH'), minute: dt.toFormat('mm') }
}

/**
 * Break an advice window into display pieces. A window that ends on a later
 * local date -- a sleep window, usually -- is flagged, since otherwise
 * 'Mon 23:00–07:00' reads as going backwards. `zoneOverride` renders the same
 * instants in another zone, used to show transit days in both endpoint clocks.
 */
export function windowParts(
  a: Advice,
  clock: ClockFormat = '24h',
  zoneOverride?: string,
): WindowParts {
  const zone = zoneOverride ?? a.zone
  const s = DateTime.fromJSDate(a.start, { zone })
  const e = DateTime.fromJSDate(a.end, { zone })
  const isPoint = a.start.getTime() === a.end.getTime()
  return {
    day: s.toFormat('EEE'),
    start: timeParts(a.start, zone, clock),
    end: isPoint ? null : timeParts(a.end, zone, clock),
    endsNextDay: !isPoint && !e.hasSame(s, 'day'),
  }
}

/** The same window as a single string, e.g. 'Mon 23:00–07:00 +1'. */
export function formatWindow(
  a: Advice,
  clock: ClockFormat = '24h',
  zoneOverride?: string,
): string {
  const p = windowParts(a, clock, zoneOverride)
  const time = (t: TimeParts) =>
    `${t.hour}:${t.minute}${t.meridiem ? ` ${t.meridiem}` : ''}`
  return (
    `${p.day} ${time(p.start)}` +
    (p.end ? `–${time(p.end)}` : '') +
    (p.endsNextDay ? ' +1' : '')
  )
}
