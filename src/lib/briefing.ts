/**
 * Trip briefing: the orientation a traveler needs before reading a schedule.
 *
 * Kept apart from circadian.ts deliberately. That file is the science; this
 * one is prose, and prose changes for editorial reasons rather than because
 * the model changed. Everything here is derived from a Plan, so the copy
 * can't drift out of sync with the schedule it describes.
 */

import { PARAMS, type Plan } from './circadian'

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
  const headline = plan.travelDirection === 'eastward' ? 'Eastward travel' : 'Westward travel'

  // 'Advance' and 'delay' are the terms the literature uses, and they are
  // worth teaching -- but lead with earlier/later, which needs no gloss.
  const summary =
    `Move your body clock ${plural(magnitude, 'hour')} ` +
    `${advancing ? 'earlier' : 'later'} (${advancing ? 'an advance' : 'a delay'}) ` +
    `over about ${plural(plan.daysToAdjust, 'day')}.`

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
        `${plural(plan.preTravelShiftHours, 'hour')} while you are still at home, ` +
        `which is about as much as most people can manage around work and family. ` +
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

  // The strategy surprise, when it applies.
  const strategyDisagrees =
    (plan.travelDirection === 'eastward' && !advancing) ||
    (plan.travelDirection === 'westward' && advancing)
  if (strategyDisagrees) {
    tips.push(
      `You are flying ${plan.travelDirection.replace('ward', '')}, but it is faster ` +
        `to take your clock the other way round — ${magnitude} hours ` +
        `${advancing ? 'earlier' : 'later'} rather than ${24 - magnitude} hours ` +
        `${advancing ? 'later' : 'earlier'} — because clocks ${advancing ? 'delay' : 'advance'} ` +
        `more slowly than they ${advancing ? 'advance' : 'delay'}.`,
    )
  }

  tips.push('Finish dinner at least 3 hours before your target bedtime.')

  if (plan.timeline.some((a) => a.kind === 'caffeine')) {
    tips.push('No caffeine within 8 hours of your target bedtime.')
  }

  if (advancing && plan.timeline.some((a) => a.kind === 'melatonin')) {
    tips.push(
      'Melatonin here is for shifting your clock, not for sedation — a low ' +
        '0.5 mg dose at the scheduled time does more than a large one at bedtime.',
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
