export const MAX_PLAY_COMMENT_LENGTH = 1000

/** Trims user input and rejects empty or overlong comments. */
export function normalizePlayCommentContent(content: string): string | null {
  const normalized = content.trim()
  if (normalized.length === 0 || normalized.length > MAX_PLAY_COMMENT_LENGTH) {
    return null
  }

  return normalized
}
