/**
 * The research this planner is based on. Rendered in the UI so the line from
 * recommendation to source is visible to users, not just to us; SCIENCE.md
 * maps each individual recommendation to its source and code location.
 */

export interface Source {
  id: string
  citation: string
  url: string
  /** What we take from it, in one line. */
  basis: string
}

export const SOURCES: Source[] = [
  {
    id: 'eastman-burgess-2009',
    citation:
      'Eastman CI, Burgess HJ (2009). How To Travel the World Without Jet lag. Sleep Med Clin 4(2):241–255.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2829880/',
    basis:
      'The core protocol: CBTmin-anchored light timing, pre-flight 1h/day sleep shifting, ~1h/day advance and ~1.5h/day delay rates (their worked-example rates; they quote 1.5/2 as upper bounds), 0.5 mg melatonin ~5h before bedtime for advances only.',
  },
  {
    id: 'roach-sargent-2019',
    citation:
      'Roach GD, Sargent C (2019). Interventions to Minimize Jet Lag After Westward and Eastward Flight. Front Physiol 10:927.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6684967/',
    basis:
      'Post-flight sleep strategy: sleep on the destination schedule rather than easing it over gradually. We use a capped version — bedtime snaps to local time but never further than a configurable few hours from the habitual bedtime, then CBTmin catches up.',
  },
  {
    id: 'youngstedt-2019',
    citation:
      'Youngstedt SD, Elliott JA, Kripke DF (2019). Human circadian phase–response curves for exercise. J Physiol 597(8):2253–2268.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6462487/',
    basis:
      'Exercise timing: morning exercise phase-advances; evening (~7–10 pm) exercise phase-delays.',
  },
  {
    id: 'eastman-2015',
    citation:
      'Eastman CI et al. (2015). Circadian rhythm phase shifts after a 9-h advance differ between individuals. Sci Rep 5:8381.',
    url: 'https://www.nature.com/articles/srep08381',
    basis:
      'On large advances, a substantial fraction of clocks delay instead (antidromic re-entrainment) — why 8–11h eastward trips offer an explicit advance-or-delay choice, defaulting to delay.',
  },
  {
    id: 'cdc-yellow-book',
    citation: 'CDC Yellow Book: Jet Lag Disorder.',
    url: 'https://www.cdc.gov/yellow-book/hcp/travel-air-sea/jet-lag-disorder.html',
    basis:
      'Jet lag typically follows crossing at least two time zones — the threshold behind the "days of discomfort" estimate in the briefing.',
  },
  {
    id: 'wehrens-2017',
    citation:
      'Wehrens SMT et al. (2017). Meal Timing Regulates the Human Circadian System. Curr Biol 27(12):1768–1775.',
    url: 'https://www.cell.com/current-biology/fulltext/S0960-9822(17)30504-3',
    basis:
      'Meal timing shifts peripheral (metabolic) clocks without moving the central clock — the reason to eat on the destination schedule.',
  },
]
