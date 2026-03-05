/**
 * Script diagnostico per investigare le partite senza play_scores o con meno di 2 play_scores
 * 
 * Utilizzo nel browser:
 * 1. Apri la console del browser (F12)
 * 2. Importa questo script: import { diagnoseProblematicPlays } from './src/utils/diagnosePlays.ts'
 * 3. Esegui: await diagnoseProblematicPlays(supabase, userId)
 * 
 * Oppure esegui direttamente dalla console copiando la funzione
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiagnosisResult } from '../types'

interface PlayInfo {
  index: number
  id: string
  gameId: string
  gameName: string
  playedAt: string
  location: string | null
  durationMinutes: number | null
  source: string
  notes: string | null
  scoresCount: number
  scores: any[]
  issue?: string
}

/**
 * Diagnostica le partite problematiche
 */
export async function diagnoseProblematicPlays(supabaseClient: SupabaseClient, userId: string | null = null): Promise<DiagnosisResult> {
  try {
    console.log('🔍 Inizio diagnosi delle partite problematiche...\n')

    // Recupera tutte le partite
    let query = supabaseClient
      .from('plays')
      .select(`
        *,
        play_scores(
          *,
          players(*)
        ),
        games(*)
      `)
      .order('played_at', { ascending: true })

    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data: plays, error } = await query

    if (error) throw error

    if (!plays || plays.length === 0) {
      console.log('ℹ️  Nessuna partita trovata nel database')
      return { totalPlays: 0, problematicPlays: [], playsWithoutScores: [], playsWithOneScore: [], playsWithMultipleScores: [] }
    }

    console.log(`📊 Totale partite recuperate: ${plays.length}\n`)

    // Analizza ogni partita
    const problematicPlays: PlayInfo[] = []
    const playsWithoutScores: PlayInfo[] = []
    const playsWithOneScore: PlayInfo[] = []
    const playsWithMultipleScores: PlayInfo[] = []

    plays.forEach((play: any, index: number) => {
      const scoresCount: number = play.play_scores?.length || 0
      const playInfo: PlayInfo = {
        index: index + 1,
        id: play.id,
        gameId: play.game_id,
        gameName: play.games?.name || 'Unknown',
        playedAt: play.played_at,
        location: play.location,
        durationMinutes: play.duration_minutes,
        source: play.source,
        notes: play.notes,
        scoresCount: scoresCount,
        scores: play.play_scores || []
      }

      if (scoresCount === 0) {
        playsWithoutScores.push(playInfo)
        problematicPlays.push({ ...playInfo, issue: 'Nessun punteggio associato' })
      } else if (scoresCount === 1) {
        playsWithOneScore.push(playInfo)
        problematicPlays.push({ ...playInfo, issue: 'Solo un punteggio associato (servono almeno 2 per ELO)' })
      } else {
        playsWithMultipleScores.push(playInfo)
      }
    })

    // Stampa i risultati
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📋 RIEPILOGO DELLA DIAGNOSI')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`📊 Totale partite: ${plays.length}`)
    console.log(`✅ Partite con 2+ punteggi: ${playsWithMultipleScores.length}`)
    console.log(`⚠️  Partite con 1 punteggio: ${playsWithOneScore.length}`)
    console.log(`❌ Partite senza punteggi: ${playsWithoutScores.length}`)
    console.log(`🚨 Totale partite problematiche: ${problematicPlays.length}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    // Stampa i dettagli delle partite problematiche
    if (problematicPlays.length > 0) {
      console.log('🔍 DETTAGLIO DELLE PARTITE PROBLEMATICHE:')
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

      problematicPlays.forEach((play) => {
        console.log(`📌 Partita #${play.index} - ID: ${play.id}`)
        console.log(`   🎮 Gioco: ${play.gameName} (ID: ${play.gameId})`)
        console.log(`   📅 Data: ${play.playedAt}`)
        console.log(`   📍 Luogo: ${play.location || 'Non specificato'}`)
        console.log(`   ⏱️  Durata: ${play.durationMinutes ? play.durationMinutes + ' min' : 'Non specificata'}`)
        console.log(`   🌐 Fonte: ${play.source}`)
        console.log(`   📝 Note: ${play.notes || 'Nessuna'}`)
        console.log(`   📊 Punteggi: ${play.scoresCount}`)
        console.log(`   ⚠️  Problema: ${play.issue}`)

        if (play.scores.length > 0) {
          console.log(`   👥 Giocatori:`)
          play.scores.forEach((score: any, scoreIndex: number) => {
            const playerName = score.players?.alias || score.players?.name || 'Unknown'
            console.log(`      ${scoreIndex + 1}. ${playerName} - Punteggio: ${score.score}, Vincitore: ${score.winner}, Posizione: ${score.position}`)
          })
        } else {
          console.log(`   👥 Giocatori: Nessuno`)
        }

        console.log('')
      })
    } else {
      console.log('✅ Nessuna partita problematica trovata!\n')
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('💡 SUGGERIMENTI:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    if (playsWithoutScores.length > 0) {
      console.log(`\n❌ Partite senza punteggi (${playsWithoutScores.length}):`)
      console.log('   Queste partite non hanno alcun punteggio associato.')
      console.log('   Possibili cause:')
      console.log('   - Partite create erroneamente senza giocatori')
      console.log('   - Punteggi cancellati successivamente')
      console.log('   - Bug durante l\'importazione da BGStats')
      console.log('\n   Soluzioni:')
      console.log('   - Aggiungere i punteggi mancanti tramite l\'interfaccia di modifica')
      console.log('   - Eliminare queste partite se sono dati di test o errati')
    }

    if (playsWithOneScore.length > 0) {
      console.log(`\n⚠️  Partite con un solo punteggio (${playsWithOneScore.length}):`)
      console.log('   Queste partite hanno solo un giocatore associato.')
      console.log('   Il calcolo ELO richiede almeno 2 giocatori.')
      console.log('\n   Soluzioni:')
      console.log('   - Aggiungere almeno un altro giocatore alla partita')
      console.log('   - Eliminare queste partite se non sono valide')
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    return {
      totalPlays: plays.length,
      playsWithMultipleScores,
      playsWithOneScore,
      playsWithoutScores,
      problematicPlays
    }
  } catch (error) {
    console.error('❌ Errore durante la diagnosi:', error)
    throw error
  }
}

