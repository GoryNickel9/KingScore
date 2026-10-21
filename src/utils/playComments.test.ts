import { describe, expect, it } from 'vitest'
import { isDesktopCommentDevice, MAX_PLAY_COMMENT_LENGTH, normalizePlayCommentContent, shouldSubmitPlayComment } from './playComments'

const desktop = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 }
const enter = { key: 'Enter', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, keyCode: 13 }

describe('desktop comment shortcut', () => {
  it.each([
    desktop,
    { ...desktop, maxTouchPoints: 10 },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 },
    { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64', maxTouchPoints: 0 },
  ])('submits plain Enter on a computer ($platform, $maxTouchPoints touch points)', device => {
    expect(shouldSubmitPlayComment(enter, device)).toBe(true)
  })

  it.each([
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', platform: 'Linux armv8l', maxTouchPoints: 5 },
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet)', platform: 'Linux armv8l', maxTouchPoints: 5 },
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 },
    { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', platform: 'iPad', maxTouchPoints: 5 },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 },
    { userAgent: '', platform: '', maxTouchPoints: 0 },
  ])('keeps Enter multiline on mobile/tablet or unknown devices ($platform)', device => {
    expect(isDesktopCommentDevice(device)).toBe(false)
    expect(shouldSubmitPlayComment(enter, device)).toBe(false)
  })

  it.each(['shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'isComposing'] as const)('ignores Enter with %s', key => {
    expect(shouldSubmitPlayComment({ ...enter, [key]: true }, desktop)).toBe(false)
  })

  it('ignores other keys and Safari composition confirmation', () => {
    expect(shouldSubmitPlayComment({ ...enter, key: 'a' }, desktop)).toBe(false)
    expect(shouldSubmitPlayComment({ ...enter, keyCode: 229 }, desktop)).toBe(false)
  })
})

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
