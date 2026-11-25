import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'
import { pipeline } from 'node:stream'
import express, { type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { createAuth, passwordLengthOkay } from './auth.js'
import { createAzura } from './azuracast.js'
import { station, type Config } from './config.js'
import { Problem } from './errors.js'
import { withUpload } from './upload.js'

const trackId = z.number().int().positive().safe()
const parameterId = z.string().regex(/^[1-9][0-9]{0,15}$/).transform(Number).pipe(trackId)
const credentials = z.strictObject({
  username: z.string().min(1).max(80), password: z.string().refine(passwordLengthOkay),
})
const mediaQuery = z.strictObject({
  q: z.string().trim().max(100).regex(/^[^\p{Cc}\p{Cf}]*$/u).default(''),
  page: z.string().regex(/^[1-9][0-9]{0,4}$/).transform(Number).default(1),
  scope: z.enum(['all', 'rotation']).default('all'),
})
const ids = z.array(trackId).max(10_000)
const order = z.strictObject({ baseline: ids, order: ids })
const json = express.json({ limit: '256kb', strict: true })
const safeMethod = (method: string) => method === 'GET' || method === 'HEAD'

function validate<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value)
  if (!result.success) throw new Problem(400, 'invalid_input', 'Check the submitted fields and try again.')
  return result.data
}

const sharedRadio = new RegExp('^/(?:api/nowplaying/' + station.shortcode
  + '|api/station/(?:' + station.id + '|' + station.shortcode + ')/art/[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)?'
  + '|static/vite_dist/assets/generic_song-[A-Za-z0-9_-]+\\.jpg|listen/' + station.shortcode + '/radio\\.mp3)$')

function relayRadio(config: Config, req: Request, res: Response) {
  const url = new URL(req.path, config.radioOrigin)
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
  const headers: Record<string, string> = {}
  for (const name of ['range', 'if-range']) {
    const value = req.get(name)
    if (value) headers[name] = value
  }
  const proxy = transport(url, { method: req.method, headers }, upstream => {
    clearTimeout(timer)
    const status = upstream.statusCode ?? 502
    const location = upstream.headers.location
    if (status >= 300 && status < 400 && (!location || !/^\/static\/vite_dist\/assets\/generic_song-[A-Za-z0-9_-]+\.jpg$/.test(location))) {
      upstream.resume()
      res.status(502).end()
      return
    }
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'location']) {
      const value = upstream.headers[name]
      if (value !== undefined) res.set(name, value)
    }
    res.status(status).set('Cache-Control', 'no-store')
    pipeline(upstream, res, () => {})
  })
  const timer = setTimeout(() => proxy.destroy(), config.upstreamMs)
  proxy.on('error', () => {
    clearTimeout(timer)
    if (!res.headersSent && !res.destroyed) res.status(502).end()
  })
  res.on('close', () => proxy.destroy())
  proxy.end()
}

export function createMusicChangeGuard({ allowWrites, uploadWindow }: Pick<Config, 'allowWrites' | 'uploadWindow'>) {
  let mutating = false
  let uploadedId: number | undefined
  const canWrite = () => allowWrites && (!uploadWindow || Date.now() < uploadWindow.expiresAt)
  function requireWrites() {
    if (!canWrite()) throw new Problem(403, 'writes_disabled', 'Music changes are disabled for this admin instance.')
  }
  async function run<T>(work: () => Promise<T>) {
    requireWrites()
    if (mutating) throw new Problem(409, 'change_in_progress', 'Another music change is in progress. Wait and retry.')
    mutating = true
    try { return await work() }
    finally { mutating = false }
  }
  return {
    canWrite,
    run,
    async upload<T extends { id: number }>(digest: string, work: () => Promise<T>) {
      requireWrites()
      if (uploadWindow && (digest !== uploadWindow.sha256 || uploadedId !== undefined)) {
        throw new Problem(403, 'upload_approval', 'This test window permits one upload of the approved file only.')
      }
      const result = await work()
      if (uploadWindow) uploadedId = result.id
      return result
    },
    checkRotation(addingId?: number) {
      if (uploadWindow && (uploadedId === undefined || addingId !== uploadedId)) {
        throw new Problem(403, 'rotation_approval', 'This test window only permits adding its verified upload to Main Rotation.')
      }
    },
  }
}

