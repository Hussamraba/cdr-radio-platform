import assert from 'node:assert/strict'

const preview = 'http://127.0.0.1:18088'
const admin = 'http://127.0.0.1:18090'

async function expect(origin, path, status) {
  const response = await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(8_000) })
  assert.equal(response.status, status, path)
  return response
}

await expect(preview, '/healthz', 204)
await expect(admin, '/healthz', 204)
assert.match(await (await expect(admin, '/admin', 200)).text(), /<div id="root">/)
await (await expect(admin, '/admin-api/auth/me', 401)).body.cancel()
await (await expect(admin, '/admin-api/media', 401)).body.cancel()
const live = await (await expect(admin, '/api/nowplaying/ghmaas_baladi_radio', 200)).json()
assert.equal(live.station.id, 1)
assert.equal(live.is_online, true)
console.log('Compose health endpoints, private SPA, anonymous API denials and private radio relay passed.')

process.argv = [process.execPath, 'deploy/demo/smoke-test.mjs', preview]
await import('../demo/smoke-test.mjs')
