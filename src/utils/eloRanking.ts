/** Posizioni condivise (1, 2, 2, 4) per rating già ordinati in modo decrescente. */
export function getEloPositions(ratings: readonly { rating: number | null }[]): number[] {
  let position = 0
  return ratings.map((row, index) => {
    if (index === 0 || row.rating !== ratings[index - 1].rating) position = index + 1
    return position
  })
}
