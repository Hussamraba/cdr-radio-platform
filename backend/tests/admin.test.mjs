import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { EventEmitter, once } from 'node:events'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig } from '../dist/config.js'
import { api, externalError, fixture, key, legacyMp3, mp3, password, signIn, wav } from './fixture.mjs'

const write = (app, path, session, method, body) => api(app, path, { method, session, body })
const upload = (app, session, filename, bytes) => api(app, '/media/upload', { method: 'POST', session, filename, body: bytes })

test('sessions deny unauthenticated reads and writes, enforce Origin and CSRF, and invalidate logout', async t => {
  const app = await fixture()
  t.after(app.close)
  for (const [path, method] of [['/media', 'GET'], ['/media/upload', 'POST'], ['/playlists/2/order', 'PUT'], ['/playlists/2/tracks', 'POST']]) {
    assert.equal((await api(app, path, { method })).status, 401)
  }
  assert.equal(app.state.requests.length, 0)
  assert.equal((await api(app, '/auth/login', { method: 'POST', origin: 'https://untrusted.test', body: { username: 'test-operator', password } })).status, 403)
  assert.equal((await api(app, '/auth/login', { method: 'POST', body: '{bad' })).status, 400)
  const session = await signIn(app)
  assert.equal(session.response.status, 200)
  assert.equal(session.response.headers.get('cache-control'), 'no-store')
  assert.match(session.cookieSettings, /HttpOnly/)
  assert.match(session.cookieSettings, /SameSite=Strict/)
  assert.match(session.cookieSettings, /Path=\/admin-api/)
  assert.doesNotMatch(session.cookieSettings, /Secure/)
  assert.equal((await api(app, '/auth/me', { session })).status, 200)
  const wrongHost = await new Promise((resolve, reject) => {
    get(app.origin + '/admin-api/auth/me', { headers: { host: 'untrusted.test', cookie: session.cookie } }, response => {
      response.resume()
      resolve(response.statusCode)
    }).on('error', reject)
  })
  assert.equal(wrongHost, 404)
  assert.equal((await api(app, '/playlists/2/tracks', { method: 'POST', session, csrf: '', body: { trackId: 12 } })).status, 403)
  assert.equal((await api(app, '/playlists/2/tracks', { method: 'POST', session, origin: 'https://untrusted.test', body: { trackId: 12 } })).status, 403)
  const signedOut = await write(app, '/auth/logout', session, 'POST')
  assert.equal(signedOut.status, 204)
  assert.match(signedOut.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal((await api(app, '/auth/me', { session })).status, 401)
  assert.equal(app.state.requests.length, 0)
})

test('session expiry, secure HTTPS cookies, and login attempt limits', async t => {
  const short = await fixture({ sessionMs: 30, origin: new URL('https://127.0.0.1') })
  t.after(short.close)
  const session = await signIn(short)
  assert.match(session.cookieSettings, /^__Host-ghmaas_admin=.*Path=\//)
  assert.match(session.cookieSettings, /Secure/)
  await wait(50)
  assert.equal((await api(short, '/auth/me', { session })).status, 401)
  const app = await fixture()
  t.after(app.close)
  for (let attempt = 0; attempt < 8; attempt++) assert.equal((await signIn(app, 'wrong-valid-length-password')).response.status, 401)
  const blocked = await signIn(app)
  assert.equal(blocked.response.status, 429)
  assert(Number(blocked.response.headers.get('retry-after')) > 0)
})

test('private mobile ingress requires the Serve identity, exact origin and a CSRF token', async t => {
  const app = await fixture({ origin: new URL('https://127.0.0.1'), tailnetLogin: 'operator@example.test' })
  t.after(app.close)
  const body = { username: 'test-operator', password }
  const fromServe = { Host: 'localhost', 'X-Forwarded-Host': app.config.origin.host, 'X-Forwarded-Proto': 'https' }
  const headers = { ...fromServe, 'Tailscale-User-Login': 'operator@example.test' }
  const login = extra => api(app, '/auth/login', { method: 'POST', body, ...extra })
  for (const identity of [{}, { 'Tailscale-User-Login': 'different@example.test' }]) {
    assert.equal((await login({ headers: { ...fromServe, ...identity } })).status, 403)
  }
  assert.equal((await login({ headers: { ...headers, 'X-Forwarded-Proto': 'http' } })).status, 404)
  assert.equal((await login({ headers: { ...headers, 'X-Forwarded-Host': 'public.example.test' } })).status, 404)
  assert.equal((await login({ headers, origin: 'https://public.example.test' })).status, 403)
  assert.equal((await api(app, '/media/upload', { method: 'POST', headers })).status, 401)
  const response = await login({ headers })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('strict-transport-security'), /^max-age=/)
  const cookie = response.headers.get('set-cookie')
  assert.match(cookie, /^__Host-ghmaas_admin=.*Path=\//)
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert(cookie.includes(attribute))
  assert(!cookie.includes('Domain='))
  const session = { ...await response.json(), cookie: cookie.split(';', 1)[0] }
  assert.equal((await api(app, '/auth/me', { headers, session })).status, 200)
  assert.equal((await api(app, '/auth/me', { headers: fromServe, session })).status, 403)
  const noCsrf = await api(app, '/media/upload', { headers, session, method: 'POST', csrf: '' })
  assert.equal(noCsrf.status, 403)
  assert.equal((await noCsrf.json()).code, 'csrf')
  assert.equal((await api(app, '/auth/logout', { headers, session, method: 'POST' })).status, 204)
  assert.equal((await api(app, '/auth/me', { headers, session })).status, 401)
  assert.deepEqual(app.state.uploads, [])
})

test('read-only instance permits reads and blocks authenticated mutations before forwarding', async t => {
  const app = await fixture({}, {})
  t.after(app.close)
  const session = await signIn(app)
  assert.equal(session.canWrite, false)
  assert.equal(session.managementMode, 'read-only')
  assert.equal((await api(app, '/media', { session })).status, 200)
  for (const [path, method, body] of [
    ['/playlists/2/tracks', 'POST', { trackId: 12 }], ['/playlists/2/tracks/10', 'DELETE'],
    ['/playlists/2/order', 'PUT', { baseline: [], order: [] }], ['/media/upload', 'POST'],
  ]) {
    const response = await write(app, path, session, method, body)
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'writes_disabled')
  }
  assert.deepEqual(app.state.writes, [])
  assert.deepEqual(app.state.uploads, [])
})

test('persistent management requires its explicit setting and recreating the admin still requires a fresh login', async t => {
  const saved = { ADMIN_MANAGEMENT_MODE: 'persistent' }
  const first = await fixture({}, saved)
  t.after(first.close)
  const session = await signIn(first)
  assert.equal(session.managementMode, 'persistent')
  assert.equal(session.canWrite, true)
  assert.equal(session.uploadWindowEndsAt, undefined)
  await first.close()

  const restarted = await fixture({}, saved)
  t.after(restarted.close)
  assert.equal((await api(restarted, '/auth/me', { session })).status, 401)
  assert.equal((await upload(restarted, session, 'approved.mp3', mp3)).status, 401)
  const operator = await signIn(restarted)
  assert.equal(operator.managementMode, 'persistent')
  assert.equal(operator.canWrite, true)
  const result = await upload(restarted, operator, 'approved.mp3', mp3)
  assert.equal(result.status, 201)
  const uploaded = await result.json()
  assert.deepEqual(uploaded.playlists, [])
  assert(restarted.state.logs.some(event => event.event === 'music_action_verified' && event.action === 'upload'
    && event.managementMode === 'persistent' && event.mediaId === uploaded.id && event.requestId === result.headers.get('x-request-id')))

  const env = { AZURACAST_API_KEY: key, ADMIN_USERNAME: restarted.config.username, ADMIN_PASSWORD_HASH: restarted.config.passwordHash }
  assert.equal(loadConfig(env).allowWrites, false)
  assert.equal(loadConfig({ ...env, ...saved }).allowWrites, true)
  assert.throws(() => loadConfig({ ...env, ADMIN_ALLOW_WRITES: 'true' }), /SHA-256 and a write deadline/)
  assert.throws(() => loadConfig({ ...env, ADMIN_MANAGEMENT_MODE: 'unknown' }), /must be read-only or persistent/)
  assert.throws(() => loadConfig({ ...env, ...saved, ADMIN_ALLOW_WRITES: 'true' }), /mutually exclusive/)
  assert.throws(() => loadConfig({ ...env, ...saved, ADMIN_APPROVED_UPLOAD_SHA256: '0'.repeat(64) }), /mutually exclusive/)
})

test('approved window accepts one exact file and its assignment and closes at the deadline', async t => {
  const app = await fixture({}, {
    ADMIN_ALLOW_WRITES: 'true', ADMIN_APPROVED_UPLOAD_SHA256: createHash('sha256').update(mp3).digest('hex'),
    ADMIN_WRITE_WINDOW_EXPIRES_AT: String(Date.now() + 60_000),
  })
  t.after(app.close)
  const { uploadWindow } = app.config
  const session = await signIn(app)
  assert.equal(session.canWrite, true)
  assert.equal(session.managementMode, 'approved-upload')
  assert.equal(session.uploadWindowEndsAt, uploadWindow.expiresAt)
  const baseline = structuredClone(app.state.order)
  async function denied(response, code) {
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, code)
  }
  await denied(await upload(app, session, 'different.wav', wav), 'upload_approval')
  await denied(await write(app, '/playlists/2/tracks', session, 'POST', { trackId: 12 }), 'rotation_approval')
  await denied(await write(app, '/playlists/2/tracks/10', session, 'DELETE'), 'rotation_approval')
  await denied(await write(app, '/playlists/2/order', session, 'PUT', { baseline: [], order: [] }), 'rotation_approval')
  assert.equal(app.state.requests.length, 0)

  const uploaded = await upload(app, session, 'approved.mp3', mp3)
  assert.equal(uploaded.status, 201)
  const file = await uploaded.json()
  assert.deepEqual(file.playlists, [])
  await denied(await upload(app, session, 'approved.mp3', mp3), 'upload_approval')
  const assignment = await write(app, '/playlists/2/tracks', session, 'POST', { trackId: file.id })
  assert.equal(assignment.status, 200)
  assert.deepEqual((await assignment.json()).playlists.map(row => row.id), [2])
  assert.deepEqual(app.state.order.slice(0, -1), baseline)
  assert.equal(app.state.order.at(-1)[1], file.id)
  assert.equal(app.state.uploads.length, 1)

  uploadWindow.expiresAt = Date.now() - 1
  await denied(await upload(app, session, 'approved.mp3', mp3), 'writes_disabled')
  await denied(await write(app, '/playlists/2/tracks', session, 'POST', { trackId: file.id }), 'writes_disabled')
  assert.equal((await api(app, '/auth/me', { session }).then(response => response.json())).canWrite, false)
})

