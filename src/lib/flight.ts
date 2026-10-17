/**
 * Turning a ticket-style itinerary into instants, and estimating one when
 * the traveler hasn't got a ticket yet. Pure functions, no DOM, so the
 * corner cases (date line, overnight arrivals, DST days) can be tested in
 * a terminal.
 */

import { DateTime } from 'luxon'

export interface ResolvedFlight {
  departUtc: Date
  arriveUtc: Date
  /** Arrival wall-clock at the destination, for display. */
  arriveLocal: DateTime
}

export type FlightResolution = ResolvedFlight | { error: string }

/**
 * Resolve the itinerary the way a ticket states it: departure date and time
 * local to the origin, arrival date and time local to the destination.
 */
export function resolveFlight(
  departDate: string,
  departTimeLocal: string,
  originZone: string,
  arriveDate: string,
  arriveTimeLocal: string,
  destinationZone: string,
): FlightResolution {
  if (!departDate || !departTimeLocal) {
    return { error: 'Enter the departure date and time.' }
  }
  if (!arriveDate || !arriveTimeLocal) {
    return { error: 'Enter the arrival date and time.' }
  }
  const depart = DateTime.fromISO(`${departDate}T${departTimeLocal}`, { zone: originZone })
  if (!depart.isValid) return { error: 'Departure date or time is not valid.' }
  const arrive = DateTime.fromISO(`${arriveDate}T${arriveTimeLocal}`, { zone: destinationZone })
  if (!arrive.isValid) return { error: 'Arrival date or time is not valid.' }
  if (arrive <= depart) {
    return { error: 'Arrival must be after departure (check the local dates and time zones).' }
  }
  return { departUtc: depart.toJSDate(), arriveUtc: arrive.toJSDate(), arriveLocal: arrive }
}

/** Great-circle distance in km between two lat/lon points (degrees). */
export function greatCircleKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Typical gate-to-gate hours for a direct flight: a fixed allowance for
 * taxi, climb and descent plus cruise at an average ground speed. Routing
 * detours and winds aside, this lands within about half an hour of
 * published block times on most routes (LAX-PEK ~13h, JFK-LAX ~6h).
 */
export function estimateFlightHours(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const km = greatCircleKm(a, b)
  if (km < 1) return 0
  return 0.75 + km / 800
}

/**
 * Estimated arrival (destination-local date and time, rounded to 5 min) for
 * a direct flight leaving at the given origin-local date and time. Null when
 * the departure is incomplete or invalid.
 */
export function estimateArrival(
  departDate: string,
  departTimeLocal: string,
  origin: { lat: number; lon: number; tz: string },
  destination: { lat: number; lon: number; tz: string },
): { date: string; time: string } | null {
  if (!departDate || !departTimeLocal) return null
  const depart = DateTime.fromISO(`${departDate}T${departTimeLocal}`, { zone: origin.tz })
  if (!depart.isValid) return null
  const minutes = Math.round((estimateFlightHours(origin, destination) * 60) / 5) * 5
  const arrive = depart.plus({ minutes }).setZone(destination.tz)
  return { date: arrive.toISODate()!, time: arrive.toFormat('HH:mm') }
}
