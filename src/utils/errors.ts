/**
 * Estrae un messaggio utente da un errore sconosciuto, gestendo i casi
 * comuni di questo progetto: Error, PostgrestError di Supabase (oggetto
 * con `message`/`code`), stringhe e il fallback generico.
 *
 * Da preferire a `(error as Error).message`, che restituisce `undefined`
 * per errori non-Error (es. rejection di stringhe o di oggetti Supabase).
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message

  if (typeof error === 'string') return error

  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }

  return 'Errore sconosciuto'
}
