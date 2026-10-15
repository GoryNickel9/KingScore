// Limite della colonna PostgreSQL INTEGER usata per duration_minutes.
export const MAX_PLAY_DURATION_MINUTES = 2_147_483_647

export function parsePlayDuration(value: string): number | null {
  const text = value.trim()
  if (!/^\d+$/.test(text)) return null
  const minutes = Number(text)
  return Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_PLAY_DURATION_MINUTES
    ? minutes
    : null
}
