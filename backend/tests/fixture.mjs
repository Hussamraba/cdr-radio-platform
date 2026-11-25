import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { resolve } from 'node:path'
import { createAdminApp } from '../dist/app.js'
import { passwordHash } from '../dist/auth.js'
import { loadConfig } from '../dist/config.js'

export const username = 'test-operator'
export const password = 'fixture-passphrase-for-testing'
export const key = 'external-fixture-key-do-not-use'
export const externalError = 'upstream private internal detail ' + key
const hash = passwordHash(password)
const base = '/api/station/1'
const now = '/api/nowplaying/ghmaas_baladi_radio'
const stream = '/listen/ghmaas_baladi_radio/radio.mp3'

function audio(format, frequency) {
  return execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=' + frequency + ':duration=1.1', '-f', format, 'pipe:1'])
}
export const mp3 = audio('mp3', 440)
export const wav = audio('wav', 660)
export const legacyMp3 = audio('mp3', 620)
const membership = id => ({ id, name: id === 2 ? 'Ghmaas Main Rotation' : 'Other Playlist', folder: null, count: 1 })
const standardFiles = [
  { id: 10, title: 'Opening Song', artist: 'Station Artist', path: 'opening.mp3', length: 181, playlists: [membership(2)] },
  { id: 11, title: 'Second Song', artist: 'Second Artist', path: 'second.wav', length: 205, playlists: [membership(2), membership(1)] },
  { id: 12, title: 'Ready Song', artist: 'Another Artist', path: 'waiting.mp3', length: 180, playlists: [membership(1)] },
  { id: 13, title: 'Folder Song', artist: null, path: 'folder.mp3', length: 90, playlists: [{ ...membership(2), folder: 'music' }] },
]
async function startServer(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return new URL('http://127.0.0.1:' + server.address().port)
}
async function closeServer(server) {
  if (!server.listening) return
  const closed = once(server, 'close')
  server.close()
  server.closeAllConnections()
  await closed
}
function respond(res, status, data) {
  if (!res.destroyed) res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data))
}
async function requestBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks))
}
export async function fixture(overrides = {}, management = { ADMIN_MANAGEMENT_MODE: 'persistent' }) {
  const state = {
    files: standardFiles.map(file => ({ ...structuredClone(file), size: file.id === 10 ? legacyMp3.length : 50_000 })),
    mediaBytes: new Map([['opening.mp3', legacyMp3]]), order: [[501, 10, 1], [503, 11, 2], [505, 13, 3]], mode: 'sequential',
    requests: [], uploads: [], writes: [], failures: new Map(), logs: [], routeErrors: [],
  }
  let nextMedia = 60
  let nextEntry = 550
  const upstream = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname
      const method = req.method
      state.requests.push({ path, method, key: req.headers['x-api-key'], query: Object.fromEntries(url.searchParams) })
      const failure = state.failures.get(method + ' ' + path)
      if (failure) { await failure(req, res); return }
      if (path === now) {
        assert.equal(req.headers['x-api-key'], undefined)
        respond(res, 200, {
          station: { id: 1, shortcode: 'ghmaas_baladi_radio', name: 'Ghmaas Baladi Radio' },
          is_online: true, listeners: { current: 4 }, now_playing: { song: { title: 'Opening Song' }, playlist: 'Ghmaas Main Rotation' },
          playing_next: { song: { title: 'Second Song' }, playlist: 'Ghmaas Main Rotation' }, song_history: [],
        })
        return
      }
      if (path === stream) {
        res.writeHead(200, { 'content-type': 'audio/mpeg' }).end(mp3)
        return
      }
      assert.equal(req.headers['x-api-key'], key)
      assert(path.startsWith(base + '/'))
      const rotation = { id: 2, name: 'Ghmaas Main Rotation', order: state.mode, source: 'songs', type: 'default', is_enabled: true, schedule_items: [] }
      if (path === base + '/playlist/2' && method === 'GET') {
        respond(res, 200, rotation)
      } else if (path === base + '/playlists' && method === 'GET') {
        respond(res, 200, { page: 1, total: 2, total_pages: 1, rows: [{ ...rotation, id: 1, name: 'Other Playlist', order: 'shuffle' }, rotation] })
      } else if (path === base + '/playlist/2/order' && method === 'GET') {
        respond(res, 200, state.order.map(([id, mediaId, weight]) => ({ id, weight, media: state.files.find(file => file.id === mediaId) })))
      } else if (path === base + '/playlist/2/order' && method === 'PUT') {
        const { order } = await requestBody(req)
        state.writes.push({ operation: 'order', order })
        state.order = state.order.map(([id, mediaId, weight]) => [id, mediaId, order[id] ?? weight]).sort((a, b) => a[2] - b[2])
        respond(res, 200, order)
      } else if ((path === base + '/files' || path === base + '/files/list') && method === 'GET') {
        const q = url.searchParams.get('searchPhrase') ?? ''
        const page = Number(url.searchParams.get('page') ?? '1')
        const per = Number(url.searchParams.get('per_page') ?? '25')
        const inRotation = path.endsWith('/list') && q.startsWith('playlist:2')
        const search = inRotation ? q.slice('playlist:2'.length).trim() : q
        const matches = state.files.filter(file => [file.title, file.path, file.artist].some(value => value?.toLowerCase().includes(search.toLowerCase())))
        const files = inRotation ? matches.filter(file => file.playlists.some(list => list.id === 2)).map(media => ({ media })) : matches
        respond(res, 200, { page, total: files.length, total_pages: Math.max(1, Math.ceil(files.length / per)), rows: files.slice((page - 1) * per, page * per) })
      } else if (path === base + '/files/download' && method === 'GET') {
        const bytes = state.mediaBytes.get(url.searchParams.get('file'))
        assert(bytes, 'Download must target an indexed fixture file')
        res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(bytes)
      } else if (path === base + '/files' && method === 'POST') {
        assert.equal(req.headers['content-type'], 'application/json')
        assert(req.headers['content-length'])
        const body = await requestBody(req)
        const bytes = Buffer.from(body.file, 'base64')
        assert.match(body.path, /^cdr-[a-f0-9]{64}-[a-z0-9-]+\.(mp3|wav)$/)
        state.uploads.push({ bytes, path: body.path })
        const result = { id: nextMedia++, title: body.path.endsWith('.mp3') ? 'CDR Test Track A' : 'CDR WAV Track', artist: 'Fixture Artist', path: body.path, size: bytes.length, length: 1.1, playlists: [] }
        state.mediaBytes.set(body.path, bytes)
        state.files.push(result)
        respond(res, 200, result)
      } else if (/^\/api\/station\/1\/file\/[0-9]+$/.test(path)) {
        const target = state.files.find(file => file.id === Number(path.split('/').at(-1)))
        if (!target) return respond(res, 404, { message: externalError })
        if (method === 'GET') return respond(res, 200, target)
        assert.equal(method, 'PUT')
        const body = await requestBody(req)
        assert.deepEqual(Object.keys(body), ['playlists'])
        state.writes.push({ operation: 'membership', track: target.id, ids: body.playlists })
        const prior = target.playlists
        target.playlists = body.playlists.map(id => prior.find(item => item.id === id) ?? membership(id))
        const hasMain = target.playlists.some(item => item.id === 2)
        if (hasMain && !state.order.some(([, id]) => id === target.id)) {
          state.order.push([nextEntry++, target.id, Math.max(0, ...state.order.map(row => row[2])) + 1])
        }
        if (!hasMain) state.order = state.order.filter(([, id]) => id !== target.id)
        respond(res, 200, { success: true })
      } else {
        throw new Error('Unexpected upstream operation ' + method + ' ' + path)
      }
    } catch (error) {
      state.routeErrors.push(error)
      respond(res, 500, { message: externalError })
    }
  })
  const defaults = loadConfig({ AZURACAST_API_KEY: key, ADMIN_USERNAME: username, ADMIN_PASSWORD_HASH: await hash, ...management })
  const upstreamOrigin = await startServer(upstream)
  const config = {
    ...defaults, origin: new URL('http://127.0.0.1'), azuraOrigin: upstreamOrigin, radioOrigin: upstreamOrigin,
    maxUploadBytes: 1024 ** 2,
    sessionMs: 60_000, upstreamMs: 1200, uploadMs: 3000,
    frontendDir: resolve(import.meta.dirname, '../../frontend/dist-admin'), ...overrides,
  }
  const server = createServer(createAdminApp(config, event => state.logs.push(event)))
  const listen = await startServer(server)
  config.origin.port = listen.port
  return { state, config, origin: listen.origin, upstream,
    close: async () => {
      await closeServer(server)
      await closeServer(upstream)
      assert.deepEqual(state.routeErrors, [])
    } }
}

