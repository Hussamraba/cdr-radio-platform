import assert from 'node:assert/strict'
import dns from 'node:dns'
import { isIPv4 } from 'node:net'

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8088')
assert(base.protocol === 'https:' || ['http://127.0.0.1:8088', 'http://127.0.0.1:18088'].includes(base.origin), 'Use a local demo endpoint or an HTTPS demo origin')
assert(base.pathname === '/' && !base.username && !base.password && !base.search && !base.hash, 'Pass only the demo origin')
const pinned = process.env.PUBLIC_FUNNEL_IP
if (pinned) {
  assert(base.protocol === 'https:' && isIPv4(pinned), 'Use a public Funnel IPv4 address with the HTTPS origin.')
  // Keep the HTTPS hostname for SNI and certificate validation when MagicDNS resolves it locally.
  const lookup = dns.lookup
  dns.lookup = (host, ...options) => lookup(host === base.hostname ? pinned : host, ...options)
}

const station = 'ghmaas_baladi_radio'
const metadataPath = `/api/nowplaying/${station}`
const streamPath = `/listen/${station}/radio.mp3`

function sameOrigin(value, label) {
  assert(typeof value === 'string' && value.length, `${label} must provide a URL`)
  const url = new URL(value, base)
  assert.equal(url.origin, base.origin, `${label} must stay on ${base.origin}`)
  assert(!url.username && !url.password, `${label} must be credential-free`)
  return url
}

function request(path, options = {}) {
  return fetch(sameOrigin(path, 'Request URL'), {
    redirect: 'manual', signal: AbortSignal.timeout(12_000), ...options,
  })
}

async function getAsset(path) {
  const response = await request(path)
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const target = sameOrigin(response.headers.get('location'), 'Asset redirect')
    await response.body?.cancel()
    return request(target.href)
  }
  return response
}

async function readAudio(path, headers) {
  const response = await request(path, { headers })
  assert([200, 206].includes(response.status), `Expected MP3, got HTTP ${response.status}`)
  assert.match(response.headers.get('content-type') ?? '', /^audio\/mpeg\b/i)
  if (response.status === 206 && headers?.Range) {
    assert.match(response.headers.get('content-range') ?? '', /^bytes 0-8191\/(?:\d+|\*)$/)
    assert.equal((await response.arrayBuffer()).byteLength, 8192)
    return response.status
  }
  const reader = response.body.getReader()
  let bytes = 0
  try {
    while (bytes < 4096) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
    }
  } finally {
    await reader.cancel()
  }
  assert(bytes >= 4096, `Expected at least 4096 live MP3 bytes, received ${bytes}`)
  return response.status
}

for (const path of ['/', '/player', '/library', '/settings', '/broadcast']) {
  const response = await request(path)
  assert.equal(response.status, 200, path)
  const html = await response.text()
  assert.match(html, /<div id="root">/, path)
  if (path === '/') {
    const script = html.match(/<script[^>]+src="([^"\s]+)"/)?.[1]
    const asset = await request(script)
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type') ?? '', /javascript/i)
    await asset.body?.cancel()
  }
}

const logo = await request('/images.jpg', { headers: { Range: 'bytes=0-1023' } })
assert.equal(logo.status, 206, 'The static logo must support ranges')
assert.match(logo.headers.get('content-type') ?? '', /^image\/jpeg\b/i)
assert.match(logo.headers.get('content-range') ?? '', /^bytes 0-1023\//)
assert.equal((await logo.arrayBuffer()).byteLength, 1024)
console.log('SPA, built assets, and static byte ranges passed')

const response = await request(metadataPath, {
  headers: { 'X-Forwarded-Host': 'ignored.invalid', 'X-Forwarded-Proto': 'http' },
})
assert.equal(response.status, 200)
assert.equal(response.headers.get('set-cookie'), null)
assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/)
const data = await response.json()
assert.equal(data.station.shortcode, station)
assert.equal(data.is_online, true, 'The station must be online for this check')

const audioLinks = [data.station.listen_url, ...(data.station.mounts ?? []).map(({ url }) => url),
  ...(data.station.remotes ?? []).map(({ url }) => url)]
for (const link of new Set(audioLinks)) {
  const url = sameOrigin(link, 'Station audio')
  assert.equal(url.pathname, streamPath)
  await readAudio(url.href)
}

const artworkLinks = [data.now_playing, data.playing_next, ...(data.song_history ?? [])]
  .map((track) => track?.song?.art).filter(Boolean)
for (const link of new Set(artworkLinks)) {
  const image = await getAsset(link)
  assert.equal(image.status, 200, 'Track artwork')
  assert.match(image.headers.get('content-type') ?? '', /^image\//i)
  await image.body?.cancel()
}
assert(artworkLinks.length, 'Now Playing returned no artwork URLs to check')

const player = await getAsset(data.station.public_player_url)
assert.equal(player.status, 200)
assert.match(await player.text(), /<div id="root">/)
for (const link of [data.station.playlist_m3u_url, data.station.playlist_pls_url]) {
  const playlist = await request(link)
  assert.equal(playlist.status, 200)
  assert((await playlist.text()).includes(`${base.origin}${streamPath}`))
}
const rangeStatus = await readAudio(streamPath, { Range: 'bytes=0-8191' })
console.log(`Same-origin metadata, artwork, and MP3 passed. Live Range returned HTTP ${rangeStatus}.`)

const denied = [
  '/admin', '/admin/stations', '/login', '/account/login', '/account/forgot-password',
  '/manage', '/station/1', '/api/admin', '/api/station/1', '/api/station/1/files',
  '/api/station/ghmaas_baladi_radio/backend', '/api/nowplaying', '/api/nowplaying/other',
  '/api/station/other/art/sample', '/listen/ghmaas_baladi_radio/private.mp3',
  `/public/${station}/embed`,
]
for (const path of denied) {
  const blocked = await request(path)
  assert.equal(blocked.status, 404, path)
  await blocked.body?.cancel()
}
const write = await request(metadataPath, { method: 'POST' })
assert.equal(write.status, 405)
await write.body?.cancel()
console.log('Security checks passed. Private paths and station writes are blocked.')
