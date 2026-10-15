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
      'The core protocol: Tmin-anchored light timing, pre-flight 1h/day sleep shifting, ~1.5h/day advance and ~2h/day delay rates, 0.5 mg melatonin ~5h before bedtime for advances only.',
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
