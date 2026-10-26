import { createClient } from '@supabase/supabase-js'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const SITE_URL = 'https://kingscore.baldeddu.cc'
export const RELEASES_URL = 'https://github.com/GoryNickel9/KingScore-Android/releases'
export interface AndroidChannel { repository: string; query: string }
const KINGSCORE: AndroidChannel = { repository: 'KingScore-Android', query: '' }
const CANT_STOP: AndroidChannel = { repository: 'cant-stop-android', query: '?app=cant-stop' }
export function androidChannel(req: IncomingMessage): AndroidChannel {
  const apps = new URL(req.url || '/', SITE_URL).searchParams.getAll('app')
  if (!apps.length) return KINGSCORE
  if (apps.length === 1 && apps[0] === 'cant-stop') return CANT_STOP
  throw new ApiError(400, 'Applicazione Android non valida.')
}
const releasesUrl = (channel: AndroidChannel) => `https://github.com/GoryNickel9/${channel.repository}/releases`
const githubApi = (channel: AndroidChannel) => `https://api.github.com/repos/GoryNickel9/${channel.repository}`
export const MAX_APK_BYTES = 100_000_000
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function prepare(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    throw new ApiError(405, 'Metodo non consentito.')
  }
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function fail(res: ServerResponse, error: unknown): void {
  if (res.headersSent) { res.destroy(); return }
  json(res, error instanceof ApiError ? error.status : 502,
    { error: error instanceof ApiError ? error.message : 'Servizio aggiornamenti temporaneamente non disponibile.' })
}

export async function requireUser(req: IncomingMessage): Promise<void> {
  const authorization = req.headers.authorization
  if (!authorization || !/^Bearer [A-Za-z0-9._-]{1,16384}$/.test(authorization)) {
    throw new ApiError(401, 'Accedi a KingScore per scaricare l’app Android.')
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new ApiError(503, 'Verifica accesso non configurata.')
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
  })
  // Verify with Supabase Auth; decoding the JWT alone does not validate a session.
  const { data, error } = await client.auth.getUser(authorization.slice(7))
  if (error) {
    if (error.status === 400 || error.status === 401 || error.status === 403) {
      throw new ApiError(401, 'Sessione scaduta. Accedi di nuovo a KingScore.')
    }
    throw new ApiError(503, 'Impossibile verificare l’accesso. Riprova.')
  }
  if (!data.user || data.user.is_anonymous) throw new ApiError(401, 'Accedi con un account KingScore.')
}

export function githubToken(channel: AndroidChannel = KINGSCORE): string | undefined {
  return (channel.repository === 'cant-stop-android' ? process.env.CANTSTOP_GH_TOKEN || process.env.GH_TOKEN : process.env.GH_TOKEN) || undefined
}

interface GitHubAsset {
  id: number
  name: string
  state: string
  size: number
  digest: string
  url: string
  browser_download_url: string
}

export interface AndroidRelease {
  tag: string
  asset: GitHubAsset
}

export function requestedVersion(req: IncomingMessage): string | undefined {
  const params = new URL(req.url || '/', SITE_URL).searchParams
  const versions = params.getAll('version')
  if (versions.length > 1 || [...params.keys()].some(key => key !== 'version' && key !== 'app')) {
    throw new ApiError(400, 'Parametri di download non validi.')
  }
  const version = versions[0]
  if (version !== undefined && !validVersion(version)) throw new ApiError(400, 'Versione non valida.')
  return version
}

function validVersion(version: string): boolean {
  return version.length <= 32 && VERSION.test(version)
    && version.split('.').every(part => Number(part) <= 2_147_483_647)
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new ApiError(502, 'Metadati della release assenti.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 262_144) throw new ApiError(502, 'Metadati della release troppo grandi.')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally { await reader.cancel() }
}

export async function latestRelease(token: string | undefined, version?: string, channel: AndroidChannel = KINGSCORE): Promise<AndroidRelease> {
  const GITHUB_API = githubApi(channel)
  const RELEASES_URL = releasesUrl(channel)
  const response = await fetch(`${GITHUB_API}/releases/${version ? `tags/v${version}` : 'latest'}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/vnd.github+json', 'User-Agent': 'KingScore-distribution' },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  })
  // A private repository or a missing token can also return 404: never report "up to date".
  if (!response.ok) throw new ApiError(502, 'Impossibile leggere la release Android.')
  const release = await boundedJson(response) as Record<string, unknown>
  const tag = release.tag_name
  if (release.draft !== false || release.prerelease !== false || typeof tag !== 'string'
    || !tag.startsWith('v') || !validVersion(tag.slice(1)) || (version && tag !== `v${version}`)
    || release.html_url !== `${RELEASES_URL}/tag/${tag}` || !Array.isArray(release.assets) || release.assets.length > 100) {
    throw new ApiError(502, 'Release Android non valida.')
  }
  const apks = release.assets.filter((asset: GitHubAsset | null) => asset && typeof asset.name === 'string'
    && asset.name.endsWith('.apk') && asset.state === 'uploaded') as GitHubAsset[]
  if (apks.length !== 1) throw new ApiError(502, 'La release deve contenere un solo APK firmato.')
  const asset = apks[0]
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.apk$/.test(asset.name)
    || !Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.url !== `${GITHUB_API}/releases/assets/${asset.id}`
    || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_APK_BYTES
    || typeof asset.digest !== 'string' || !/^sha256:[a-fA-F0-9]{64}$/.test(asset.digest)
    || asset.browser_download_url !== `${RELEASES_URL}/download/${tag}/${asset.name}`) {
    throw new ApiError(502, 'APK o checksum della release non validi.')
  }
  return { tag, asset }
}

export function manifest({ tag, asset }: AndroidRelease, channel: AndroidChannel = KINGSCORE): object {
  const RELEASES_URL = releasesUrl(channel)
  const query = channel.query ? `${channel.query}&` : '?'
  return {
    tag_name: tag, draft: false, prerelease: false, html_url: `${RELEASES_URL}/tag/${tag}`,
    assets: [{ name: asset.name, state: 'uploaded', size: asset.size, digest: asset.digest,
      browser_download_url: `${SITE_URL}/api/android/download${query}version=${tag.slice(1)}` }],
  }
}

export async function fetchApk(asset: GitHubAsset, token: string | undefined, signal: AbortSignal): Promise<Response> {
  let url = asset.url
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, {
      headers: url === asset.url ? { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/octet-stream' } : {},
      redirect: 'manual', signal,
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location || redirects === 5) throw new ApiError(502, 'Redirect della release non valido.')
      const next = new URL(location, url)
      if (next.protocol !== 'https:' || next.port || next.username || next.password || next.hash
        || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'].includes(next.hostname)) {
        throw new ApiError(502, 'Destinazione della release non autorizzata.')
      }
      url = next.href
      continue
    }
    if (response.status !== 200 || !response.body) throw new ApiError(502, 'Download Android non disponibile.')
    const length = response.headers.get('content-length')
    if (length !== null && Number(length) !== asset.size) {
      await response.body.cancel()
      throw new ApiError(502, 'Dimensione dell’APK diversa dalla release.')
    }
    return response
  }
  throw new ApiError(502, 'Troppi redirect della release.')
}
