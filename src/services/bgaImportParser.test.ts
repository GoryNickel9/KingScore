import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseLines, resolvePlayerString, type ParsedPlay } from './bgaImportParser'
import { preparePlaySave } from './playSaveRequests'

const actor = '00000000-0000-0000-0000-000000000001'
const game = '00000000-0000-0000-0000-000000000002'
const source = (date = '15/10/2026 alle ore 00:05', duration = '42 mn', players = ['1° Nick9 9007199254740993.125', '2° Anna -0.25']) =>
  ['Storico delle partite', 'Game', '#000123', date, duration, ...players, '→ Risultati', 'Visualizza di più'].join('\n')

function prepare(parsed: ParsedPlay) {
  return preparePlaySave(actor, 'import_bga_play_v1', { p_request_id: actor, p_payload: {
    game_id: game, played_at: parsed.played_at, duration_minutes: parsed.duration_minutes,
    source: 'offline', notes: null, is_cooperative: false, team_won: null,
    scores: parsed.rawPlayers.map((player, index) => ({
      id: null, player_id: `00000000-0000-0000-0000-${String(index + 10).padStart(12, '0')}`,
      score: resolvePlayerString(player.raw, ['Nick9', 'Anna']).score, winner: player.winner, color: null, role: null,
    })),
  }, p_metadata: { bga_table_id: parsed.bga_table_id, location: parsed.location },
  p_positions: parsed.rawPlayers.map(player => Number(player.position)) })
}
afterEach(() => { vi.unstubAllEnvs() })

