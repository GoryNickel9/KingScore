import { readGlobalElo } from './readClient'
import type { EloRead } from './readModel'

const POLL_INTERVAL_MS = 1000
const MAX_WAIT_MS = 120_000
const MAX_CONSECUTIVE_ERRORS = 3

function delay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('ELO read cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, POLL_INTERVAL_MS)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** Refresh only pending publications; no overlapping requests, writes or persistent cache. */
export async function waitForCurrentGlobalElo(
  client: Parameters<typeof readGlobalElo>[0],
  onRead: (read: EloRead) => void,
  signal: AbortSignal,
  initial?: EloRead
): Promise<EloRead> {
  const deadline = new AbortController()
  const cancel = () => deadline.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const timeout = setTimeout(() => deadline.abort(new Error('ELO update timed out')), MAX_WAIT_MS)
  const active = deadline.signal
  let read = initial
  let failures = 0
  try {
    while (!active.aborted) {
      if (!read) {
        try {
          read = await readGlobalElo(client, active)
          failures = 0
        } catch (error) {
          if (active.aborted || ++failures >= MAX_CONSECUTIVE_ERRORS) throw error
        }
      }
      if (active.aborted) break
      if (read) {
        onRead(read)
        if (read.status === 'current') return read
      }
      await delay(active)
      read = undefined
    }
    throw active.reason ?? new DOMException('ELO read cancelled', 'AbortError')
  } catch (error) {
    if (active.aborted) throw active.reason ?? error
    throw error
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', cancel)
  }
}
