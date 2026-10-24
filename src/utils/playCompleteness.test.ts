import { describe, expect, it } from 'vitest'
import { checkPlayCompleteness } from './playCompleteness'
import type { PlayCompletenessInput } from './playCompleteness'

const complete: PlayCompletenessInput = {
  duration_minutes: 30, is_cooperative: false, team_won: null,
  play_scores: [{ score: 1, winner: true }, { score: 0, winner: false }],
}

describe('controllo completezza partite', () => {
  it('accetta zero come punteggio e un esito con vincitore', () => {
    expect(checkPlayCompleteness(complete)).toEqual({ duration: true, winners: true, scores: true })
  })

  it.each([null, 0, -1, 1.5, NaN, Infinity, 2_147_483_648])('segnala la durata non valida %s', duration => {
    expect(checkPlayCompleteness({ ...complete, duration_minutes: duration }).duration).toBe(false)
  })

  it('mantiene indipendenti vincitori e punteggi mancanti', () => {
    expect(checkPlayCompleteness({ ...complete, play_scores: [{ score: null, winner: true }] }))
      .toEqual({ duration: true, winners: true, scores: false })
    expect(checkPlayCompleteness({ ...complete, play_scores: [{ score: 0, winner: false }] }))
      .toEqual({ duration: true, winners: false, scores: true })
  })

  it.each([null, [], [{ score: null, winner: null }]])('segnala partecipanti o risultati assenti: %j', play_scores => {
    expect(checkPlayCompleteness({ ...complete, play_scores }))
      .toEqual({ duration: true, winners: false, scores: false })
  })

  it.each([true, false])('accetta un esito cooperativo esplicito: %s', team_won => {
    expect(checkPlayCompleteness({ ...complete, is_cooperative: true, team_won,
      play_scores: [{ score: 0, winner: false }] }).winners).toBe(true)
  })

  it('richiede un esito del gruppo nei cooperativi anche con vincitori individuali', () => {
    expect(checkPlayCompleteness({ ...complete, is_cooperative: true }).winners).toBe(false)
  })

  it('accetta più vincitori, punteggi negativi e frazionari', () => {
    expect(checkPlayCompleteness({ ...complete,
      play_scores: [{ score: -2.5, winner: true }, { score: -2.5, winner: true }] }).scores).toBe(true)
    expect(checkPlayCompleteness({ ...complete,
      play_scores: [{ score: 1, winner: true }, { score: 1, winner: true }] }).winners).toBe(true)
  })

  it.each([NaN, Infinity, -Infinity])('rifiuta punteggi non finiti: %s', score => {
    expect(checkPlayCompleteness({ ...complete, play_scores: [{ score, winner: true }] }).scores).toBe(false)
  })
})
