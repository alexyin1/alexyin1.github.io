import { describe, expect, it } from 'vitest'
import {
  autoColon,
  clockDigits,
  formatClockText,
  meridiemOf,
  parseClockText,
  withMeridiem,
} from './clocktext'

describe('formatClockText', () => {
  it('renders 24h values unchanged, zero-padded', () => {
    expect(formatClockText('13:00', '24h')).toBe('13:00')
    expect(formatClockText('7:05', '24h')).toBe('07:05')
  })

  it('renders 12h values with a meridiem, using 12 for noon and midnight', () => {
    expect(formatClockText('13:00', '12h')).toBe('1:00 PM')
    expect(formatClockText('07:05', '12h')).toBe('7:05 AM')
    expect(formatClockText('00:30', '12h')).toBe('12:30 AM')
    expect(formatClockText('12:00', '12h')).toBe('12:00 PM')
    expect(formatClockText('23:59', '12h')).toBe('11:59 PM')
  })

  it('passes through text it cannot read', () => {
    expect(formatClockText('', '12h')).toBe('')
    expect(formatClockText('25:00', '12h')).toBe('25:00')
  })
})

describe('parseClockText', () => {
  it('reads 24h and 12h spellings', () => {
    expect(parseClockText('13:00')).toBe('13:00')
    expect(parseClockText('1:00 pm')).toBe('13:00')
    expect(parseClockText('1 PM')).toBe('13:00')
    expect(parseClockText('7:05am')).toBe('07:05')
    expect(parseClockText('0930')).toBe('09:30')
    expect(parseClockText(' 23:30 ')).toBe('23:30')
  })

  it('maps 12 AM to midnight and 12 PM to noon', () => {
    expect(parseClockText('12:00 am')).toBe('00:00')
    expect(parseClockText('12:00 pm')).toBe('12:00')
  })

  it('reads a trailing colon as a whole hour', () => {
    expect(parseClockText('9:')).toBe('09:00')
    expect(parseClockText('11:')).toBe('11:00')
    expect(parseClockText('9:3')).toBeNull()
  })

  it('rejects nonsense', () => {
    expect(parseClockText('')).toBeNull()
    expect(parseClockText('25:00')).toBeNull()
    expect(parseClockText('10:75')).toBeNull()
    expect(parseClockText('14:00 pm')).toBeNull()
    expect(parseClockText('lunchtime')).toBeNull()
  })
})

describe('clockDigits and meridiem helpers', () => {
  it('splits a 12h time into digits and a meridiem', () => {
    expect(clockDigits('13:05', '12h')).toBe('1:05')
    expect(clockDigits('00:30', '12h')).toBe('12:30')
    expect(clockDigits('13:05', '24h')).toBe('13:05')
    expect(meridiemOf('13:05')).toBe('PM')
    expect(meridiemOf('00:30')).toBe('AM')
    expect(meridiemOf('12:00')).toBe('PM')
  })

  it('moves a clock-face time to the other half of the day', () => {
    expect(withMeridiem('01:00', 'PM')).toBe('13:00')
    expect(withMeridiem('13:00', 'AM')).toBe('01:00')
    expect(withMeridiem('12:30', 'AM')).toBe('00:30')
    expect(withMeridiem('00:30', 'PM')).toBe('12:30')
    expect(withMeridiem('09:15', 'AM')).toBe('09:15')
  })
})

describe('autoColon', () => {
  it('adds the colon once the hour is unambiguous', () => {
    expect(autoColon('9', '', '12h')).toBe('9:')
    expect(autoColon('1', '', '12h')).toBe('1')
    expect(autoColon('11', '1', '12h')).toBe('11:')
    expect(autoColon('13', '1', '12h')).toBe('1:3')
    expect(autoColon('2', '', '24h')).toBe('2')
    expect(autoColon('3', '', '24h')).toBe('3:')
    expect(autoColon('23', '2', '24h')).toBe('23:')
    expect(autoColon('24', '2', '24h')).toBe('2:4')
  })

  it('leaves deletions, replacements and anything past the hour alone', () => {
    expect(autoColon('11', '11:', '12h')).toBe('11')
    expect(autoColon('9', '11:00', '12h')).toBe('9')
    expect(autoColon('9:3', '9:', '12h')).toBe('9:3')
    expect(autoColon('0930', '', '24h')).toBe('0930')
  })
})
