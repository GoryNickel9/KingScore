/**
 * Test di caratterizzazione del core ELO puro.
 *
 * Scopo: bloccare la semantica attuale (formule, K-factor, assegnazione
 * posizioni, media ponderata dell'ELO Generale) prima di ogni refactor.
 * I valori attesi NON sono "quelli giusti": sono quelli che il codice
 * produce oggi, verificati anche da scripts/compare-elo.ts su dati reali.
 *
 * Il test "la seconda partita riparte dai rating reali" è la regressione
 * di riferimento per TD-001 (TECH_DEBT_AUDIT.md): l'aggiunta di una
 * partita NON deve mai ripartire da 1000.
 */
import { describe, it, expect } from 'vitest'
import {
  calculateExpectedScore,
  calculateExpectedScorePairwise,
  calculateActualScore,
  calculateNewRating,
  calculateKFactor,
  calculateELOForGame,
  simulateAllPlays,
} from './simulation'
import type { SimulationPlay, SimulationPlayScore, PlayerInput } from './simulation'

// ─── Formule ─────────────────────────────────────────────────────────────────

describe('calculateExpectedScore (metodo classico)', () => {
  it('rating uguali → 0.5', () => {
    expect(calculateExpectedScore(1000, [1000])).toBe(0.5)
  })

  it('nessun avversario → 0.5', () => {
    expect(calculateExpectedScore(1400, [])).toBe(0.5)
  })

  it('rating superiore → atteso > 0.5 (differenza 200 punti)', () => {
    // 1 / (1 + 10^(-0.5)) ≈ 0.7597
    expect(calculateExpectedScore(1200, [1000])).toBeCloseTo(0.7597, 4)
  })

  it('usa la media dei rating avversari', () => {
    expect(calculateExpectedScore(1000, [800, 1200])).toBeCloseTo(0.5, 10)
  })
})

describe('calculateExpectedScorePairwise (metodo a coppie)', () => {
  it('rating uguali → 0.5', () => {
    expect(calculateExpectedScorePairwise(1000, [1000, 1000])).toBe(0.5)
  })

  it('media dei punteggi attesi per coppia', () => {
    // vs 800: ≈0.76, vs 1200: ≈0.24 → media 0.5
    expect(calculateExpectedScorePairwise(1000, [800, 1200])).toBeCloseTo(0.5, 4)
  })

  it('rating superiore contro due inferiori → atteso alto', () => {
    expect(calculateExpectedScorePairwise(1200, [1000, 1000])).toBeCloseTo(0.7597, 4)
  })
})

describe('calculateActualScore', () => {
  it('il vincitore fa sempre 1', () => {
    expect(calculateActualScore(3, 4, true)).toBe(1)
  })

  it('l\'ultimo classificato fa 0', () => {
    expect(calculateActualScore(4, 4, false)).toBe(0)
  })

  it('posizioni intermedie scalano linearmente', () => {
    // (4 - 2) / (4 - 1) = 2/3
    expect(calculateActualScore(2, 4, false)).toBeCloseTo(2 / 3, 10)
  })

  it('in una partita a 2 il perdente fa 0', () => {
    expect(calculateActualScore(2, 2, false)).toBe(0)
  })
})

describe('calculateKFactor', () => {
  it.each([
    [0, 48],
    [9, 48],
    [10, 32],
    [29, 32],
    [30, 24],
    [500, 24],
  ])('gamesPlayed=%i → K=%i', (gamesPlayed, expected) => {
    expect(calculateKFactor(gamesPlayed)).toBe(expected)
  })
})

describe('calculateNewRating', () => {
  it('applica K × (atteso − reale) e arrotonda', () => {
    expect(calculateNewRating(1000, 0.5, 1, 32)).toBe(1016)
    expect(calculateNewRating(1000, 0.5, 0, 32)).toBe(984)
  })

  it('K predefinito = 32', () => {
    expect(calculateNewRating(1000, 0.5, 1)).toBe(1016)
  })

  it('arrotonda al numero intero più vicino', () => {
    // 24 × (0.75 − 0.5) = 6 esatto; usa valori con frazioni per l'arrotondamento
    expect(calculateNewRating(1000, 0.4, 0.6, 24)).toBe(1005)
  })
})

