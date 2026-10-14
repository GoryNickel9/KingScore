import { describe, expect, it } from 'vitest'
import { preparePlaySave, type PlaySavePayload } from './playSaveRequests'

const actor = '00000000-0000-0000-0000-000000000001'
const request = '00000000-0000-0000-0000-000000000002'
const play = '00000000-0000-0000-0000-000000000003'
const payload = (): PlaySavePayload => ({
  game_id: '00000000-0000-0000-0000-000000000004', played_at: '2026-10-14',
  duration_minutes: 0, source: 'offline', notes: 'Prova 😀', is_cooperative: false, team_won: null,
  scores: [{ id: null, player_id: actor, score: '9007199254740993.125', winner: false, color: null, role: null }],
})
const create = (input: PlaySavePayload) => preparePlaySave(actor, 'create_play_v1', { p_request_id: request, p_payload: input })

describe('immutable V1 play requests', () => {
  it('keeps exact decimal text, negative scores, null and zero distinct', () => {
    for (const score of ['9007199254740993.125', '-12.500', '0', null]) {
      const input = payload(); input.scores[0].score = score
      const prepared = create(input)
      expect(JSON.parse(prepared.body).p_payload.scores[0].score).toBe(score)
      expect(JSON.parse(prepared.body).p_payload.duration_minutes).toBe(0)
    }
  })
  it('retains the original UUID/body despite edits to the form or a returned argument object', () => {
    const input = payload(); const prepared = create(input)
    const original = prepared.body
    input.scores[0].score = '1'; input.notes = 'Changed'
    const args = prepared.arguments(); args.p_request_id = play
    const returnedPayload = args.p_payload as PlaySavePayload
    returnedPayload.scores[0].score = '2'
    expect(prepared.body).toBe(original)
    expect(prepared.arguments()).toEqual(JSON.parse(original))
    expect(prepared.requestId).toBe(request)
    expect(Object.isFrozen(prepared)).toBe(true)
  })
  it('preserves score IDs, color and role on update', () => {
    const input = payload(); input.scores[0] = { ...input.scores[0], id: request, color: '#123456', role: 'Team A' }
    const prepared = preparePlaySave(actor, 'update_play_v1', {
      p_request_id: request, p_play_id: play, p_expected_revision: 'opaque-revision', p_payload: input,
    })
    expect(JSON.parse(prepared.body).p_payload.scores[0]).toEqual(input.scores[0])
    expect(prepared.playId).toBe(play)
  })
  it('prepares read and revision-checked delete without adding a payload', () => {
    expect(preparePlaySave(actor, 'get_play_editor_v1', { p_play_id: play }).requestId).toBeNull()
    const args = { p_request_id: request, p_play_id: play, p_expected_revision: 'revision' }
    expect(preparePlaySave(actor, 'delete_play_v1', args).arguments()).toEqual(args)
  })
  it('preserves explicit BGA positions and metadata, rejects omitted participants', () => {
    const args = { p_request_id: request, p_payload: payload(), p_metadata: { location: 'BGA', bga_table_id: '12345' }, p_positions: [null] }
    expect(preparePlaySave(actor, 'import_bga_play_v1', args).arguments()).toEqual(args)
    expect(() => preparePlaySave(actor, 'import_bga_play_v1', { ...args, p_positions: [] })).toThrow('external positions')
  })
  it.each(['1e3', 'NaN', '01', '1,2', '1' + '0'.repeat(309), '0.' + '0'.repeat(400) + '1'])('rejects invalid or unrankable score %s', score => {
    const input = payload(); input.scores[0].score = score
    expect(() => create(input)).toThrow()
  })
  it('rejects duplicate participants and score IDs regardless of UUID casing', () => {
    const input = payload(); input.scores.push({ ...input.scores[0] })
    expect(() => create(input)).toThrow('unique player_id')
    input.scores[0].id = request; input.scores[1].id = request
    input.scores[1].player_id = play
    expect(() => preparePlaySave(actor, 'update_play_v1', { p_request_id: request, p_play_id: play, p_expected_revision: 'v1', p_payload: input })).toThrow('unique score.id')
  })
  it('rejects invalid date, numeric wire score, foreign fields and unsafe text', () => {
    const invalid = [
      { ...payload(), played_at: '2026-02-30' },
      { ...payload(), owner_id: actor },
      { ...payload(), notes: '\ud800' },
      { ...payload(), notes: 'nul\0byte' },
      { ...payload(), scores: [{ ...payload().scores[0], score: 3 }] },
    ]
    for (const input of invalid) expect(() => create(input as PlaySavePayload)).toThrow()
  })
  it('rejects new score IDs on creation and inconsistent cooperative winners', () => {
    const input = payload(); input.scores[0].id = request
    expect(() => create(input)).toThrow('create score.id')
    input.scores[0].id = null; input.is_cooperative = true; input.team_won = true
    expect(() => create(input)).toThrow('cooperative winner')
  })
  it('checks UTF-8 jsonb size rather than string length', () => {
    const input = payload(); input.notes = '😀'.repeat(270_000)
    expect(() => create(input)).toThrow('payload bytes')
  })
  it('rejects missing revision, invalid actor and unsupported operations', () => {
    expect(() => preparePlaySave(actor, 'delete_play_v1', { p_request_id: request, p_play_id: play })).toThrow('arguments fields')
    expect(() => preparePlaySave('not-a-uuid', 'get_play_editor_v1', { p_play_id: play })).toThrow('actorId')
    expect(() => preparePlaySave(actor, 'replace_play_scores' as never, {})).toThrow('RPC name')
  })
})