test('media pagination, station scope, catalog-only upload, verification, duplicate and size limits', async t => {
  const app = await fixture()
  t.after(app.close)
  const session = await signIn(app)
  const station = await api(app, '/station', { session }).then(response => response.json())
  assert.equal(station.online, true)
  assert.equal(station.listeners, 4)
  assert.equal(station.current.title, 'Opening Song')
  assert.equal(station.rotation.mode, 'sequential')
  const catalog = await api(app, '/media?q=Ready&page=1', { session }).then(response => response.json())
  assert.deepEqual(catalog.rows.map(row => row.id), [12])
  const scoped = await api(app, '/media?q=Song&scope=rotation', { session }).then(response => response.json())
  assert.deepEqual(scoped.rows.map(row => row.id), [10, 11, 13])
  assert.equal((await api(app, '/media?q=playlist%3A3&scope=rotation', { session })).status, 400)
  assert.equal((await api(app, '/media?station=20', { session })).status, 400)
  assert.equal((await api(app, '/playlists/999', { session })).status, 404)
  assert.equal((await upload(app, session, '../forbidden.mp3', mp3)).status, 400)
  assert.equal((await upload(app, session, 'false.mp3', Buffer.from('not an audio file'))).status, 422)
  assert.equal((await upload(app, session, 'false.wav', mp3)).status, 422)
  assert.equal((await upload(app, session, 'too-big.mp3', Buffer.alloc(app.config.maxUploadBytes + 1))).status, 413)
  const missingCsrf = await api(app, '/media/upload', { method: 'POST', session, csrf: '', filename: 'valid.mp3', body: mp3 })
  assert.equal(missingCsrf.status, 403)
  const legacyDuplicate = await upload(app, session, 'different-name.mp3', legacyMp3)
  assert.equal(legacyDuplicate.status, 409)
  assert.equal((await legacyDuplicate.json()).code, 'duplicate_audio')
  assert(app.state.requests.some(record => record.path === '/api/station/1/files/download' && record.query.file === 'opening.mp3'))
  assert.deepEqual(app.state.uploads, [])
  for (const [name, bytes] of [['CDR Test Track A.mp3', mp3], ['CDR Wav.wav', wav]]) {
    const response = await upload(app, session, name, bytes)
    assert.equal(response.status, 201, await response.clone().text())
    const result = await response.json()
    assert.deepEqual(result.playlists, [])
    assert.deepEqual(app.state.uploads.at(-1).bytes, bytes)
    assert.equal(app.state.requests.at(-1).path, '/api/station/1/file/' + result.id)
  }
  const duplicate = await upload(app, session, 'renamed.mp3', mp3)
  assert.equal(duplicate.status, 409)
  assert.equal((await duplicate.json()).code, 'duplicate_audio')
  assert.equal(app.state.uploads.length, 2)
  assert(app.state.requests.filter(record => record.path.startsWith('/api/station/')).every(record => record.key === key && record.path.startsWith('/api/station/1/')))
  assert(app.state.requests.filter(record => record.path.startsWith('/api/nowplaying/')).every(record => record.key === undefined))
})