// ─── Calcolo per partita ─────────────────────────────────────────────────────

function twoPlayers(winnerId: string): PlayerInput[] {
  return [
    { playerId: 'p1', currentRating: 1000, gamesPlayed: 0, winner: winnerId === 'p1', position: 1 },
    { playerId: 'p2', currentRating: 1000, gamesPlayed: 0, winner: winnerId === 'p2', position: 2 },
  ]
}

describe('calculateELOForGame', () => {
  it('richiede almeno 2 giocatori', () => {
    expect(() => calculateELOForGame([{ playerId: 'p1', currentRating: 1000, gamesPlayed: 0, winner: true }]))
      .toThrow('Servono almeno 2 giocatori')
  })

  it('duello equilibrato a K=48: il vincitore guadagna 24, il perdente perde 24', () => {
    const results = calculateELOForGame(twoPlayers('p1'))
    const byId = Object.fromEntries(results.map(r => [r.playerId, r]))

    expect(byId.p1.newRating).toBe(1024)
    expect(byId.p1.ratingChange).toBe(24)
    expect(byId.p2.newRating).toBe(976)
    expect(byId.p2.ratingChange).toBe(-24)
  })

  it('usa il K-factor del numero di partite già giocate', () => {
    const seasoned = twoPlayers('p1').map(p => ({ ...p, gamesPlayed: 30 }))
    const [winner] = calculateELOForGame(seasoned).filter(r => r.ratingChange > 0)
    // K=24, atteso 0.5 → +12
    expect(winner.kFactor).toBe(24)
    expect(winner.ratingChange).toBe(12)
  })

  it('partita a 3+: metodo pairwise, punteggio reale graduato per posizione', () => {
    const results = calculateELOForGame([
      { playerId: 'a', currentRating: 1000, gamesPlayed: 0, winner: true, position: 1 },
      { playerId: 'b', currentRating: 1000, gamesPlayed: 0, winner: false, position: 2 },
      { playerId: 'c', currentRating: 1000, gamesPlayed: 0, winner: false, position: 3 },
    ])
    const byId = Object.fromEntries(results.map(r => [r.playerId, r]))

    // atteso 0.5 per tutti; reali: 1, 0.5, 0 → K=48: +24, 0, −24
    expect(byId.a.newRating).toBe(1024)
    expect(byId.b.newRating).toBe(1000)
    expect(byId.c.newRating).toBe(976)
  })

  it('parità di posizione: entrambi vincitori condividono la posizione 1', () => {
    const results = calculateELOForGame([
      { playerId: 'a', currentRating: 1000, gamesPlayed: 0, winner: true, position: 1 },
      { playerId: 'b', currentRating: 1000, gamesPlayed: 0, winner: true, position: 1 },
      { playerId: 'c', currentRating: 1000, gamesPlayed: 0, winner: false, position: 2 },
    ])
    const byId = Object.fromEntries(results.map(r => [r.playerId, r]))

    // Un avversario superato e uno pari: risultato 0.75 → K=48: +12.
    expect(byId.a.newRating).toBe(1012)
    expect(byId.b.newRating).toBe(1012)
    // c: posizione compattata a 3 di 3 → reale 0 → −24
    expect(byId.c.newRating).toBe(976)
  })

  it('i risultati sono ordinati per posizione crescente', () => {
    const results = calculateELOForGame([
      { playerId: 'a', currentRating: 1000, gamesPlayed: 0, winner: true, position: 2 },
      { playerId: 'b', currentRating: 1000, gamesPlayed: 0, winner: false, position: 3 },
      { playerId: 'c', currentRating: 1000, gamesPlayed: 0, winner: false, position: 1 },
    ])
    expect(results.map(r => r.playerId)).toEqual(['c', 'a', 'b'])
  })
})

// ─── Simulazione completa ────────────────────────────────────────────────────

let playCounter = 0