export function createAdminApp(
  config: Config,
  log: (event: Record<string, string | number>) => void = event => console.info(JSON.stringify(event)),
  change = createMusicChangeGuard(config),
) {
  const app = express()
  app.disable('x-powered-by')
  const auth = createAuth(config)
  const az = createAzura(config)
  const api = express.Router()
  const mode = config.uploadWindow ? 'approved-upload' : config.allowWrites ? 'persistent' : 'read-only'
  const sessionPermissions = () => ({
    uploadLimit: config.maxUploadBytes, canWrite: change.canWrite(), managementMode: mode, uploadWindowEndsAt: config.uploadWindow?.expiresAt,
  })
  function auditMusicAction(res: Response, action: string, scope: { mediaId?: number; playlistId?: number }) {
    log({
      event: 'music_action_verified', action, stationId: station.id, managementMode: mode,
      requestId: String(res.getHeader('X-Request-ID')), ...scope,
    })
  }

  app.use((req, res, next) => {
    const host = req.get('host')
    // Serve rewrites Host on a Unix socket and replaces both forwarded headers.
    const validHost = config.tailnetLogin
      ? host === 'localhost' && req.get('x-forwarded-host') === config.origin.host && req.get('x-forwarded-proto') === 'https'
      : host === config.origin.host
    if (!validHost) {
      res.status(404).end()
      return
    }
    if (config.tailnetLogin && req.get('tailscale-user-login')?.toLowerCase() !== config.tailnetLogin) {
      res.status(403).set('Cache-Control', 'no-store').type('text').send('This device must be signed in to Tailscale as the radio operator.')
      return
    }
    if (config.tailnetLogin) res.set('Strict-Transport-Security', 'max-age=86400')
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    })
    next()
  })
  app.get('/healthz', (_req, res) => { res.set('Cache-Control', 'no-store').status(204).end() })
  api.use((req, res, next) => {
    const requestId = randomUUID()
    res.set({ 'Cache-Control': 'no-store', 'X-Request-ID': requestId })
    res.on('finish', () => log({ requestId, method: req.method, status: res.statusCode, operation: String(req.route?.path ?? 'unmatched') }))
    next()
  })
  api.post('/auth/login', (req, _res, next) => { auth.checkOrigin(req); next() }, json, async (req, res) => {
    const values = validate(credentials, req.body)
    res.json({ ...await auth.login(req, res, values.username, values.password), ...sessionPermissions() })
  })
  api.use((req, res, next) => {
    const session = auth.requireSession(req)
    res.locals.session = session
    if (!safeMethod(req.method)) {
      auth.checkOrigin(req)
      auth.checkCsrf(req, session)
    }
    next()
  })
  api.get('/auth/me', (_req, res) => res.json({ username: config.username, ...res.locals.session, ...sessionPermissions() }))
  api.post('/auth/logout', (req, res) => { auth.logout(req, res); res.status(204).end() })
  api.get('/station', async (_req, res) => res.json(await az.overview()))
  api.get('/media', async (req, res) => {
    const { q, page, scope } = validate(mediaQuery, req.query)
    res.json(await az.listMedia(q, page, scope === 'rotation'))
  })
  api.post('/media/upload', async (req, res) => {
    const result = await change.run(() => withUpload(req, config.maxUploadBytes, file => change.upload(file.digest, () => az.upload(file))))
    auditMusicAction(res, 'upload', { mediaId: result.id })
    res.status(201).json(result)
  })
  api.get('/playlists', async (req, res) => {
    const { page } = validate(mediaQuery.pick({ page: true }), req.query)
    res.json(await az.listPlaylists(page))
  })
  api.param('id', (req, _res, next) => {
    if (validate(parameterId, req.params.id) !== station.playlist.id) throw new Problem(404, 'playlist_not_found', 'Only the main rotation is managed here.')
    next()
  })
  api.get('/playlists/:id', async (req, res) => {
    const { page } = validate(mediaQuery.pick({ page: true }), req.query)
    res.json(await az.playlist(page))
  })
  api.post('/playlists/:id/tracks', json, async (req, res) => {
    const { trackId: mediaId } = validate(z.strictObject({ trackId }), req.body)
    const result = await change.run(() => {
      change.checkRotation(mediaId)
      return az.setMembership(mediaId, true)
    })
    auditMusicAction(res, 'add_to_rotation', { mediaId, playlistId: station.playlist.id })
    res.json({ ...result, rotationVerified: true })
  })
  api.delete('/playlists/:id/tracks/:trackId', async (req, res) => {
    const mediaId = validate(parameterId, req.params.trackId)
    const result = await change.run(() => {
      change.checkRotation()
      return az.setMembership(mediaId, false)
    })
    auditMusicAction(res, 'remove_from_rotation', { mediaId, playlistId: station.playlist.id })
    res.json({ ...result, rotationVerified: true })
  })
  api.put('/playlists/:id/order', json, async (req, res) => {
    const body = validate(order, req.body)
    const result = await change.run(() => {
      change.checkRotation()
      return az.reorder(body.baseline, body.order)
    })
    auditMusicAction(res, 'save_rotation_order', { playlistId: station.playlist.id })
    res.json(result)
  })
  api.use((_req, _res, next) => next(new Problem(404, 'route_not_found', 'This operation is unavailable.')))
  app.use('/admin-api', api)

  app.use((req, res, next) => {
    if (safeMethod(req.method) && sharedRadio.test(req.path)) {
      relayRadio(config, req, res)
      return
    }
    next()
  })
  app.get(/^\/(?:admin(?:\/(?:login|library|upload|playlist|help))?|player|library|settings|broadcast|playlists|branches(?:\/[\w-]+)?)\/?$/, (_req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(join(config.frontendDir, 'index.html'))
  })
  app.use(express.static(config.frontendDir, { dotfiles: 'deny', index: 'index.html', redirect: false }))
  app.use((_req, res) => res.status(404).end())
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) { res.destroy(); return }
    const input = error as { type?: string }
    const problem = error instanceof Problem ? error
      : input.type === 'entity.too.large' ? new Problem(413, 'size', 'The request exceeds the size limit.')
      : input.type === 'entity.parse.failed' ? new Problem(400, 'json', 'Submit valid JSON.')
      : new Problem(500, 'internal_error', 'The request could not be completed.')
    if (!safeMethod(req.method) && !req.complete) res.set('Connection', 'close')
    if (!res.destroyed) res.status(problem.status).json({ code: problem.code, message: problem.message })
  })
  return app
}
