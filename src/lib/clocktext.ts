/**
 * Wall-clock text for the form's time fields. The native <input type="time">
 * picks its own 12h/24h rendering from the browser locale and offers no way
 * to override it, so the form uses text inputs that honour the page's clock
 * toggle instead. Values are carried as 'HH:mm' throughout.
 */

import type { ClockFormat } from './circadian'

/** Render an 'HH:mm' value for display in the chosen clock format. */
export function formatClockText(hhmm: string, clock: ClockFormat): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return hhmm
  const h = Number(m[1])
  const min = m[2]
  if (h > 23 || Number(min) > 59) return hhmm
  if (clock === '24h') return `${String(h).padStart(2, '0')}:${min}`
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${min} ${suffix}`
}

/**
 * Parse what someone might type into a time field -- '13:00', '1:00 pm',
 * '1pm', '0930' -- into 'HH:mm'. Null when it is not a time (yet).
 */
export function parseClockText(text: string): string | null {
  const s = text.trim().toLowerCase().replace(/\./g, '')
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/.exec(s)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] === undefined ? 0 : Number(m[2])
  const ampm = m[3]
  if (min > 59) return null
  if (ampm) {
    // A bare '1430 pm' is a contradiction; only 1-12 take a meridiem.
    if (h < 1 || h > 12) return null
    if (ampm === 'am') h = h === 12 ? 0 : h
    else h = h === 12 ? 12 : h + 12
  } else if (h > 23) {
    return null
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}
