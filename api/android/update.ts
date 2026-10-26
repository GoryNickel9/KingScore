import type { IncomingMessage, ServerResponse } from 'node:http'
import { androidChannel, fail, githubToken, json, latestRelease, manifest, prepare } from '../_android.js'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    prepare(req, res)
    const channel = androidChannel(req)
    const release = await latestRelease(githubToken(channel), undefined, channel)
    // Metadata contains no account data. Share it briefly to limit GitHub API requests.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120')
    json(res, 200, manifest(release, channel))
  } catch (error) { fail(res, error) }
}