test('membership preserves other playlists, protects folders, and validates order against live entry IDs', async t => {
  const app = await fixture()
  t.after(app.close)
  const session = await signIn(app)
  assert.equal((await write(app, '/playlists/2/tracks', session, 'POST', { trackId: 12, station: 999 })).status, 400)
  assert.equal((await write(app, '/playlists/2/tracks', session, 'POST', { trackId: 999 })).status, 404)
  assert.equal((await write(app, '/playlists/2/tracks/13', session, 'DELETE')).status, 409)
  const assigned = await write(app, '/playlists/2/tracks', session, 'POST', { trackId: 12 })
  assert.equal(assigned.status, 200)
  assert.deepEqual((await assigned.json()).playlists.map(item => item.id), [1, 2])
  assert.equal((await write(app, '/playlists/2/tracks', session, 'POST', { trackId: 12 })).status, 200)
  assert.equal(app.state.writes.length, 1)
  const rotation = await api(app, '/playlists/2', { session }).then(response => response.json())
  assert.equal(rotation.activePlaylist, 'Ghmaas Main Rotation')
  const playlists = await api(app, '/playlists', { session }).then(response => response.json())
  assert.deepEqual(playlists.rows.map(({ id, managed }) => [id, managed]), [[1, false], [2, true]])
  const baseline = rotation.tracks.map(track => track.entryId)
  assert.deepEqual(baseline, [501, 503, 505, 550])
  assert.equal((await write(app, '/playlists/2/order', session, 'PUT', { baseline: [...baseline].reverse(), order: baseline })).status, 409)
  assert.equal((await write(app, '/playlists/2/order', session, 'PUT', { baseline, order: [501, 501, 505, 550] })).status, 422)
  assert.equal((await write(app, '/playlists/2/order', session, 'PUT', { baseline, order: [10, 11, 13, 12] })).status, 422)
  const desired = [550, 501, 503, 505]
  const saved = await write(app, '/playlists/2/order', session, 'PUT', { baseline, order: desired })
  assert.equal(saved.status, 200)
  assert.deepEqual((await saved.json()).tracks.map(track => track.entryId), desired)
  assert.deepEqual(app.state.writes[1].order, { 550: 1, 501: 2, 503: 3, 505: 4 })
  const removed = await write(app, '/playlists/2/tracks/12', session, 'DELETE')
  assert.equal(removed.status, 200)
  assert.deepEqual((await removed.json()).playlists.map(row => row.id), [1])
  app.state.mode = 'shuffle'
  const shuffled = await api(app, '/playlists/2', { session }).then(response => response.json())
  assert.equal(shuffled.editableOrder, false)
  assert.deepEqual(shuffled.tracks.map(track => track.id), [10, 11, 13])
  assert.equal((await write(app, '/playlists/2/order', session, 'PUT', { baseline, order: desired })).status, 409)
})

