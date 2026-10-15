import { describe, expect, it } from 'vitest'
import { playFormPayload, type PlayFormFields } from './playFormPayload'
import { preparePlaySave } from './playSaveRequests'
const actor = '00000000-0000-0000-0000-000000000001'
const form: PlayFormFields = { gameId: actor, playedAt: '2026-10-15', durationMinutes: '', source: 'offline', notes: '', isCooperative: false, teamWon: null }
const score = { id: null, player_id: actor, score: '9007199254740993.125', winner: false, color: 'rosso', role: 'leader' }
describe('web play form boundary', () => {
  it('preserves exact decimal strings and existing metadata, including zero and absent scores', () => {
    const payload = playFormPayload(form, [score])
    expect(payload.scores[0]).toEqual(score)
    const request = preparePlaySave(actor, 'create_play_v1', { p_request_id: actor, p_payload: payload })
    expect(request.body).toContain('9007199254740993.125')
    expect(playFormPayload(form, [{ ...score, score: '0' }]).scores[0].score).toBe('0')
    expect(playFormPayload(form, [{ ...score, score: null }]).scores[0].score).toBeNull()
  })
  it.each(['-1', '1.5', '12min', ' 5', '1e3', '01'])('rejects non-integer duration %s without truncating', durationMinutes => {
    expect(() => playFormPayload({ ...form, durationMinutes }, [score])).toThrow('durata')
  })
  it('normalizes only explicit cooperative results and leaves the input immutable', () => {
    expect(playFormPayload({ ...form, isCooperative: true, teamWon: true }, [score]).scores[0].winner).toBe(true)
    expect(score.winner).toBe(false)
    expect(playFormPayload({ ...form, durationMinutes: '0' }, [score]).duration_minutes).toBe(0)
  })
  it('leaves date, uniqueness and numeric bounds for full snapshot validation before writes', () => {
    for (const payload of [playFormPayload({ ...form, playedAt: '2026-02-30' }, [score]),
      playFormPayload({ ...form, durationMinutes: '2147483648' }, [score]), playFormPayload(form, [score, score]),
      playFormPayload(form, [{ ...score, score: '12invalid' }])]) {
      expect(() => preparePlaySave(actor, 'create_play_v1', { p_request_id: actor, p_payload: payload })).toThrow()
    }
  })
})
