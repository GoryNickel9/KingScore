import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import download from './download.js'
import update from './update.js'
import { RELEASES_URL, SITE_URL } from '../_android.js'

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser } }) }))
const nativeFetch = globalThis.fetch
const bytes = Buffer.from('signed APK fixture')
const digest = createHash('sha256').update(bytes).digest('hex')
const assetUrl = 'https://api.github.com/repos/GoryNickel9/KingScore-Android/releases/assets/42'
const asset = { id: 42, name: 'KingScore-0.7.2.apk', state: 'uploaded', size: bytes.length,
  digest: `sha256:${digest}`, url: assetUrl, browser_download_url: `${RELEASES_URL}/download/v0.7.2/KingScore-0.7.2.apk` }
const release = { tag_name: 'v0.7.2', html_url: `${RELEASES_URL}/tag/v0.7.2`, draft: false, prerelease: false, assets: [asset] }
let server: Server
let base: string
let upstream: ReturnType<typeof vi.fn<typeof fetch>>

beforeAll(async () => {
  server = createServer((req, res) => {
    void (req.url?.startsWith('/api/android/download') ? download : update)(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local test server unavailable')
  base = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})
beforeEach(() => {
  vi.stubEnv('GH_TOKEN', 'private-github-token')
  vi.stubEnv('SUPABASE_URL', 'https://fixture.supabase.co')
  vi.stubEnv('SUPABASE_ANON_KEY', 'public-key')
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'account' } }, error: null })
  upstream = vi.fn<typeof fetch>(async input => String(input) === assetUrl
    ? new Response(bytes) : Response.json(release))
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const request = (path = '/api/android/download', token: string | null = 'valid-session', method = 'GET') => nativeFetch(`${base}${path}`, {
  method, headers: token === null ? {} : { Authorization: `Bearer ${token}` },
})

describe('Android authenticated distribution', () => {
  it('rejects anonymous requests before contacting GitHub or Auth', async () => {
    const response = await request(undefined, null)
    expect(response.status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
    expect(getUser).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it.each([400, 401, 403])('rejects an invalid Supabase session (%i)', async status => {
    getUser.mockResolvedValue({ data: { user: null }, error: { status } })
    expect((await request()).status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('rejects Supabase anonymous accounts', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'guest', is_anonymous: true } }, error: null })
    expect((await request()).status).toBe(401)
  })
  it('reports an Auth outage without serving an APK', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { status: 503 } })
    expect((await request()).status).toBe(503)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('streams the exact APK after checking the session, keeping GitHub credentials on the server', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(getUser).toHaveBeenCalledWith('valid-session')
    expect(response.headers.get('content-type')).toBe('application/vnd.android.package-archive')
    expect(response.headers.get('content-disposition')).toContain('KingScore-0.7.2.apk')
    expect([...response.headers.values()].join(' ')).not.toContain('private-github-token')
    for (const [, init] of upstream.mock.calls) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-github-token')
      expect(JSON.stringify(init)).not.toContain('valid-session')
    }
  })
  it('serves anonymous update metadata with a pinned authenticated download URL', async () => {
    const response = await request('/api/android/update', null)
    expect(response.status).toBe(200)
    const body = await response.json() as typeof release
    expect(body.assets[0].browser_download_url).toBe(`${SITE_URL}/api/android/download?version=0.7.2`)
    expect(body.assets[0]).not.toHaveProperty('url')
    expect(JSON.stringify(body)).not.toContain('private-github-token')
    expect(getUser).not.toHaveBeenCalled()
  })
  it('pins the asset to the requested version during concurrent releases', async () => {
    const response = await request('/api/android/download?version=0.7.2')
    await response.arrayBuffer()
    expect(String(upstream.mock.calls[0][0]).endsWith('/releases/tags/v0.7.2')).toBe(true)
  })
  it.each(['version=../main', 'version=', 'version=0.7.2&version=0.7.1', 'url=https://attacker.invalid', 'version=2147483648.0.0'])('rejects invalid parameters %s', async query => {
    expect((await request(`/api/android/download?${query}`)).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })
  it.each([404, 429, 500])('fails closed when GitHub returns %i', async status => {
    upstream.mockResolvedValue(new Response('{}', { status }))
    expect((await request('/api/android/update', null)).status).toBe(502)
  })
  it.each([
    { ...release, draft: true }, { ...release, prerelease: true }, { ...release, assets: [asset, asset] },
    { ...release, assets: [{ ...asset, size: 100_000_001 }] },
    { ...release, assets: [{ ...asset, digest: null }] },
    { ...release, assets: [{ ...asset, url: 'https://attacker.invalid/file' }] },
    { ...release, assets: [{ ...asset, name: '../unsafe.apk' }] },
  ])('rejects unusable release metadata %#', async invalid => {
    upstream.mockResolvedValue(Response.json(invalid))
    expect((await request('/api/android/update', null)).status).toBe(502)
  })
  it('bounds release metadata size', async () => {
    upstream.mockResolvedValue(new Response('x'.repeat(262_145)))
    expect((await request('/api/android/update', null)).status).toBe(502)
  })
  it('does not forward the GitHub credential to the asset CDN', async () => {
    upstream.mockImplementation(async (input, init) => {
      if (String(input) === assetUrl) return new Response(null, { status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/signed-apk?signature=fixture' } })
      if (String(input).startsWith('https://release-assets.')) {
        expect(new Headers(init?.headers).get('authorization')).toBeNull()
        return new Response(bytes)
      }
      return Response.json(release)
    })
    const response = await request()
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
  })
  it('rejects redirects to unapproved hosts before sending a credential', async () => {
    upstream.mockImplementation(async input => String(input) === assetUrl
      ? new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/apk' } })
      : Response.json(release))
    expect((await request()).status).toBe(502)
    expect(upstream).toHaveBeenCalledTimes(2)
  })
  it.each([bytes.subarray(1), Buffer.concat([bytes, Buffer.from('extra')]), Buffer.alloc(bytes.length)])('aborts incomplete, oversized or tampered streams %#', async invalid => {
    upstream.mockImplementation(async input => String(input) === assetUrl ? new Response(invalid) : Response.json(release))
    await expect(request().then(response => response.arrayBuffer())).rejects.toThrow()
  })
  it('supports the public repository without copying a personal GitHub token to the server', async () => {
    vi.stubEnv('GH_TOKEN', '')
    const response = await request()
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    for (const [, init] of upstream.mock.calls) expect(new Headers(init?.headers).get('authorization')).toBeNull()
  })
  it('cannot use anonymous GitHub access to bypass a private or missing repository', async () => {
    vi.stubEnv('GH_TOKEN', '')
    upstream.mockResolvedValue(new Response('{}', { status: 404 }))
    expect((await request()).status).toBe(502)
  })
  it('caches only public release metadata, never downloads or errors', async () => {
    expect((await request('/api/android/update', null)).headers.get('cache-control')).toContain('s-maxage=120')
    upstream.mockResolvedValue(new Response('{}', { status: 404 }))
    expect((await request('/api/android/update', null)).headers.get('cache-control')).toBe('private, no-store')
  })
  it('rejects methods other than GET', async () => {
    const response = await request(undefined, null, 'POST')
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })
})
