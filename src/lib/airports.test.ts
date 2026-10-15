import { beforeAll, describe, expect, it } from 'vitest'
import {
  type Airport,
  airportLabel,
  byIata,
  loadAirports,
  resolveAirport,
  searchAirports,
} from './airports'

let airports: Airport[]
beforeAll(async () => {
  airports = await loadAirports()
})

describe('dataset', () => {
  it('contains the majors with sane fields', () => {
    for (const code of ['LAX', 'PEK', 'JFK', 'LHR', 'NRT', 'SYD', 'DXB', 'BOM']) {
      const a = byIata(airports, code)
      expect(a, code).toBeDefined()
      expect(Math.abs(a!.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(a!.lon)).toBeLessThanOrEqual(180)
      expect(a!.tz).toMatch(/^[A-Za-z_]+\//)
      expect(a!.city.length).toBeGreaterThan(0)
    }
    expect(byIata(airports, 'LAX')!.tz).toBe('America/Los_Angeles')
    expect(byIata(airports, 'PEK')!.tz).toBe('Asia/Shanghai')
  })

  it('has no duplicate IATA codes', () => {
    expect(new Set(airports.map((a) => a.iata)).size).toBe(airports.length)
  })

  it('is a few thousand airports, not accidentally truncated or exploded', () => {
    expect(airports.length).toBeGreaterThan(5000)
    expect(airports.length).toBeLessThan(12000)
  })
})

describe('searchAirports', () => {
  it('puts an exact IATA match first', () => {
    expect(searchAirports(airports, 'lax')[0].iata).toBe('LAX')
    expect(searchAirports(airports, 'PEK')[0].iata).toBe('PEK')
  })

  it('finds airports by city name', () => {
    const beijing = searchAirports(airports, 'beijing')
    expect(beijing.map((a) => a.iata)).toContain('PEK')
    const la = searchAirports(airports, 'los angeles')
    expect(la.map((a) => a.iata)).toContain('LAX')
  })

  it('finds airports by airport name', () => {
    const heathrow = searchAirports(airports, 'heathrow')
    expect(heathrow[0].iata).toBe('LHR')
  })

  it('returns nothing for sub-2-character queries', () => {
    expect(searchAirports(airports, 'l')).toEqual([])
    expect(searchAirports(airports, ' ')).toEqual([])
  })
})

describe('resolveAirport', () => {
  it('resolves bare IATA codes and suggestion labels', () => {
    expect(resolveAirport(airports, 'pek')?.iata).toBe('PEK')
    const lax = byIata(airports, 'LAX')!
    expect(resolveAirport(airports, airportLabel(lax))?.iata).toBe('LAX')
  })

  it('falls back to best search match for free text', () => {
    expect(resolveAirport(airports, 'Heathrow')?.iata).toBe('LHR')
  })

  it('returns undefined for empty or hopeless input', () => {
    expect(resolveAirport(airports, '')).toBeUndefined()
    expect(resolveAirport(airports, 'zzzzqqqq')).toBeUndefined()
  })
})
