import assert from 'node:assert/strict'
import { isIP } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { chromium, devices } from 'playwright'

const origin = new URL(process.env.RADIO_PUBLIC_ORIGIN ?? 'https://hussam.tail1a8390.ts.net')
const preview = origin.origin === 'http://127.0.0.1:18088'
assert(preview || origin.protocol === 'https:')
assert(!origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash)
const pinned = process.env.PUBLIC_FUNNEL_IP
assert(!pinned || isIP(pinned) === 4)
const streamPath = '/listen/ghmaas_baladi_radio/radio.mp3'
const stream = origin.origin + streamPath
const shareOrigin = preview ? 'https://hussam.tail1a8390.ts.net' : origin.origin
const metadata = origin.origin + '/api/nowplaying/ghmaas_baladi_radio'
const args = ['--no-proxy-server', '--autoplay-policy=user-gesture-required',
  ...(pinned ? ['--host-resolver-rules=MAP ' + origin.hostname + ' ' + pinned] : [])]
const state = (page, text) => page.locator('.player-status').getByText(text, { exact: true })
const play = (page, tap = false) => page.getByRole('button', { name: 'Play stream', exact: true })[tap ? 'tap' : 'click']()
async function playing(page) {
  await state(page, 'Playback advancing').waitFor({ timeout: 24_000 })
  await page.waitForFunction(url => window.auditAudio?.currentSrc === url && window.auditAudio.currentTime > 0.3, stream, { timeout: 10_000 })
}

test('public Music Management navigation and workflow on ' + origin.origin, async t => {
  const browser = await chromium.launch({ args })
  t.after(() => browser.close())
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' })
  const mobile = await browser.newPage({ ...devices['Pixel 7'], reducedMotion: 'reduce' })
  const privateRequests = []
  for (const page of [desktop, mobile]) {
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (/^\/admin(?:-api)?(?:\/|$)/.test(path)) privateRequests.push(path)
    })
  }

  await desktop.goto(origin.href, { waitUntil: 'domcontentloaded' })
  await desktop.getByRole('main').getByRole('link', { name: 'Music Management', exact: true }).click()
  await desktop.waitForURL('**/library')
  await desktop.waitForFunction(() => document.title === 'Music Management | Ghmaas Baladi Radio')
  assert.equal(await desktop.getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Music Management', exact: true }).getAttribute('aria-current'), 'page')

  await mobile.goto(origin.href, { waitUntil: 'domcontentloaded' })
  await mobile.getByRole('button', { name: 'Open navigation', exact: true }).tap()
  const menu = mobile.getByRole('dialog', { name: 'Navigation', exact: true })
  await menu.getByRole('link', { name: 'Music Management', exact: true }).tap()
  await mobile.waitForURL('**/library')
  await menu.waitFor({ state: 'hidden' })

  for (const [page, widths] of [[desktop, [768, 1024, 1280, 1440]], [mobile, [320, 390, 430]]]) {
    const main = page.getByRole('main')
    await main.getByRole('heading', { name: 'Music Management', level: 1, exact: true }).waitFor()
    await main.getByText(/authorized Tailscale device/).waitFor()
    await main.getByText(/AutoDJ broadcasts/).waitFor()
    assert.deepEqual(await main.getByRole('heading', { level: 3 }).allTextContents(), [
      'Central library', 'Main Rotation', 'Branch Player', 'Connect and sign in', 'Upload approved audio',
      'Verify and assign tracks', 'Monitor the broadcast',
    ])
    assert.doesNotMatch(await main.innerText(), /AzuraCast|Media Manager|Set Playlists/)
    assert.equal(await main.getByRole('link', { name: 'Open Branch Player', exact: true }).getAttribute('href'), '/player')
    for (const width of widths) {
      await page.setViewportSize({ width, height: 850 })
      await page.evaluate(() => document.fonts.ready)
      const layout = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth])
      assert.equal(layout[0], width)
      assert(layout[1] <= width, 'Music Management at ' + width + 'px rendered at ' + layout[1] + 'px')
    }
  }

  await mobile.goto(origin.origin + '/playlists', { waitUntil: 'domcontentloaded' })
  await mobile.waitForURL('**/library')
  await mobile.getByRole('main').getByRole('link', { name: 'Open Branch Player', exact: true }).tap()
  await mobile.waitForURL('**/player')
  await mobile.getByRole('heading', { name: 'Branch Player', level: 1, exact: true }).waitFor()
  assert.deepEqual(privateRequests, [])
})