/**
 * Funzione helper per eseguire la diagnosi dalla console del browser
 * Copia e incolla questa funzione nella console del browser
 */
export function browserDiagnoseFunction(): string {
  return `
// Copia e incolla questo codice nella console del browser per eseguire la diagnosi

async function runDiagnosis() {
  try {
    console.log('🔍 Recupero delle partite problematiche...')
    
    const { data: plays, error } = await supabase
      .from('plays')
      .select(\`
        *,
        play_scores(
          *,
          players(*)
        ),
        games(*)
      \`)
      .order('played_at', { ascending: true })
    
    if (error) throw error
    
    const problematicPlays = plays.filter(play => 
      !play.play_scores || play.play_scores.length < 2
    )
    
    console.log('📊 Totale partite:', plays.length)
    console.log('🚨 Partite problematiche:', problematicPlays.length)
    console.log('')
    
    problematicPlays.forEach((play, index) => {
      console.log(\`📌 Partita #\${index + 1} - ID: \${play.id}\`)
      console.log(\`   🎮 Gioco: \${play.games?.name || 'Unknown'}\`)
      console.log(\`   📅 Data: \${play.played_at}\`)
      console.log(\`   📊 Punteggi: \${play.play_scores?.length || 0}\`)
      
      if (play.play_scores && play.play_scores.length > 0) {
        console.log(\`   👥 Giocatori:\`)
        play.play_scores.forEach((score, i) => {
          const playerName = score.players?.alias || score.players?.name || 'Unknown'
          console.log(\`      \${i + 1}. \${playerName} - Punteggio: \${score.score}, Vincitore: \${score.winner}\`)
        })
      }
      console.log('')
    })
    
    return { total: plays.length, problematic: problematicPlays.length, plays: problematicPlays }
  } catch (error) {
    console.error('❌ Errore:', error)
    throw error
  }
}

// Esegui la diagnosi
runDiagnosis()
  `
}
