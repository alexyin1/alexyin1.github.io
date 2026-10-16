# alexyin1.github.io

A free jet lag adaptation planner. Give it a flight and your usual sleep
schedule, and it produces a day-by-day plan for when to seek and avoid bright
light, sleep, take melatonin and caffeine, exercise, and eat.

Entirely static — all computation runs in the browser. No backend, no accounts.

## Development

```bash
npm install
npm run dev          # http://localhost:5173, hot reload
npm run dev -- --host # also reachable from your phone on the same network
npm test             # run the model tests
npm run test:watch   # re-run on save
npm run build        # typecheck + production build into dist/
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which tests, builds,
and publishes `dist/` to GitHub Pages. Repo Settings → Pages → Source must be
set to **GitHub Actions** (not "deploy from a branch").

`base` in `vite.config.ts` is `/`, which is correct for a `<user>.github.io`
site served from the domain root.

## Layout

- `src/lib/circadian.ts` — the model. Pure functions, no DOM or React imports,
  so it can be tested and reasoned about on its own.
- `src/lib/briefing.ts` — the trip briefing prose, derived from a `Plan`.
  Separate from the model so copy can be edited for editorial reasons without
  touching the science, and so it can't drift from the schedule it describes.
- `src/lib/*.test.ts` — tests, including the phase-response sign conventions
  and DST handling.
- `src/lib/airports.ts` + `src/data/airports.json` — IATA/city lookup
  (~7,900 airports with coordinates and IANA zone, from mwgg/Airports, MIT),
  lazy-loaded as its own chunk.
- `src/lib/sun.ts` — sunrise/sunset from coordinates (NOAA-style sunrise
  equation), used for the chart's day/night strips.
- `src/App.tsx` — origin/destination airport pickers are live; flight times
  and habitual sleep are still demo values pending the full trip form.

## How the model works

The planner implements the practical protocol of **Eastman & Burgess (2009),
"How To Travel the World Without Jet lag"** — see SCIENCE.md for the full
recommendation-to-source mapping, including which numbers are our own choices.

It simulates a single phase marker, CBTmin (core body temperature minimum),
estimated at ~3.5h before habitual wake time (E&B: 3-4.5h). Every
recommendation is positioned relative to wherever CBTmin currently sits, and
CBTmin steps by a fixed amount each day until it matches the destination.

The sign conventions that matter:

- **Advance** = clock moves earlier = eastward. **Delay** = later = westward.
- Light **after** CBTmin advances the clock; light **before** it delays.
- After arrival, advances run ~1.5h/day and delays ~2h/day (E&B planning
  rates), so a large eastward shift is sometimes faster handled as a westward
  delay. `computeShift` picks whichever direction finishes sooner.
- Before arrival the traveler is still on home time, so shifting is capped at
  1h/day and 3h in total; the remainder waits until landing, where local
  daylight and meal times help.
- Sleep tracks CBTmin for the whole plan, so the recommended schedule moves
  at exactly the day's shift rate and lands on the habitual local bedtime
  when CBTmin reaches its destination-aligned target.
- Shift rates switch at *departure*, not arrival: the gentle 1h/day pace and
  its 3h cap apply only to nights genuinely spent at home.

Tunable parameters live in `PARAMS` at the top of `circadian.ts`.

## Status

Core parameters now follow Eastman & Burgess (2009), with exercise timing from
Youngstedt et al. (2019) and meal-timing rationale from Wehrens et al. (2017);
SCIENCE.md is the source of truth for what traces where. Info-page prose is
still to come.

**Not medical advice.**

## License

MIT
