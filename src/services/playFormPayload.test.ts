import { describe, expect, it } from 'vitest'
import { playFormPayload, type PlayFormFields } from './playFormPayload'
import { preparePlaySave } from './playSaveRequests'
const actor = '00000000-0000-0000-0000-000000000001'
const form: PlayFormFields = { gameId: actor, playedAt: '2026-10-15', durationMinutes: '30', source: 'offline', notes: '', isCooperative: false, teamWon: null }
const score = { id: null, player_id: actor, score: '9007199254740993.125', winner: true, color: 'rosso', role: 'leader' }
describe('web play form boundary', () => {
  it('preserves exact decimal strings and existing metadata, including zero and absent scores', () => {
    const payload = playFormPayload(form, [score])
    expect(payload.scores[0]).toEqual(score)
    const request = preparePlaySave(actor, 'create_play_v1', { p_request_id: actor, p_payload: payload })
    expect(request.body).toContain('9007199254740993.125')
    expect(playFormPayload(form, [{ ...score, score: '0' }]).scores[0].score).toBe('0')
    expect(playFormPayload(form, [{ ...score, score: null }]).scores[0].score).toBeNull()
  })
  it.each(['', ' ', '0', '-1', '1.5', '12min', '1e3', '2147483648'])('rejects invalid duration %s before preparing a save', durationMinutes => {
    expect(() => playFormPayload({ ...form, durationMinutes }, [score])).toThrow('durata')
  })
  it('normalizes only explicit cooperative results and leaves the input immutable', () => {
    const loser = { ...score, winner: false }
    expect(playFormPayload({ ...form, isCooperative: true, teamWon: true }, [loser]).scores[0].winner).toBe(true)
    expect(loser.winner).toBe(false)
    expect(playFormPayload({ ...form, durationMinutes: '1' }, [score]).duration_minutes).toBe(1)
  })
  it.each(['create_play_v1', 'update_play_v1'] as const)('blocks %s without a selected winner', rpc => {
    const scores = [{ ...score, winner: false }]
    expect(() => preparePlaySave(actor, rpc, {
      p_request_id: actor,
      ...(rpc === 'update_play_v1' ? { p_play_id: actor, p_expected_revision: 'v1' } : {}),
      p_payload: playFormPayload(form, scores),
    })).toThrow('Seleziona almeno un vincitore')
    expect(scores[0].winner).toBe(false)
  })
  it.each([1, 2])('accepts %i winners, including shared first places', count => {
    const scores = [score, { ...score, player_id: '00000000-0000-0000-0000-000000000002', winner: count === 2 }]
    const payload = playFormPayload(form, scores)
    expect(payload.scores.filter(s => s.winner)).toHaveLength(count)
    expect(() => preparePlaySave(actor, 'create_play_v1', { p_request_id: actor, p_payload: payload })).not.toThrow()
  })
  it('accepts cooperative defeats with no individual winner', () => {
    const payload = playFormPayload({ ...form, isCooperative: true, teamWon: false }, [score])
    expect(payload.scores[0].winner).toBe(false)
    expect(payload.team_won).toBe(false)
    expect(score.winner).toBe(true)
    expect(() => preparePlaySave(actor, 'create_play_v1', { p_request_id: actor, p_payload: payload })).not.toThrow()
  })
  it('requires an explicit cooperative result instead of saving an unknown outcome', () => {
    expect(() => playFormPayload({ ...form, isCooperative: true, teamWon: null }, [score]))
      .toThrow('Indica se il gruppo ha vinto o perso')
  })
  it('leaves date, uniqueness and numeric bounds for full snapshot validation before writes', () => {
    for (const payload of [playFormPayload({ ...form, playedAt: '2026-02-30' }, [score]),
      playFormPayload(form, [score, score]),
      playFormPayload(form, [{ ...score, score: '12invalid' }])]) {
      expect(() => preparePlaySave(actor, 'create_play_v1', { p_request_id: actor, p_payload: payload })).toThrow()
    }
  })
})
