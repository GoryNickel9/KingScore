/** Solo presentazione: i partecipanti nascosti restano nei risultati e nei calcoli ELO. */
export function isVisibleInRankings(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() !== 'player 1'
}
