import { describe, expect, it, vi } from 'vitest'
import { fetchAndroidApk } from './androidDownload'

describe('Android web download', () => {
  it('requires a session before making a request', async () => {
    const request = vi.fn<typeof fetch>()
    await expect(fetchAndroidApk('', request)).rejects.toThrow('Accedi')
    expect(request).not.toHaveBeenCalled()
  })
  it('sends the session only in the authorization header', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('APK', {
      headers: { 'content-type': 'application/vnd.android.package-archive' },
    }))
    expect((await fetchAndroidApk('session', request)).size).toBe(3)
    expect(request).toHaveBeenCalledWith('/api/android/download', {
      headers: { Authorization: 'Bearer session' }, cache: 'no-store', redirect: 'error',
    })
  })
  it.each([401, 403, 502, 503])('rejects failed downloads (%i)', async status => {
    await expect(fetchAndroidApk('session', vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status })))).rejects.toThrow()
  })
  it('rejects HTML SPA fallbacks and empty APK responses', async () => {
    for (const response of [new Response('<html/>', { headers: { 'content-type': 'text/html' } }),
      new Response('', { headers: { 'content-type': 'application/vnd.android.package-archive' } })]) {
      await expect(fetchAndroidApk('session', vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow()
    }
  })
})