describe('BGA text parser', () => {
  it('preserves an exact large decimal from pasted text through resolution and the serialized RPC request', () => {
    const parsed = parseLines(source())
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ game_name: 'Game', bga_table_id: '#000123', played_at: '2026-10-15', duration_minutes: 42 })
    const resolved = resolvePlayerString(parsed[0].rawPlayers[0].raw, ['Nick9', 'Anna'])
    expect(resolved).toEqual({ name: 'Nick9', score: '9007199254740993.125', autoResolved: true, similarityScore: 1 })
    const request = prepare(parsed[0])
    expect(request.body).toContain('"score":"9007199254740993.125"')
    expect(request.body).toContain('"score":"-0.25"')
    expect(request.arguments()).toMatchObject({ p_metadata: { bga_table_id: '#000123', location: null }, p_positions: [1, 2] })
  })

  it.each([
    ['Anna 0', '0'], ['Anna -0', '-0'], ['Anna 0.00', '0.00'], ['Anna -42', '-42'],
    ['Anna -0.000000000000000001', '-0.000000000000000001'], ['Anna 12.34567890123456789', '12.34567890123456789'],
  ])('keeps the exact score in %s', (raw, score) => {
    expect(resolvePlayerString(raw, ['Anna'])).toMatchObject({ name: 'Anna', score, autoResolved: true })
  })

  it('keeps a missing score null and never invents zero', () => {
    expect(resolvePlayerString('Anna', ['Anna'])).toEqual({ name: 'Anna', score: null, autoResolved: false, similarityScore: 1 })
    expect(resolvePlayerString('Unlisted Player', [])).toEqual({ name: 'Unlisted Player', score: null, autoResolved: false, similarityScore: 0 })
    const request = prepare(parseLines(source(undefined, undefined, ['1° Anna']))[0])
    expect(request.body).toContain('"score":null')
  })

  it('resolves a known name containing digits with and without a separator', () => {
    expect(resolvePlayerString('Nick912', ['Nick9'])).toMatchObject({ name: 'Nick9', score: '12', autoResolved: true })
    expect(resolvePlayerString('Nick9 -0.25', ['Nick9'])).toMatchObject({ name: 'Nick9', score: '-0.25', autoResolved: true })
    expect(resolvePlayerString('nick912', ['Nick9'])).toMatchObject({ name: 'Nick9', score: '12', autoResolved: true })
  })

  it('requires disambiguation when two known numeric prefixes fit the same input', () => {
    for (const names of [['Nick', 'Nick9'], ['Nick9', 'Nick']]) {
      expect(resolvePlayerString('Nick912', names)).toMatchObject({ name: 'Nick9', score: '12', autoResolved: false })
    }
    expect(resolvePlayerString('Nick9', ['Nick', 'Nick9'])).toMatchObject({ name: 'Nick9', score: null, autoResolved: false })
    expect(resolvePlayerString('Unlisted915', [])).toMatchObject({ autoResolved: false })
  })

  it('does not auto-resolve an invalid score suffix through a fuzzy name match', () => {
    expect(resolvePlayerString('VeryLongKnownPlayerNamee3', ['VeryLongKnownPlayerName']).autoResolved).toBe(false)
    expect(resolvePlayerString('Anna .25', ['Anna']).autoResolved).toBe(false)
  })

  it('keeps the existing fuzzy suggestion for a genuinely misspelled name', () => {
    expect(resolvePlayerString('Alexandre 12.5', ['Alexander'])).toMatchObject({ name: 'Alexander', score: '12.5', autoResolved: false })
    expect(resolvePlayerString('LongPlayerNam 12.5', ['LongPlayerName'])).toMatchObject({ name: 'LongPlayerName', score: '12.5', autoResolved: true })
  })

  it.each(['Europe/Rome', 'Pacific/Kiritimati', 'America/Los_Angeles'])('keeps a written calendar day at midnight independently of UTC (%s)', timezone => {
    vi.stubEnv('TZ', timezone)
    expect(parseLines(source('1/1/2026 alle ore 00:05'))[0].played_at).toBe('2026-01-01')
    expect(parseLines(source('31/12/2026 alle ore 23:59'))[0].played_at).toBe('2026-12-31')
  })

  it('computes oggi and ieri from the injected local day across month/year boundaries', () => {
    vi.stubEnv('TZ', 'Pacific/Kiritimati')
    const now = new Date('2025-12-31T10:30:00Z')
    expect(now.getFullYear()).toBe(2026)
    expect(parseLines(source('oggi alle ore 00:05'), now)[0].played_at).toBe('2026-01-01')
    expect(parseLines(source('ieri alle ore 23:59'), now)[0].played_at).toBe('2025-12-31')
  })

  it('computes ieri across the local daylight-saving transition without converting through UTC', () => {
    vi.stubEnv('TZ', 'Europe/Rome')
    const now = new Date('2026-03-29T22:30:00Z')
    expect(parseLines(source('ieri alle ore 00:05'), now)[0].played_at).toBe('2026-03-29')
  })

  it.each(['31/2/2026 alle ore 12:00', '29/2/1900 alle ore 12:00', '1/13/2026 alle ore 12:00',
    '1/1/0000 alle ore 12:00', '1/1/10000 alle ore 12:00', '15/10/2026 alle ore 25:00',
    'domani alle ore 12:00'])('does not normalize invalid dates into an accepted mutation: %s', date => {
    const parsed = parseLines(source(date))[0]
    expect(() => prepare(parsed)).toThrow()
  })

  it('accepts a leap day without changing the calendar date', () => {
    const parsed = parseLines(source('29/2/2024 alle ore 00:05'))[0]
    expect(parsed.played_at).toBe('2024-02-29')
    expect(() => prepare(parsed)).not.toThrow()
  })

  it.each(['-42 mn', '1.5 mn', '1,5 mn', '2147483648 mn', 'unknown mn'])('keeps an invalid supplied duration out of the mutation contract (%s)', duration => {
    expect(() => prepare(parseLines(source(undefined, duration))[0])).toThrow()
  })

  it('keeps zero duration, missing duration, ties and external positions', () => {
    const parsed = parseLines(source(undefined, '0 mn', ['1° Nick9 0', '1° Anna 0', '5° Third -1']))[0]
    expect(parsed.duration_minutes).toBe(0)
    expect(parsed.rawPlayers.map(player => ({ position: player.position, winner: player.winner }))).toEqual([
      { position: '1', winner: true }, { position: '1', winner: true }, { position: '5', winner: false },
    ])
    expect(prepare(parsed).arguments().p_positions).toEqual([1, 1, 5])
    const withoutDuration = source().replace('42 mn\n', '')
    expect(parseLines(withoutDuration)[0].duration_minutes).toBeNull()
    expect(() => prepare(parseLines(withoutDuration)[0])).not.toThrow()
  })

  it('rejects an invalid zero position in the mutation contract', () => {
    expect(() => prepare(parseLines(source(undefined, undefined, ['0° Anna 5']))[0])).toThrow()
  })

  it('keeps an empty participant row for disambiguation instead of silently dropping it and later rows', () => {
    const parsed = parseLines(source(undefined, undefined, ['1° Nick9 10', '2°', '3° Anna 0']))[0]
    expect(parsed.rawPlayers).toHaveLength(3)
    expect(parsed.rawPlayers[1]).toEqual({ position: '2', raw: '', winner: false })
    expect(resolvePlayerString(parsed.rawPlayers[1].raw, ['Nick9', 'Anna'])).toMatchObject({ name: '', score: null, autoResolved: false })
    expect(parsed.rawPlayers[2].raw).toBe('Anna 0')
  })

  it('parses multiple plays and CRLF while preserving every player row', () => {
    const text = `${source()}\n${source('16/10/2026 alle ore 12:00').replace('#000123', '#000124')}`.replace(/\n/g, '\r\n')
    const plays = parseLines(text)
    expect(plays.map(play => play.bga_table_id)).toEqual(['#000123', '#000124'])
    expect(plays.map(play => play.rawPlayers.length)).toEqual([2, 2])
  })
})
