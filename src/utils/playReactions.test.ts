import { describe, it, expect } from 'vitest'
import { REACTION_EMOJIS, nextReaction } from './playReactions'

describe('play reactions', () => {
  it('offers twelve distinct emojis and toggles only the chosen reaction', () => {
    expect(REACTION_EMOJIS).toHaveLength(12)
    expect(new Set(REACTION_EMOJIS).size).toBe(12)
    for (const emoji of REACTION_EMOJIS) {
      expect(nextReaction(undefined, emoji)).toBe(emoji)
      expect(nextReaction(emoji, emoji)).toBeNull()
      expect(nextReaction('old', emoji)).toBe(emoji)
    }
  })
})
