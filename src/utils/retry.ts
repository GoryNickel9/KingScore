/**
 * Retry generico con backoff esponenziale — nessuna dipendenza
 * (riusato dal browser, dai node scripts e dall'Edge Function Deno).
 *
 * In caso di esaurimento dei tentativi rilancia l'ultimo errore.
 */

export interface RetryOptions {
  /** Tentativi aggiuntivi dopo il primo (default 2 → 3 esecuzioni totali) */
  retries?: number
  /** Ritardo del primo retry; raddoppia a ogni tentativo (default 300 ms) */
  baseDelayMs?: number
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 2, baseDelayMs = 300 } = options
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}
