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
 * The clock digits alone, for a field that shows AM/PM as a separate
 * control: '1:05' in 12h mode, '13:05' in 24h. Unreadable input passes
 * through, as in formatClockText.
 */
export function clockDigits(hhmm: string, clock: ClockFormat): string {
  return formatClockText(hhmm, clock).replace(/ [AP]M$/, '')
}

export type Meridiem = 'AM' | 'PM'

export function meridiemOf(hhmm: string): Meridiem {
  const h = Number(hhmm.split(':')[0])
  return h >= 12 ? 'PM' : 'AM'
}

/** The same clock-face time in the other half of the day, as 'HH:mm'. */
export function withMeridiem(hhmm: string, m: Meridiem): string {
  const [h, min] = hhmm.split(':')
  const h12 = Number(h) % 12
  return `${String(m === 'PM' ? h12 + 12 : h12).padStart(2, '0')}:${min}`
}

/**
 * Insert the colon as the hour is typed, so a numeric keypad with no ':'
 * key can still enter a time. Only acts while text is being added -- a
 * deletion or a replacement is left exactly as typed -- and only on a bare
 * digit or two: '9' becomes '9:' at once where no two-digit hour could
 * start with it, '11' becomes '11:', and '13' in 12h mode becomes '1:3'.
 */
export function autoColon(next: string, prev: string, clock: ClockFormat): string {
  if (next.length <= prev.length || !/^\d{1,2}$/.test(next)) return next
  if (next.length === 1) {
    const maxLead = clock === '12h' ? 1 : 2
    return Number(next) > maxLead ? `${next}:` : next
  }
  const maxHour = clock === '12h' ? 12 : 23
  return Number(next) <= maxHour ? `${next}:` : `${next[0]}:${next[1]}`
}

/**
 * Parse what someone might type into a time field -- '13:00', '1:00 pm',
 * '1pm', '0930' -- into 'HH:mm'. Null when it is not a time (yet). A
 * trailing colon left by autoColon reads as a whole hour.
 */
export function parseClockText(text: string): string | null {
  const s = text.trim().toLowerCase().replace(/\./g, '').replace(/:$/, '')
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
