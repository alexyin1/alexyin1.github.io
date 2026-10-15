/**
 * Trip briefing: the orientation a traveler needs before reading a schedule.
 *
 * Kept apart from circadian.ts deliberately. That file is the science; this
 * one is prose, and prose changes for editorial reasons rather than because
 * the model changed. Everything here is derived from a Plan, so the copy
 * can't drift out of sync with the schedule it describes.
 */

import { PARAMS, type Plan } from './circadian'

/**
 * Below about two time zones of shift there is nothing worth planning: the
 * CDC's threshold for jet lag disorder is crossing at least two zones, and
 * destination cues absorb that much on their own.
 */
export function needsPlan(plan: Plan): boolean {
  return Math.abs(plan.shiftHours) > PARAMS.destinationFreeShiftHours
}

export const NO_PLAN_MESSAGE =
  'Jet lag typically only occurs when traveling more than two time zones ' +
  'apart. When traveling within two time zones, typically no action is ' +
  'needed to shift.'

export interface Briefing {
  /** e.g. 'Westward travel'. */
  headline: string
  /** One sentence: how far the clock moves, which way, over how long. */
  summary: string
  /** Standing rules for this trip, in priority order. */
  tips: string[]
}

function plural(n: number, unit: string): string {
  const rounded = Number.isInteger(n) ? String(n) : n.toFixed(1)
  return `${rounded} ${unit}${n === 1 ? '' : 's'}`
}

export function briefing(plan: Plan): Briefing {
  const magnitude = Math.abs(plan.shiftHours)

  if (plan.direction === 'none') {
    return {
      headline: 'No time zone change',
      summary: 'Your destination is on your home clock, so there is nothing to shift.',
      tips: [
        'Keep your usual sleep and wake times.',
        'Bright light in the morning and a dim evening keep your clock where it is.',
      ],
    }
  }

  const advancing = plan.direction === 'advance'

  // On long eastward hops the clock is sometimes taken the other way round
  // (see Plan.travelDirection). When that happens the headline carries both
  // facts up front, instead of saying 'Eastward' over westward-style advice.
  const strategyDisagrees =
    (plan.travelDirection === 'eastward' && !advancing) ||
    (plan.travelDirection === 'westward' && advancing)
  const travelWord = plan.travelDirection === 'eastward' ? 'Eastward' : 'Westward'
  const headline = strategyDisagrees
    ? `${travelWord} travel · ${advancing ? 'eastward' : 'westward'} shift`
    : `${travelWord} travel`

  // 'Advance' and 'delay' are the terms the literature uses; leading with
  // the verb lets the UI bold exactly that word.
  const summary =
    `${advancing ? 'Advance' : 'Delay'} your body clock by ` +
    `${plural(magnitude, 'hour')} over about ${plural(plan.daysToAdjust, 'day')}.`

  const tips: string[] = []

  // The single most important idea, stated as cause and effect.
  tips.push(
    advancing
      ? 'Bright light in the morning and a dim evening pull your clock earlier. ' +
        'Getting this backwards will push it the wrong way, so the light timing ' +
        'matters more than anything else here.'
      : 'A dim morning and bright light in the evening push your clock later. ' +
        'Getting this backwards will pull it the wrong way, so the light timing ' +
        'matters more than anything else here.',
  )

  // Why the schedule looks gentle at first and then speeds up. There is
  // always at least one pre-arrival day -- the departure day itself -- so
  // this branch is the normal case, not an edge case.
  if (plan.preTravelShiftHours > 0) {
    const post = magnitude - plan.preTravelShiftHours
    tips.push(
      `Shift about an hour a day before you fly — this plan moves you ` +
        `${plural(plan.preTravelShiftHours, 'hour')} while you are still at home. ` +
        (post > 0
          ? `The remaining ${plural(post, 'hour')} ${post === 1 ? 'happens' : 'happen'} ` +
            `after you land, where the local daylight and meal times are working with you.`
          : `The rest settles once you land.`),
    )
  } else {
    tips.push(
      'This plan does all of its shifting after you land, where the local ' +
        'daylight and meal times are working with you.',
    )
  }

  // What the first days actually feel like, so odd hours read as intended
  // rather than as the plan failing. Jet lag disorder typically follows a
  // crossing of two or more time zones (CDC Yellow Book), so the expected
  // rough patch is the days spent at the destination still more than two
  // hours out of alignment.
  const roughDays = plan.days.filter(
    (d) =>
      (d.transit || d.zone === plan.destination.zone) &&
      Math.abs(d.remainingShiftHours) > 2,
  ).length
  tips.push(
    roughDays > 0
      ? `Prepare for about ${plural(roughDays, 'day')} of jet lag discomfort — it sets ` +
        `in when your clock is two or more time zones out of step. If you are wide ` +
        `awake in the small hours or fading early, that is your clock still ` +
        `traveling — hold the light timing and it passes. The first couple of ` +
        `nights at the destination are deliberately up to ${PARAMS.arrivalEaseHours} ` +
        `hours off the local norm, easing onto local time.`
      : `Your clock arrives nearly aligned, so expect little jet lag discomfort — ` +
        `it typically takes a shift of two or more time zones to notice.`,
  )

  // The strategy surprise, when it applies.
  if (strategyDisagrees) {
    tips.push(
      `You are flying ${plan.travelDirection.replace('ward', '')}, but it is faster ` +
        `to take your clock the other way round — ${magnitude} hours ` +
        `${advancing ? 'earlier' : 'later'} rather than ${24 - magnitude} hours ` +
        `${advancing ? 'later' : 'earlier'} — because clocks ${advancing ? 'delay' : 'advance'} ` +
        `more slowly than they ${advancing ? 'advance' : 'delay'}.`,
    )
  }

  // Meal timing sets the body's peripheral clocks even though it does not
  // move the central one (Wehrens 2017), hence: eat on the new schedule.
  tips.push(
    'Eat your meals on the schedule, especially the first one of the day — ' +
      'meal timing helps the rest of your body fall in line with the new clock. ' +
      'Try to have your last meal at least 3 hours before your target bedtime.',
  )

  if (advancing && plan.timeline.some((a) => a.kind === 'melatonin')) {
    tips.push(
      'Melatonin here is for shifting your clock, not for sedation — a low ' +
        '0.5 mg dose at the scheduled time works as well as larger doses, ' +
        'with fewer side effects. (Skip the melatonin advice entirely if you ' +
        'would rather not take it; the light timing does most of the work.)',
    )
  }

  if (plan.daysToAdjust >= PARAMS.maxPlanDays - 1) {
    tips.push(
      'This is a long shift. Partial adaptation is a perfectly good outcome ' +
        'for a short trip — you do not have to finish the schedule.',
    )
  }

  return { headline, summary, tips }
}
