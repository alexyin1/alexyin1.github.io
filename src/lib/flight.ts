/**
 * Turning a ticket-style itinerary into instants. Pure functions, no DOM, so
 * the flight corner cases (date line, overnight arrivals, DST days, 24h+
 * flights) can be tested in a terminal.
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
 * are local to the origin, arrival time is local to the destination, and the
 * arrival *date* is derived -- the first moment after takeoff when the
 * destination clock reads the stated time. That makes overnight and
 * date-line crossings come out right without a separate "+1 day" control.
 * Known gap (deliberate, pending the corner-case pass): a flight genuinely
 * longer than 24h shares its arrival reading with a shorter one and resolves
 * to the shorter.
 */
export function resolveFlight(
  travelDate: string,
  departTimeLocal: string,
  originZone: string,
  arriveTimeLocal: string,
  destinationZone: string,
): FlightResolution {
  if (!travelDate || !departTimeLocal || !arriveTimeLocal) {
    return { error: 'Enter the travel day plus departure and arrival times.' }
  }
  const depart = DateTime.fromISO(`${travelDate}T${departTimeLocal}`, { zone: originZone })
  if (!depart.isValid) return { error: 'Departure date or time is not valid.' }
  // Earliest destination-local occurrence of the arrival time after takeoff.
  // Starting a day early covers big negative offsets (e.g. departing just
  // west of the date line, where the arrival local date precedes departure's).
  for (let d = -1; d <= 2; d++) {
    const candidate = DateTime.fromISO(`${travelDate}T${arriveTimeLocal}`, {
      zone: destinationZone,
    }).plus({ days: d })
    if (candidate.isValid && candidate > depart) {
      return {
        departUtc: depart.toJSDate(),
        arriveUtc: candidate.toJSDate(),
        arriveLocal: candidate,
      }
    }
  }
  return { error: 'Arrival time is not valid.' }
}