test('assignment requires both AzuraCast views to agree and preserves all eight existing rows', async t => {
  const app = await fixture()
  t.after(app.close)
  for (let index = 0; index < 5; index++) {
    const id = 20 + index
    app.state.files.push({ ...structuredClone(app.state.files[0]), id, path: `extra-${id}.mp3` })
    app.state.order.push([510 + index, id, 4 + index])
  }
  const baseline = structuredClone(app.state.order)
  const target = app.state.files.find(track => track.id === 12)
  const priorMemberships = structuredClone(target.playlists)
  const session = await signIn(app)
  const assign = (id = 2) => write(app, `/playlists/${id}/tracks`, session, 'POST', { trackId: 12 })
  const method = 'PUT /api/station/1/file/12'
  const attempts = () => app.state.requests.filter(row => row.method + ' ' + row.path === method).length
  const pretendSuccess = (_req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"success":true}')
  const assertFailedVerification = async () => {
    const response = await assign()
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'membership_verification')
    assert.deepEqual(app.state.order, baseline)
    assert(!app.state.logs.some(row => row.action === 'add_to_rotation'))
  }
  assert.equal((await assign(1)).status, 404)
  assert.equal(app.state.requests.length, 0)
  app.state.failures.set(method, pretendSuccess)
  await assertFailedVerification()
  app.state.failures.set(method, (req, res) => {
    target.playlists.push(structuredClone(app.state.files[0].playlists[0]))
    pretendSuccess(req, res)
  })
  await assertFailedVerification()
  await assertFailedVerification()
  assert.equal(attempts(), 2, 'a conflicting preflight must not send a second write')
  target.playlists = priorMemberships
  app.state.failures.set(method, (_req, res) => res.writeHead(503).end())
  const upstreamFailure = await assign()
  assert.equal(upstreamFailure.status, 503)
  assert.equal((await upstreamFailure.json()).code, 'azuracast_unavailable')
  assert.deepEqual(app.state.order, baseline)

  app.state.failures.delete(method)
  const assignment = await assign()
  assert.equal(assignment.status, 200)
  assert.equal((await assignment.json()).rotationVerified, true)
  assert.deepEqual(app.state.order.slice(0, -1), baseline)
  assert.equal(app.state.order.at(-1)[1], 12)
  assert.equal((await assign()).status, 200)
  assert.equal(attempts(), 4)

  app.state.mode = 'shuffle'
  const removed = await write(app, '/playlists/2/tracks/12', session, 'DELETE')
  assert.equal(removed.status, 200)
  assert.equal((await removed.json()).rotationVerified, true)
  assert.deepEqual(app.state.order, baseline)
})

