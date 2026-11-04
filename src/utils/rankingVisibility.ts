/** Player 1 è escluso da classifiche e selettori, ma resta nei risultati storici e nei calcoli ELO. */
export function isVisibleInRankings(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() !== 'player 1'
}
