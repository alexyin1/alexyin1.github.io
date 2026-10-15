/**
 * Airport lookup: resolve an IATA code or a city/airport name to coordinates
 * and an IANA timezone, which is everything the planner needs from geography.
 *
 * Data: mwgg/Airports (MIT), trimmed to the ~7900 airports that have an IATA
 * code, coordinates and a timezone. The JSON is an array of tuples to keep it
 * small, and is loaded lazily so it never blocks first paint.
 */

export interface Airport {
  iata: string
  name: string
  city: string
  country: string
  lat: number
  lon: number
  tz: string
}

type Row = [string, string, string, string, number, number, string]

let cache: Airport[] | null = null

export async function loadAirports(): Promise<Airport[]> {
  if (!cache) {
    const mod = await import('../data/airports.json')
    cache = (mod.default as Row[]).map(([iata, name, city, country, lat, lon, tz]) => ({
      iata, name, city, country, lat, lon, tz,
    }))
  }
  return cache
}

/** Resolve an exact IATA code, case-insensitive. */
export function byIata(airports: Airport[], code: string): Airport | undefined {
  const c = code.trim().toUpperCase()
  return airports.find((a) => a.iata === c)
}

/**
 * Rank airports against a free-text query: an exact IATA match wins, then
 * city prefix, name prefix, and substring matches. Within a rank, matches
 * sort alphabetically by city so results are stable.
 */
export function searchAirports(airports: Airport[], query: string, limit = 8): Airport[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const ranked: { a: Airport; rank: number }[] = []
  for (const a of airports) {
    const city = a.city.toLowerCase()
    const name = a.name.toLowerCase()
    let rank: number | null = null
    if (a.iata.toLowerCase() === q) rank = 0
    else if (city.startsWith(q)) rank = 1
    else if (name.startsWith(q)) rank = 2
    else if (city.includes(q)) rank = 3
    else if (name.includes(q)) rank = 4
    if (rank !== null) ranked.push({ a, rank })
  }
  ranked.sort(
    (x, y) =>
      x.rank - y.rank ||
      x.a.city.localeCompare(y.a.city) ||
      x.a.iata.localeCompare(y.a.iata),
  )
  return ranked.slice(0, limit).map((r) => r.a)
}

/** Display string used in suggestion lists; parseable back via leading IATA. */
export function airportLabel(a: Airport): string {
  const place = a.city && a.city !== a.name ? `${a.city} — ${a.name}` : a.name
  return `${a.iata} · ${place} (${a.country})`
}

/**
 * Resolve what the user left in the input: a bare IATA code, a suggestion
 * string produced by airportLabel, or a best search match.
 */
export function resolveAirport(airports: Airport[], input: string): Airport | undefined {
  const s = input.trim()
  if (!s) return undefined
  const leading = /^([A-Za-z]{3})\b/.exec(s)
  if (leading) {
    const hit = byIata(airports, leading[1])
    if (hit) return hit
  }
  return searchAirports(airports, s, 1)[0]
}