function makePlay(
  gameId: string,
  scores: Array<Partial<SimulationPlayScore> & { player_id: string }>,
  playedAt?: string
): SimulationPlay {
  playCounter++
  return {
    id: `play-${playCounter}`,
    game_id: gameId,
    played_at: playedAt ?? `2026-01-${String(playCounter).padStart(2, '0')}T20:00:00Z`,
    play_scores: scores.map(s => ({
      winner: false,
      position: null,
      score: null,
      draw: false,
      players: { name: s.player_id, alias: null },
      ...s,
    })),
  }
}

describe('simulateAllPlays', () => {
  it('salta le partite con meno di 2 giocatori o senza punteggi', () => {
    const sim = simulateAllPlays([
      makePlay('g1', [{ player_id: 'p1', winner: true }]),
      { id: 'x', game_id: 'g1', played_at: '2026-01-01T20:00:00Z', play_scores: null },
      makePlay('g1', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: false, position: 2 },
      ]),
    ])

    expect(sim.processedPlays).toBe(1)
    expect(sim.skippedPlays).toBe(2)
  })

  it('REGRESSIONE TD-001: la seconda partita riparte dai rating reali, non da 1000', () => {
    // Partita 1: vince p1 → 1024/976. Partita 2: vince p2 (atteso ≠ 0.5).
    // Con continuità: p1 = 997, p2 = 1003 (entrambi 2 partite giocate).
    // Con il bug "reset a 1000": p1 = 976, p2 = 1024.
    const sim = simulateAllPlays([
      makePlay('g1', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: false, position: 2 },
      ]),
      makePlay('g1', [
        { player_id: 'p1', winner: false, position: 2 },
        { player_id: 'p2', winner: true, position: 1 },
      ]),
    ])

    const p1 = sim.gamePlayers.g1.p1
    const p2 = sim.gamePlayers.g1.p2

    expect(p1.rating).toBe(997)
    expect(p2.rating).toBe(1003)
    expect(p1.gamesPlayed).toBe(2)
    expect(p2.gamesPlayed).toBe(2)
  })

  it('conta vittorie/sconfitte/parei per giocatore', () => {
    const sim = simulateAllPlays([
      makePlay('g1', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: false, position: 2 },
      ]),
      makePlay('g1', [
        { player_id: 'p1', winner: false, draw: true, position: 1 },
        { player_id: 'p2', winner: false, draw: true, position: 2 },
      ]),
      makePlay('g1', [
        { player_id: 'p1', winner: false, position: 2 },
        { player_id: 'p2', winner: true, position: 1 },
      ]),
    ])

    expect(sim.gamePlayers.g1.p1).toMatchObject({ wins: 1, losses: 1, draws: 1 })
    expect(sim.gamePlayers.g1.p2).toMatchObject({ wins: 1, losses: 1, draws: 1 })
  })

  it('il K-factor scende a 24 dopo 30 partite nello stesso gioco', () => {
    // 30 "pareggi reali" (entrambi vincitori con posizione condivisa): il
    // punteggio atteso resta 0.5 e i rating rimangono uguali a ogni partita.
    const plays: SimulationPlay[] = []
    for (let i = 0; i < 30; i++) {
      plays.push(makePlay('g1', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: true, position: 1 },
      ]))
    }
    // 31ª partita: gamesPlayed=30 → K=24, atteso 0.5 (rating uguali) → +12 esatti
    plays.push(makePlay('g1', [
      { player_id: 'p1', winner: true, position: 1 },
      { player_id: 'p2', winner: false, position: 2 },
    ]))

    const sim = simulateAllPlays(plays)
    const lastPlayId = plays[plays.length - 1].id
    const lastEntries = sim.gameHistory.filter(h => h.playId === lastPlayId)
    const winnerEntry = lastEntries.find(h => h.ratingChange > 0)

    expect(winnerEntry?.ratingChange).toBe(12)
  })

  it('gli stati per gioco sono indipendenti tra giochi diversi', () => {
    const sim = simulateAllPlays([
      makePlay('g1', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: false, position: 2 },
      ]),
      makePlay('g2', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: false, position: 2 },
      ]),
    ])

    // Ogni gioco riparte da 1000: due vittorie di p1 ma rating per gioco = 1024
    expect(sim.gamePlayers.g1.p1.rating).toBe(1024)
    expect(sim.gamePlayers.g2.p1.rating).toBe(1024)
    expect(sim.gamePlayers.g1.p1.gamesPlayed).toBe(1)
  })

  it('lo storico per gioco contiene una riga per giocatore per partita', () => {
    const sim = simulateAllPlays([
      makePlay('g1', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: false, position: 2 },
      ]),
      makePlay('g1', [
        { player_id: 'p1', winner: false, position: 2 },
        { player_id: 'p2', winner: true, position: 1 },
      ]),
    ])

    expect(sim.gameHistory).toHaveLength(4)
    expect(sim.gameHistory.filter(h => h.playerId === 'p1')).toHaveLength(2)
  })

  it('ELO Generale = media ponderata (peso = partite nel gioco) degli stati finali (OP3)', () => {
    const plays = [
      ...Array.from({ length: 3 }, (_, i) => makePlay('g1', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: false, position: 2 },
      ], `2026-01-0${i + 1}T20:00:00Z`)),
      makePlay('g2', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p3', winner: false, position: 2 },
      ], '2026-01-10T20:00:00Z'),
    ]
    const sim = simulateAllPlays(plays)

    for (const [playerId, general] of Object.entries(sim.generalPlayers)) {
      let weighted = 0
      let weight = 0
      for (const players of Object.values(sim.gamePlayers)) {
        const state = players[playerId]
        if (state) {
          weighted += state.rating * state.gamesPlayed
          weight += state.gamesPlayed
        }
      }
      expect(weight).toBe(general.gamesPlayed)
      expect(general.rating).toBe(Math.round(weighted / weight))
    }

    // p1: 3 partite a g1 + 1 a g2; contatori W aggregati da tutti i giochi
    expect(sim.generalPlayers.p1).toMatchObject({ wins: 4, losses: 0, gamesPlayed: 4 })
  })

  it('storico ELO Generale: prima partita da 1000, poi medie progressive', () => {
    const sim = simulateAllPlays([
      makePlay('g1', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: false, position: 2 },
      ]),
      makePlay('g1', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: false, position: 2 },
      ]),
    ])

    const p1History = sim.generalHistory.filter(h => h.playerId === 'p1')
    expect(p1History).toHaveLength(2)
    expect(p1History[0]).toMatchObject({ ratingChange: 24, gamesPlayed: 1 })
    // Seconda vittoria: l'avversario è più basso (976) → atteso 0.569 → +21 sul generale
    expect(p1History[1]).toMatchObject({ ratingChange: 21, gamesPlayed: 2 })
    // Rating generale dopo 2 vittorie consecutive sullo stesso gioco = rating di gioco
    expect(sim.generalPlayers.p1.rating).toBe(sim.gamePlayers.g1.p1.rating)
  })

  it('preferisce l\'alias al nome del giocatore, con fallback "Unknown"', () => {
    const play = makePlay('g1', [
      { player_id: 'p1', winner: true, position: 1, players: { name: 'Nome', alias: 'Alias' } },
      { player_id: 'p2', winner: false, position: 2, players: { name: null, alias: null } },
    ])
    const sim = simulateAllPlays([play])

    expect(sim.gamePlayers.g1.p1.playerName).toBe('Alias')
    expect(sim.gamePlayers.g1.p2.playerName).toBe('Unknown')
  })

  it('una partita senza game_id contribuisce solo all\'ELO Generale', () => {
    const sim = simulateAllPlays([
      { ...makePlay('', [
        { player_id: 'p1', winner: true, position: 1 },
        { player_id: 'p2', winner: false, position: 2 },
      ]), game_id: '' },
    ])

    // Lo stato viene comunque creato sotto la chiave game_id vuota
    expect(sim.gamePlayers[''].p1.rating).toBe(1024)
    expect(sim.generalPlayers.p1.gamesPlayed).toBe(1)
  })
})