test('sequential append accepts tied-weight permutations and rejects other rotation changes', async t => {
  const scenarios = [
    ['equal-weight entries reverse', rows => [
      ...rows.slice(0, 2), ...rows.slice(2, -1).reverse(), rows.at(-1),
    ], 200],
    ['an unrelated entry is missing', rows => rows.slice(1), 409, 'rotation_order_changed'],
    ['an existing weight changes', rows => [[...rows[0].slice(0, 2), 2], ...rows.slice(1)], 409, 'rotation_order_changed'],
    ['an existing entry points to different media', rows => [[rows[0][0], 11, rows[0][2]], ...rows.slice(1)], 409, 'rotation_order_changed'],
    ['different weight groups swap', rows => [rows[1], rows[0], ...rows.slice(2)], 409, 'rotation_order_changed'],
    ['an entry ID is duplicated', rows => [...rows, rows[0]], 502, 'upstream_shape'],
    ['the new media has two entries', rows => [...rows, [999, 12, 5]], 409, 'membership_verification'],
    ['the new entry weight ties the old maximum', rows => [
      ...rows.slice(0, -1), [...rows.at(-1).slice(0, 2), 3],
    ], 409, 'rotation_order_changed'],
    ['the new entry is not returned last', rows => [rows.at(-1), ...rows.slice(0, -1)], 409, 'rotation_order_changed'],
  ]

  for (const [name, changeReadBack, status, code] of scenarios) {
    await t.test(name, async subtest => {
      const app = await fixture()
      subtest.after(app.close)
      for (const id of [20, 21, 22, 23]) {
        app.state.files.push({ ...structuredClone(app.state.files[0]), id, path: `tied-${id}.mp3` })
        app.state.order.push([500 + id, id, 3])
      }
      const orderPath = '/api/station/1/playlist/2/order'
      const filePath = '/api/station/1/file/12'
      app.state.failures.set('GET ' + orderPath, (_req, res) => {
        const rows = app.state.writes.length ? changeReadBack(app.state.order) : app.state.order
        const order = rows.map(([id, mediaId, weight]) => ({
          id, weight, media: app.state.files.find(track => track.id === mediaId),
        }))
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(order))
      })

      const session = await signIn(app)
      const assign = () => write(app, '/playlists/2/tracks', session, 'POST', { trackId: 12 })
      const response = await assign()
      assert.equal(response.status, status)
      const result = await response.json()
      assert.deepEqual(app.state.writes, [{ operation: 'membership', track: 12, ids: [1, 2] }])
      const put = app.state.requests.findIndex(row => row.method === 'PUT' && row.path === filePath)
      assert(put > 0)
      assert.deepEqual(app.state.requests.slice(put + 1).map(row => row.method + ' ' + row.path).sort(),
        ['GET ' + filePath, 'GET ' + orderPath].sort())
      if (status !== 200) {
        assert.equal(result.code, code)
        assert(!app.state.logs.some(event => event.action === 'add_to_rotation'))
        return
      }

      assert.equal(result.rotationVerified, true)
      assert.deepEqual(result.playlists.map(item => item.id), [1, 2])
      const repeated = await assign()
      assert.equal(repeated.status, 200)
      assert.equal((await repeated.json()).rotationVerified, true)
      assert.equal(app.state.writes.length, 1)

      app.state.order.push([999, 12, 5])
      const duplicate = await assign()
      assert.equal(duplicate.status, 409)
      assert.equal((await duplicate.json()).code, 'membership_verification')
      assert.equal(app.state.writes.length, 1)
    })
  }
})

