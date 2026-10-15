/**
 * Sunrise/sunset from coordinates, via the standard NOAA-style sunrise
 * equation (see https://en.wikipedia.org/wiki/Sunrise_equation). Accuracy is
 * a couple of minutes, which is far inside what light-timing advice needs.
 *
 * Pure functions, no dependencies.
 */

import { DateTime } from 'luxon'

const DEG = Math.PI / 180

export interface SunTimes {
  /** Null during polar night (no sunrise that day). */
  sunrise: Date | null
  /** Null during polar night. */
  sunset: Date | null
  /** Set when the sun never rises or never sets on that date. */
  polar: 'day' | 'night' | null
}

/**
 * Sun times for the civil date (y, m, d) at a location. Longitude is east-
 * positive; the returned Dates are absolute instants.
 */
export function sunTimesForDate(
  year: number,
  month: number,
  day: number,
  lat: number,
  lon: number,
): SunTimes {
  // Days since the J2000 epoch (noon UTC, 1 Jan 2000) for this civil date.
  const jd00 = Date.UTC(year, month - 1, day) / 86400000 + 2440587.5
  const n = Math.round(jd00 - 2451545.0 + 0.5)

  // Mean solar time at this longitude, then the usual chain: solar mean
  // anomaly, equation of the centre, ecliptic longitude, solar transit.
  const jStar = n + 0.0008 - lon / 360
  const M = ((357.5291 + 0.98560028 * jStar) % 360 + 360) % 360
  const C = 1.9148 * Math.sin(M * DEG) + 0.02 * Math.sin(2 * M * DEG) + 0.0003 * Math.sin(3 * M * DEG)
  const lambda = ((M + C + 180 + 102.9372) % 360 + 360) % 360
  const jTransit =
    2451545.0 + jStar + 0.0053 * Math.sin(M * DEG) - 0.0069 * Math.sin(2 * lambda * DEG)

  // Declination, then the hour angle for the standard -0.833° altitude
  // (geometric horizon corrected for refraction and solar radius).
  const sinDecl = Math.sin(lambda * DEG) * Math.sin(23.4397 * DEG)
  const cosDecl = Math.cos(Math.asin(sinDecl))
  const cosOmega =
    (Math.sin(-0.833 * DEG) - Math.sin(lat * DEG) * sinDecl) / (Math.cos(lat * DEG) * cosDecl)

  if (cosOmega > 1) return { sunrise: null, sunset: null, polar: 'night' }
  if (cosOmega < -1) {
    // Midnight sun: report the full civil day as daylight.
    return {
      sunrise: new Date(Date.UTC(year, month - 1, day)),
      sunset: new Date(Date.UTC(year, month - 1, day) + 86400000),
      polar: 'day',
    }
  }

  const omega = Math.acos(cosOmega) / DEG
  const toDate = (j: number) => new Date((j - 2440587.5) * 86400000)
  return {
    sunrise: toDate(jTransit - omega / 360),
    sunset: toDate(jTransit + omega / 360),
    polar: null,
  }
}

/**
 * Sun times for the civil date that `at` falls on in `zone`. This is the
 * form the chart needs: "what does daylight look like where I am today".
 */
export function sunTimesAt(at: Date, zone: string, lat: number, lon: number): SunTimes {
  const local = DateTime.fromJSDate(at, { zone })
  return sunTimesForDate(local.year, local.month, local.day, lat, lon)
}
