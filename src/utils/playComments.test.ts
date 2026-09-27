import { describe, expect, it } from 'vitest'
import { MAX_PLAY_COMMENT_LENGTH, normalizePlayCommentContent } from './playComments'

describe('normalizePlayCommentContent', () => {
  it('trims whitespace around a comment', () => {
    expect(normalizePlayCommentContent('  Bella partita!  ')).toBe('Bella partita!')
  })

  it('rejects empty comments', () => {
    expect(normalizePlayCommentContent(' \n  ')).toBeNull()
  })

  it('accepts comments at the maximum length and rejects longer ones', () => {
    expect(normalizePlayCommentContent('a'.repeat(MAX_PLAY_COMMENT_LENGTH))).toHaveLength(MAX_PLAY_COMMENT_LENGTH)
    expect(normalizePlayCommentContent('a'.repeat(MAX_PLAY_COMMENT_LENGTH + 1))).toBeNull()
  })
})