test('upstream errors, timeouts, redirects and network failure are sanitized and writes are never retried', async t => {
  const app = await fixture({ upstreamMs: 120 })
  t.after(app.close)
  const session = await signIn(app)
  const path = 'GET /api/station/1/files'
  for (const [upstreamStatus, expected] of [[401, 403], [403, 403], [503, 503], [500, 502], [307, 502]]) {
    app.state.failures.set(path, (_req, res) => res.writeHead(upstreamStatus, { Location: 'http://127.0.0.1:2/' }).end(externalError))
    const response = await api(app, '/media', { session })
    assert.equal(response.status, expected)
    assert.doesNotMatch(await response.text(), /upstream private|external-fixture-key/)
  }
  app.state.failures.set(path, async (_req, res) => { await wait(400); res.end(externalError) })
  const timeout = await api(app, '/media', { session })
  assert.equal(timeout.status, 504)
  assert.doesNotMatch(await timeout.text(), /upstream private|external-fixture-key/)
  app.state.failures.delete(path)
  const mutation = 'POST /api/station/1/files'
  app.state.failures.set(mutation, (_req, res) => res.writeHead(500).end(externalError))
  assert.equal((await upload(app, session, 'can-retry.mp3', mp3)).status, 502)
  assert.equal(app.state.requests.filter(row => row.method + ' ' + row.path === mutation).length, 1)
  await new Promise(resolve => { app.upstream.close(resolve); app.upstream.closeAllConnections() })
  const unavailable = await api(app, '/media', { session })
  assert.equal(unavailable.status, 503)
  assert.doesNotMatch(JSON.stringify(app.state.logs) + await unavailable.text(), /upstream private|external-fixture-key|fixture-passphrase/)
})

test('bounded upload scratch is cleaned and another mutation cannot overtake an upload', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ghmaas-test-scratch-'))
  const previous = process.env.TMPDIR
  process.env.TMPDIR = temp
  t.after(async () => {
    if (previous === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous
    await rm(temp, { recursive: true, force: true })
  })
  const app = await fixture()
  t.after(app.close)
  const session = await signIn(app)
  assert.equal((await upload(app, session, 'bad.mp3', Buffer.from('invalid file'))).status, 422)
  assert.deepEqual(await readdir(temp), [])

  const blocker = new EventEmitter()
  const started = once(blocker, 'started')
  let release
  app.state.failures.set('POST /api/station/1/files', (req, res) => new Promise(resolve => {
    req.resume()
    release = () => { res.writeHead(500).end(); resolve() }
    blocker.emit('started')
  }))
  const inFlight = upload(app, session, 'real-audio.mp3', mp3)
  await started
  try {
    const conflict = await write(app, '/playlists/2/tracks', session, 'POST', { trackId: 12 })
    assert.equal(conflict.status, 409)
    assert.equal((await conflict.json()).code, 'change_in_progress')
    assert.equal((await readdir(temp)).length, 1)
    assert.equal(app.state.writes.length, 0)
  } finally { release() }
  assert.equal((await inFlight).status, 502)
  assert.deepEqual(await readdir(temp), [])
})
