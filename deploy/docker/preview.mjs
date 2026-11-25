import { request } from 'node:http'
import { resolve } from 'node:path'
import { pipeline } from 'node:stream'
import express from 'express'

const app = express()
const root = '/srv'
const azura = 'http://azuracast'
const preview = 'http://127.0.0.1:18088'
const station = 'ghmaas_baladi_radio'
const stream = '/listen/' + station + '/radio.mp3'
const metadata = '/api/nowplaying/' + station
const artwork = /^\/(?:api\/station\/(?:ghmaas_baladi_radio|1)\/art\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?|static\/vite_dist\/assets\/generic_song-[A-Za-z0-9_-]+\.jpg)$/
const fallback = /^\/static\/vite_dist\/assets\/generic_song-[A-Za-z0-9_-]+\.jpg$/

app.disable('x-powered-by')
app.use((req, res, next) => {
  if (req.hostname !== '127.0.0.1' && req.hostname !== 'frontend') return res.status(404).end()
  res.set({
    'Content-Security-Policy': "connect-src 'self'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end()
  next()
})

function mediaPath(value) {
  if (typeof value !== 'string') return ''
  try { return new URL(value, preview).pathname }
  catch { return '' }
}

app.get('/healthz', (_req, res) => res.status(204).end())
app.get(metadata, async (_req, res) => {
  try {
    const response = await fetch(azura + metadata, { signal: AbortSignal.timeout(5000), redirect: 'manual' })
    if (!response.ok) {
      await response.body?.cancel()
      console.warn('Now Playing upstream HTTP ' + response.status)
      return res.status(502).end()
    }
    const data = await response.json()
    if (data.station?.id !== 1 || data.station.shortcode !== station) {
      console.warn('Now Playing upstream response did not match station 1')
      return res.status(502).end()
    }
    // The station cache may contain absolute URLs generated for other listeners.
    const history = Array.isArray(data.song_history) ? data.song_history : []
    for (const track of [data.now_playing, data.playing_next, ...history]) {
      if (!track?.song) continue
      const path = mediaPath(track.song.art)
      track.song.art = artwork.test(path) ? preview + path : null
    }
    const approvedSources = list => (Array.isArray(list) ? list : []).filter(entry => mediaPath(entry?.url) === stream)
      .map(entry => ({ ...entry, url: preview + stream }))
    data.station = {
      ...data.station, listen_url: preview + stream, public_player_url: preview + '/player', hls_url: null,
      playlist_m3u_url: preview + '/public/' + station + '/playlist.m3u',
      playlist_pls_url: preview + '/public/' + station + '/playlist.pls',
      mounts: approvedSources(data.station.mounts), remotes: approvedSources(data.station.remotes),
    }
    res.set('Cache-Control', 'no-store').json(data)
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'invalid JSON' : 'network or response error'
    console.warn('Now Playing upstream failed: ' + reason)
    res.status(502).end()
  }
})

app.use((req, res, next) => {
  if (req.path !== stream && !artwork.test(req.path)) return next()
  const upstreamHeaders = {}
  for (const name of ['range', 'if-range']) {
    if (req.get(name)) upstreamHeaders[name] = req.get(name)
  }
  const upstream = request(azura + req.path, { method: req.method, headers: upstreamHeaders }, response => {
    clearTimeout(timer)
    const code = response.statusCode ?? 502
    if (code >= 300 && code < 400) {
      response.resume()
      const location = mediaPath(response.headers.location)
      if (fallback.test(location) && artwork.test(req.path)) return res.redirect(302, location)
      return res.status(502).end()
    }
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      if (response.headers[name] !== undefined) res.set(name, response.headers[name])
    }
    res.status(code).set('Cache-Control', 'no-store')
    pipeline(response, res, () => {})
  })
  const timer = setTimeout(() => upstream.destroy(), 5000)
  upstream.on('error', () => {
    clearTimeout(timer)
    if (!res.headersSent && !res.destroyed) res.status(502).end()
  })
  res.on('close', () => upstream.destroy())
  upstream.end()
})

const published = '/public/' + station
app.get(published, (_req, res) => res.redirect(302, '/player'))
app.get(published + '/playlist.m3u', (_req, res) => {
  res.type('audio/x-mpegurl').send('#EXTM3U\n' + preview + stream + '\n')
})
app.get(published + '/playlist.pls', (_req, res) => {
  res.type('audio/x-scpls').send('[playlist]\nNumberOfEntries=1\nFile1=' + preview + stream + '\nLength1=-1\nVersion=2\n')
})
app.use('/assets', express.static(root + '/assets', { index: false, redirect: false, dotfiles: 'deny', immutable: true, maxAge: '1y' }))
app.get(['/images.jpg', '/favicon.svg', '/icons.svg'], (req, res) => {
  res.sendFile(resolve(root, '.' + req.path))
})
app.get(/^\/(?:|(?:player|broadcast|library|playlists|settings)\/?|branches(?:\/[A-Za-z0-9_-]+)?\/?)$/, (_req, res) => {
  res.set('Cache-Control', 'no-cache').sendFile(root + '/index.html')
})
app.use((_req, res) => res.status(404).end())
app.use((_error, _req, res, _next) => {
  if (res.headersSent) return res.destroy()
  res.status(404).end()
})

const server = app.listen(8080, '0.0.0.0', () => console.info('Public preview listening on container port 8080'))
server.headersTimeout = 10_000
server.requestTimeout = 10_000
function shutdown() {
  server.close()
  setTimeout(() => server.closeAllConnections(), 5000).unref()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
