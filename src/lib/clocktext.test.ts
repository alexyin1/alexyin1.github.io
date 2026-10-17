import { describe, expect, it } from 'vitest'
import { formatClockText, parseClockText } from './clocktext'

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

  it('rejects nonsense', () => {
    expect(parseClockText('')).toBeNull()
    expect(parseClockText('25:00')).toBeNull()
    expect(parseClockText('10:75')).toBeNull()
    expect(parseClockText('14:00 pm')).toBeNull()
    expect(parseClockText('lunchtime')).toBeNull()
  })
})