test('responsive dashboard, security allowlist and independent live playback on ' + origin.origin, async t => {
  const browser = await chromium.launch({ args })
  t.after(() => browser.close())
  const desktop = await browser.newContext()
  const mobile = await browser.newContext(devices['Pixel 7'])
  const dashboard = await desktop.newPage()
  const response = await dashboard.goto(origin.href)
  assert.equal(response.status(), 200)
  await dashboard.locator('.now-track .track-names strong').waitFor()
  await dashboard.waitForFunction(() => document.querySelector('.brand-logo img')?.naturalWidth > 0)
  await dashboard.waitForFunction(() => document.querySelector('.hero-artwork img')?.naturalWidth > 0)
  assert.equal(await dashboard.locator('.hero video').count(), 0)
  assert.equal(await dashboard.getByRole('link', { name: 'Public player', exact: true }).getAttribute('href'), shareOrigin + '/player')
  assert.equal(await dashboard.getByRole('link', { name: 'Direct MP3', exact: true }).getAttribute('href'), shareOrigin + streamPath)
  for (const width of [320, 390, 768, 1024, 1440]) {
    await dashboard.setViewportSize({ width, height: 850 })
    await dashboard.goto(origin.href, { waitUntil: 'domcontentloaded' })
    await dashboard.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
    await dashboard.evaluate(() => document.fonts.ready)
    const layout = await dashboard.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth])
    assert.equal(layout[0], width)
    assert(layout[1] <= width, 'Dashboard at ' + width + 'px rendered at ' + layout[1] + 'px')
  }
  for (const [method, path, code] of [
    ['GET', '/admin', 404], ['GET', '/login', 404], ['GET', '/admin-api/auth/me', 404],
    ['GET', '/admin-api/media', 404], ['GET', '/admin-api/playlists/2', 404], ['GET', '/api/station/1/files', 404],
    ['POST', '/admin-api/auth/login', 405], ['POST', '/admin-api/media/upload', 405],
  ]) {
    const status = await dashboard.evaluate(async ([url, method]) => (await fetch(url, { method })).status, [path, method])
    assert.equal(status, code, method + ' ' + path)
  }
  const sessions = await Promise.all([desktop, mobile].map(async context => {
    const page = await context.newPage()
    await page.addInitScript(() => {
      window.Audio = new Proxy(window.Audio, { construct(target, values) {
        const audio = Reflect.construct(target, values)
        window.auditAudio = audio
        return audio
      } })
    })
    const session = { page, starts: 0, responses: [] }
    page.on('request', req => { if (req.url() === stream) session.starts++ })
    page.on('response', response => {
      if (response.url() === stream) session.responses.push([response.status(), response.headers()['content-type']])
    })
    assert.equal((await page.goto(origin.origin + '/player')).status(), 200)
    await page.locator('.branch-status').getByText('LIVE', { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.audio-player img')?.naturalWidth > 0)
    if (context === mobile) {
      for (const width of [320, 360, 390, 430]) {
        await page.setViewportSize({ width, height: 850 })
        await page.evaluate(() => document.fonts.ready)
        const layout = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth])
        assert.equal(layout[0], width)
        assert(layout[1] <= width, 'Branch Player at ' + width + 'px rendered at ' + layout[1] + 'px')
      }
    }
    assert.equal(session.starts, 0)
    return session
  }))
  const [a, b] = sessions
  await Promise.all([play(a.page), play(b.page, true)])
  await Promise.all(sessions.map(({ page }) => playing(page)))
  assert(sessions.every(({ responses }) => responses.some(([code, type]) => [200, 206].includes(code) && /^audio\/mpeg\b/.test(type))))
  const untouched = a.starts
  const counter = () => a.page.evaluate(() => window.auditAudio.currentTime)
  const beforeMute = await counter()
  await b.page.getByRole('button', { name: 'Mute audio' }).tap()
  await b.page.waitForFunction(() => window.auditAudio.muted)
  assert(!(await a.page.evaluate(() => window.auditAudio.muted)))
  await b.page.getByRole('button', { name: 'Pause stream' }).tap()
  await state(b.page, 'Paused').waitFor()
  assert(await counter() > beforeMute)
  assert.equal(a.starts, untouched)

  const failMetadata = route => route.fulfill({ status: 503 })
  await a.page.route(metadata, failMetadata)
  const beforeFailure = await counter()
  await a.page.locator('.branch-status').getByText('Unavailable', { exact: true }).waitFor({ timeout: 15_000 })
  await state(a.page, 'Playback advancing').waitFor()
  assert(await counter() > beforeFailure)
  await a.page.unroute(metadata, failMetadata)
  await a.page.locator('.branch-status').getByText('LIVE', { exact: true }).waitFor({ timeout: 15_000 })
  assert.equal(a.starts, untouched)

  await play(b.page, true)
  await playing(b.page)
  const beforeRetry = b.starts
  let rejected = false
  await b.page.route(stream, route => { rejected = true; return route.abort('connectionfailed') }, { times: 1 })
  await b.page.evaluate(() => window.auditAudio.dispatchEvent(new Event('error')))
  await state(b.page, 'Reconnecting…').waitFor()
  for (let count = 0; count < 100 && !rejected; count++) await sleep(100)
  assert(rejected)
  await playing(b.page)
  assert(b.starts >= beforeRetry + 2)
  assert.equal(a.starts, untouched)
  await state(a.page, 'Playback advancing').waitFor()
})
