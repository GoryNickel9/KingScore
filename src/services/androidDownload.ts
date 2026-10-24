export async function fetchAndroidApk(accessToken: string, request: typeof fetch = fetch): Promise<Blob> {
  if (!accessToken) throw new Error('Accedi a KingScore per scaricare l’app Android.')
  const response = await request('/api/android/download', {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', redirect: 'error',
  })
  if (response.status === 401) throw new Error('Sessione scaduta. Accedi di nuovo a KingScore.')
  if (!response.ok) throw new Error('Download Android non disponibile. Riprova.')
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/vnd.android.package-archive') {
    throw new Error('Il server non ha restituito un APK valido.')
  }
  const apk = await response.blob()
  if (!apk.size || apk.size > 100_000_000) throw new Error('Dimensione dell’APK non valida.')
  return apk
}
