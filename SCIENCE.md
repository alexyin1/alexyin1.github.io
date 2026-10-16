# Scientific basis

Every recommendation the planner makes should trace to a source or be
explicitly marked as our own design choice. This file is that mapping. If you
change a number in `src/lib/circadian.ts` `PARAMS` or a window in the emission
logic, update this file in the same commit.

## Primary source

**Eastman CI, Burgess HJ (2009). "How To Travel the World Without Jet lag."
Sleep Med Clin 4(2):241–255.**
[PMC2829880](https://pmc.ncbi.nlm.nih.gov/articles/PMC2829880/)

The planner is an implementation of this practical protocol: estimate the
body-temperature minimum (CBTmin), schedule bright light relative to it (light
after CBTmin advances the clock, light before it delays — the Khalsa et al. 2003
light PRC underlies this), pre-shift the sleep schedule before flying, and use
low-dose melatonin for advances.

## Recommendation → source

| Recommendation | Where in code | Source | Notes |
|---|---|---|---|
| CBTmin ≈ 3.5h before habitual wake | `PARAMS.cbtMinBeforeWakeHours` | E&B | E&B give 3–4.5h after a full night; we use the middle of the range. |
| Advance ≤ ~1.5h/day after arrival | `PARAMS.advanceHoursPerDay` | E&B | Their planning rate with well-timed light + melatonin. |
| Delay ≤ ~2h/day after arrival | `PARAMS.delayHoursPerDay` | E&B | Their planning rate with well-timed light. |
| Pre-flight: shift sleep 1h/day | `PARAMS.preTravelHoursPerDay` | E&B | Their pre-adaptation protocol. |
| Advance: bright light first ~3h after waking (pre-flight) | `plan()`, advance branch | E&B | "Maximize bright light in the first 3–4h after waking." |
| Advance, after arrival: dim until CBTmin passes, bright light after | `plan()`, landed advance branch | E&B / light PRC | Light before CBTmin would push the wrong way; window keyed to simulated CBTmin. |
| Delay: bright light last ~4h before bed (pre-flight) | `plan()`, delay branch | E&B | "Maximize bright light in the 3–4h before bedtime." |
| Delay, after arrival: bright light in the ~6h before tomorrow's CBTmin, dim in the ~6h after this morning's CBTmin | `plan()`, landed delay branch | E&B / light PRC | Keyed to simulated CBTmin, clipped to waking hours. |
| Melatonin 0.5 mg, ~5h before bedtime, advances only | `plan()`, advance branch | E&B; Revell et al. 2006 | 0.5 mg ≈ 3 mg in effect with fewer side effects. E&B include no melatonin in westward plans — no evidence it adds to well-timed light. |
| Morning exercise on advances | `plan()`, advance branch | Youngstedt et al. 2019 | Exercise PRC: ~7 am (and 1–4 pm) exercise advances. [PMC6462487](https://pmc.ncbi.nlm.nih.gov/articles/PMC6462487/) |
| Evening exercise on delays (bed−4h to bed−1h) | `plan()`, delay branch | Youngstedt et al. 2019 | Exercise PRC: ~7–10 pm exercise delays. |
| Eat on the destination schedule; first meal scheduled | `plan()` meal slot; briefing tip | Wehrens et al. 2017 | Meal timing shifts peripheral (metabolic) clocks without moving the central clock. [Curr Biol 27:1768](https://www.cell.com/current-biology/fulltext/S0960-9822(17)30504-3) |
| Direction choice: advance vs delay by fewest days | `computeShift()` | E&B (rates) | Mechanical consequence of the asymmetric rates; E&B likewise route large eastward shifts as delays. |
| "Days of jet lag discomfort" = days at the destination still >2h misaligned | `briefing()` | [CDC Yellow Book: Jet Lag Disorder](https://www.cdc.gov/yellow-book/hcp/travel-air-sea/jet-lag-disorder.html) | CDC: jet lag typically follows crossing at least two time zones; we apply the same 2h threshold to the shrinking misalignment. |

## Our design choices (not from the literature)

| Choice | Where in code | Rationale |
|---|---|---|
| Pre-flight shift capped at 3h total | `PARAMS.maxPreTravelShiftHours` | E&B describe 3–4 days of pre-shifting; we cap total displacement because shifting further while holding home work/family schedules rarely sticks. |
| ~2h of shift absorbed at the destination without preparation | `PARAMS.destinationFreeShiftHours` | Aligned with the CDC two-zone threshold: small misalignments resolve from destination cues alone, so pre-travel days are only scheduled for the hours beyond this (a 3h hop gets one pre-travel day, not three). Shifts of ≤2h get no plan at all (`needsPlan`). |
| Post-arrival sleep snaps to local schedule, eased by 2h/1h/0 | `PARAMS.arrivalEaseHours`, anchored-night logic | The snap follows E&B's post-arrival framing (sleep local, let light do the circadian work); the specific easing allowance is ours. |
| CBTmin stepping as fixed hours/day | `plan()` pass 1 | Simplification. The underlying PRC is dose- and phase-dependent; E&B's planning rates approximate it, and we inherit that approximation. |
| Plans truncated at 16 days | `PARAMS.maxPlanDays` | Practicality. |
| Dinner ≥3h before bed | briefing tip | General sleep hygiene, not re-entrainment evidence. |
| 8–12h eastward: traveler chooses advance vs delay, default delay | `strategyChoice()`, App toggle | Both routes round the clock are defensible in this band. Chronotype rule of thumb (night owls delay, early birds advance) is common clinical advice, not a trial result. |

## Deliberately excluded

- **Caffeine.** Negligible direct effect on circadian re-entrainment; it is
  general sleep hygiene, and advice here should trace to jet-lag evidence.
- **ODE / oscillator models and optimal light schedules** (e.g. Serkh & Forger
  2014, [PLoS Comput Biol](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003523)).
  Stronger in principle, but they assume the traveler's initial phase is known
  more precisely than a "when do you usually sleep" questionnaire can deliver.
  Candidate for a later phase.
- **Melatonin for delays.** Following E&B: no experimental evidence it adds
  anything to well-timed bright light on westward trips.
