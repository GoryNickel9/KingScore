import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fail, fetchApk, githubToken, latestRelease, prepare, requestedVersion, requireUser } from '../_android.js'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const abort = new AbortController()
  const cancel = () => abort.abort()
  res.once('close', cancel)
  try {
    prepare(req, res)
    await requireUser(req)
    const version = requestedVersion(req)
    const token = githubToken()
    const { asset } = await latestRelease(token, version)
    const upstream = await fetchApk(asset, token, AbortSignal.any([abort.signal, AbortSignal.timeout(180_000)]))
    let size = 0
    const hash = createHash('sha256')
    const integrity = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > asset.size) { callback(new Error('APK exceeds published size')); return }
        hash.update(chunk)
        callback(null, chunk)
      },
      flush(callback) {
        callback(size === asset.size && hash.digest('hex') === asset.digest.slice(7).toLowerCase()
          ? null : new Error('APK integrity check failed'))
      },
    })
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/vnd.android.package-archive')
    res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`)
    // No Content-Length: an integrity failure must abort a chunked response before its terminator.
    async function* chunks() {
      const reader = upstream.body!.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          yield value
        }
      } finally { await reader.cancel() }
    }
    await pipeline(Readable.from(chunks()), integrity, res)
  } catch (error) { fail(res, error) }
  finally { res.off('close', cancel); abort.abort() }
}