export function api(app, path, { method = 'GET', session, csrf = session?.csrfToken, origin = app.config.origin.origin, body, filename, headers: proxyHeaders } = {}) {
  const headers = { ...proxyHeaders }
  if (session) headers.cookie = session.cookie
  if (csrf) headers['x-csrf-token'] = csrf
  if (origin) headers.origin = origin
  if (filename) {
    headers['x-file-name'] = encodeURIComponent(filename)
    headers['content-type'] = 'application/octet-stream'
  } else if (body) {
    headers['content-type'] = 'application/json'
    body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  const url = app.origin + '/admin-api' + path
  const signal = AbortSignal.timeout(10000)
  if (!headers.Host) return fetch(url, { method, headers, body, signal })
  // Fetch overrides Host. Exercise Serve's Unix-socket Host using the HTTP client.
  return new Promise((resolve, reject) => {
    const client = request(url, { method, headers, signal }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve(new Response(response.statusCode === 204 ? null : Buffer.concat(chunks), {
        status: response.statusCode, headers: response.headers,
      })))
      response.on('error', reject)
    })
    client.on('error', reject)
    client.end(body)
  })
}
export async function signIn(app, supplied = password) {
  const response = await api(app, '/auth/login', { method: 'POST', body: { username, password: supplied } })
  if (!response.ok) return { response }
  const cookie = response.headers.get('set-cookie')
  return { response, cookie: cookie.split(';')[0], cookieSettings: cookie, ...await response.json() }
}
