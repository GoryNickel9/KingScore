export const MAX_PLAY_COMMENT_LENGTH = 1000

type CommentDevice = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>

/** Keep mobile/tablet keyboards multiline, including iPadOS desktop mode. */
export function isDesktopCommentDevice(device: CommentDevice): boolean {
  return /Windows NT|Macintosh|X11|CrOS|Linux/.test(device.userAgent)
    && !/Android|Mobile|iPhone|iPad|iPod|Tablet|Silk|Kindle/i.test(device.userAgent)
    && !(device.platform === 'MacIntel' && device.maxTouchPoints > 1)
}

export function shouldSubmitPlayComment(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing' | 'keyCode'>,
  device: CommentDevice
): boolean {
  // Safari can end composition before the confirming Enter keydown (code 229).
  return event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
    && !event.isComposing && event.keyCode !== 229 && isDesktopCommentDevice(device)
}

/** Trims user input and rejects empty or overlong comments. */
export function normalizePlayCommentContent(content: string): string | null {
  const normalized = content.trim()
  if (normalized.length === 0 || normalized.length > MAX_PLAY_COMMENT_LENGTH) {
    return null
  }

  return normalized
}
