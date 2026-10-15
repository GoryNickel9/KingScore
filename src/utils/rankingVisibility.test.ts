import { describe, expect, it } from 'vitest'
import { isVisibleInRankings } from './rankingVisibility'
import { simulateAllPlays, type SimulationPlay } from './elo/simulation'
import { matchesPlayerCount } from './elo/playerCountElo'

describe('visibilità nelle classifiche', () => {
  it.each(['Player 1', 'player 1', ' PLAYER 1 '])('nasconde %s', name => {
    expect(isVisibleInRankings(name)).toBe(false)
  })

  it.each(['Player 10', 'Player 2', 'Mario', '', null, undefined])('mantiene %s', name => {
    expect(isVisibleInRankings(name)).toBe(true)
  })

  it('usa il nome originale anche in presenza di alias e filtra prima del podio', () => {
    const players = [
      { name: 'Player 1', alias: 'Ospite', rating: 1300 },
      { name: 'Anna', alias: null, rating: 1200 },
      { name: 'Luca', alias: null, rating: 1100 },
      { name: 'Sara', alias: null, rating: 1000 },
    ]
    const podium = players.filter(player => isVisibleInRankings(player.name)).slice(0, 3)
    expect(podium.map(player => player.name)).toEqual(['Anna', 'Luca', 'Sara'])
    expect(players).toHaveLength(4)
  })

  it('conserva partecipanti, esito ed ELO quando il vincitore è nascosto', () => {
    const plays: SimulationPlay[] = [{
      id: 'play', game_id: 'game', played_at: '2026-10-16',
      play_scores: [
        { player_id: 'hidden', winner: true, position: 1, score: 10, players: { name: 'Player 1', alias: null } },
        { player_id: 'visible', winner: false, position: 2, score: 5, players: { name: 'Anna', alias: null } },
      ],
    }]
    const original = structuredClone(plays)
    const simulation = simulateAllPlays(plays)
    const ratings = Object.values(simulation.gamePlayers.game)
    const standings = ratings.filter(player => isVisibleInRankings(player.playerName))

    expect(standings).toHaveLength(1)
    expect(standings[0]).toMatchObject({ playerId: 'visible', rating: 976, losses: 1, wins: 0 })
    expect(ratings).toHaveLength(2)
    expect(matchesPlayerCount(plays[0].play_scores!.length, 'hu')).toBe(true)
    expect(plays).toEqual(original)
  })
})
