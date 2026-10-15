import { describe, expect, it } from 'vitest'
import { MAX_PLAY_DURATION_MINUTES, parsePlayDuration } from './playDuration'

describe('durata obbligatoria della partita', () => {
  it.each(['', ' ', '0', '-1', '1.5', '30min', 'NaN', 'Infinity', '0x10', '2147483648'])
    ('rifiuta %j senza troncare o sostituire il valore', value => {
      expect(parsePlayDuration(value)).toBeNull()
    })

  it.each([
    ['1', 1],
    ['60', 60],
    [' 90 ', 90],
    ['2147483647', MAX_PLAY_DURATION_MINUTES],
  ] as const)('accetta %j come %i minuti', (value, minutes) => {
    expect(parsePlayDuration(value)).toBe(minutes)
  })
})
