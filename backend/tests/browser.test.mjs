import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { test } from 'node:test'
import { chromium, devices } from 'playwright'
import { fixture, mp3, password, username, wav } from './fixture.mjs'

const named = (page, name) => page.getByRole('heading', { name, exact: true })
const button = (page, name) => page.getByRole('button', { name, exact: true })
const nav = (page, name) => page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name, exact: true })
async function login(page, desiredPassword = password) {
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(desiredPassword)
  await button(page, 'Sign in').click()
}

test('both dashboard builds render local studio artwork and respect reduced motion', async t => {
  const browser = await chromium.launch()
  t.after(() => browser.close())
  for (const directory of ['dist', 'dist-admin']) {
    const app = await fixture({ frontendDir: resolve(import.meta.dirname, '../../frontend', directory) })
    t.after(app.close)
    const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, reducedMotion: 'no-preference' })
    await page.goto(app.origin)
    await named(page, 'Dashboard').waitFor()

    const artwork = page.locator('.hero-artwork img')
    const source = await artwork.evaluate(async image => {
      await image.decode()
      return image.currentSrc
    })
    assert.equal(new URL(source).origin, app.origin)
    assert.match(new URL(source).pathname, /\/assets\/broadcast-studio-[\w-]+\.svg$/)
    assert.equal(await page.locator('.hero video').count(), 0)

    const animationState = () => page.locator('.hero-artwork').evaluate(art =>
      getComputedStyle(art, '::after').animationPlayState)
    await button(page, 'Pause background motion').click()
    await button(page, 'Resume background motion').waitFor()
    assert.equal(await animationState(), 'paused')
    await button(page, 'Resume background motion').click()
    await button(page, 'Pause background motion').waitFor()
    assert.equal(await animationState(), 'running')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await button(page, 'Pause background motion').waitFor({ state: 'detached' })
    assert.equal(await page.locator('.hero-artwork').evaluate(art =>
      getComputedStyle(art, '::after').animationName), 'none')
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 860 })
      await artwork.waitFor({ state: 'visible' })
      await page.locator('.hero').getByRole('link', { name: 'Branch Player', exact: true }).waitFor({ state: 'visible' })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), directory + ' overflowed at ' + width)
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await button(page, 'Pause background motion').waitFor()
    await page.goto(app.origin + '/settings')
    await page.getByRole('switch', { name: /Reduce motion/ }).check()
    await page.goto(app.origin)
    await artwork.waitFor()
    assert.equal(await page.locator('.hero-artwork').evaluate(art =>
      getComputedStyle(art, '::after').animationName), 'none')
    assert.equal(await button(page, 'Pause background motion').count(), 0)
    await page.close()
  }
})

test('isolated browser admin workflow with actual backend and only AzuraCast replaced', async t => {
  const app = await fixture({ upstreamMs: 2000 })
  t.after(app.close)
  const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(9000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(app.origin + '/admin/library')
  await page.waitForURL('**/admin/login')
  await named(page, 'Radio administration').waitFor()
  assert.equal(await page.getByRole('navigation', { name: 'Administration' }).count(), 0)
  assert.equal(await page.locator('input[name=password]').getAttribute('autocomplete'), 'current-password')
  await page.waitForFunction(() => document.querySelector('.brand-logo img')?.naturalWidth > 0)
  await login(page, 'not-the-staged-password')
  await page.getByRole('alert').getByText('Incorrect username or password.').waitFor()
  await login(page)
  await page.waitForURL('**/admin')
  await page.getByText('Opening Song', { exact: true }).waitFor()
  await page.getByText('Second Song', { exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Public player', exact: true }).getAttribute('href'), 'https://hussam.tail1a8390.ts.net/player')

  await nav(page, 'Music Library').click()
  await named(page, 'Music library').waitFor()
  const search = page.getByRole('searchbox', { name: 'Search music' })
  await search.fill('no-fixture-result')
  await button(page, 'Search').click()
  await named(page, 'No tracks match your search').waitFor()
  await search.fill('Ready')
  await page.getByLabel('Playlist filter').selectOption('rotation')
  const rotationSearch = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/admin-api/media' && url.searchParams.get('q') === 'Ready' && url.searchParams.get('scope') === 'rotation'
  })
  await button(page, 'Search').click()
  assert.equal((await rotationSearch).status(), 200)
  await named(page, 'No tracks match your search').waitFor()
  await page.getByLabel('Playlist filter').selectOption('all')
  await button(page, 'Search').click()
  await page.getByText('Ready Song', { exact: true }).waitFor()
  assert.equal(await page.getByText('Opening Song', { exact: true }).count(), 0)
  await button(page, 'Add Ready Song to Main Rotation').click()
  await page.getByRole('status').getByText('Ready Song is assigned to Ghmaas Main Rotation.').waitFor()
  assert.deepEqual(app.state.writes.at(-1).ids, [1, 2])
  app.state.failures.set('GET /api/station/1/files', (_req, res) => res.writeHead(503).end())
  await button(page, 'Refresh').click()
  await page.getByText(/AzuraCast is temporarily unavailable/).waitFor()
  app.state.failures.delete('GET /api/station/1/files')
  await button(page, 'Retry').click()
  await page.getByText('Ready Song', { exact: true }).waitFor()

  await nav(page, 'Upload Music').click()
  await named(page, 'Upload music').waitFor()
  await named(page, 'No files selected').waitFor()
  const chosen = page.getByLabel('Choose music files')
  await chosen.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') })
  await page.getByRole('alert').getByText(/Choose a non-empty MP3 or WAV/).waitFor()
  await chosen.setInputFiles({ name: 'oversize.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(1024 ** 2 + 1) })
  await page.getByRole('alert').getByText(/Maximum per file/).waitFor()
  const file = { name: 'CDR Test Track A.mp3', mimeType: 'audio/mpeg', buffer: mp3 }
  await chosen.setInputFiles(file)
  const wavTransfer = await page.evaluateHandle(bytes => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], 'Second approved.wav', { type: 'audio/wav' }))
    return transfer
  }, Array.from(wav))
  await page.locator('.admin-drop').dispatchEvent('drop', { dataTransfer: wavTransfer })
  await wavTransfer.dispose()
  await page.getByText('Second approved.wav', { exact: true }).waitFor()
  await button(page, 'Remove Second approved.wav from upload queue').click()

  const upstreamUpload = 'POST /api/station/1/files'
  app.state.failures.set(upstreamUpload, async (req, res) => {
    req.resume()
    await wait(450)
    res.writeHead(503).end()
  })
  await button(page, 'Upload selected').click()
  await page.getByRole('progressbar', { name: 'Upload progress for CDR Test Track A.mp3' }).waitFor()
  await page.getByText('Verifying in AzuraCast…', { exact: true }).waitFor()
  assert(await button(page, 'Working…').isDisabled())
  await page.getByText('Upload failed', { exact: true }).waitFor()
  assert.equal(app.state.requests.filter(req => req.method + ' ' + req.path === upstreamUpload).length, 1)
  app.state.failures.delete(upstreamUpload)
  await button(page, 'Retry upload').click()
  await page.getByText('Uploaded and verified · not assigned', { exact: true }).waitFor()
  assert.equal(app.state.uploads.length, 1)
  assert.deepEqual(app.state.uploads[0].bytes, mp3)
  await button(page, 'Add to Main Rotation').click()
  await page.getByText('Main Rotation addition verified', { exact: true }).waitFor()
  await page.getByRole('link', { name: 'View in library' }).click()
  await page.getByText('CDR Test Track A', { exact: true }).waitFor()
  assert.equal(await page.getByText('Opening Song', { exact: true }).count(), 0)

  await nav(page, 'Upload Music').click()
  await chosen.setInputFiles([
    { name: 'Renamed duplicate.mp3', mimeType: 'audio/mpeg', buffer: mp3 },
    { name: 'Second approved.wav', mimeType: 'audio/wav', buffer: wav },
  ])
  assert.equal(await page.getByRole('list', { name: 'Selected audio' }).getByRole('listitem').count(), 2)
  await button(page, 'Upload selected').click()
  await page.getByRole('alert').getByText(/This same audio file already exists/).waitFor()
  await page.getByText('Uploaded and verified · not assigned', { exact: true }).waitFor()
  assert.equal(app.state.uploads.length, 2)
  assert.deepEqual(app.state.uploads[1].bytes, wav)

  await nav(page, 'Main Rotation').click()
  await named(page, 'Ghmaas Main Rotation').waitFor()
  await page.getByText('Sequential', { exact: true }).waitFor()
  const list = page.getByRole('list', { name: 'Rotation tracks' })
  const order = () => list.locator('li strong').allTextContents()
  const before = await order()
  assert.deepEqual(before.slice(0, 2), ['Opening Song', 'Second Song'])
  await button(page, 'Move Opening Song down').focus()
  await page.keyboard.press('Enter')
  assert.deepEqual((await order()).slice(0, 2), ['Second Song', 'Opening Song'])
  page.once('dialog', async dialog => {
    assert.match(dialog.message(), /Already queued tracks/)
    await dialog.dismiss()
  })
  await button(page, 'Save order').click()
  assert.equal(app.state.writes.filter(write => write.operation === 'order').length, 0)
  page.once('dialog', dialog => dialog.accept())
  await button(page, 'Save order').click()
  await page.getByRole('status').getByText('The new playlist order was saved and verified in AzuraCast.').waitFor()
  await list.waitFor()
  assert.deepEqual((await order()).slice(0, 2), ['Second Song', 'Opening Song'])
  page.once('dialog', async dialog => {
    assert.match(dialog.message(), /media file will stay in the library/)
    await dialog.accept()
  })
  await button(page, 'Remove CDR Test Track A from Main Rotation').click()
  await page.getByText('CDR Test Track A was removed from the main rotation.', { exact: true }).waitFor()
  assert(app.state.files.some(file => file.title === 'CDR Test Track A'))

  const screens = [
    ['/admin', 'Station overview'], ['/admin/library', 'Music library'],
    ['/admin/upload', 'Upload music'], ['/admin/playlist', 'Main rotation'], ['/admin/help', 'Administration help'],
  ]
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 860 })
    for (const [route, heading] of screens) {
      await page.goto(app.origin + route)
      await named(page, heading).waitFor()
      if (route === '/admin/playlist') await page.getByRole('list', { name: 'Rotation tracks' }).waitFor()
      await page.evaluate(() => document.fonts.ready)
      const layout = await page.evaluate(() => ({
        width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
      }))
      assert.equal(layout.width, width)
      assert(layout.scroll <= width, route + ' overflowed at ' + width + 'px, actual ' + layout.scroll)
      assert(await nav(page, 'Overview').isVisible())
    }
  }
  await page.goto(app.origin + '/admin')
  await named(page, 'Station overview').waitFor()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  assert(await skip.evaluate(node => node === document.activeElement && getComputedStyle(node).outlineStyle !== 'none'))
  await page.keyboard.press('Enter')
  const mediaMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  assert(mediaMotion)
  assert.equal(await page.evaluate(() => document.activeElement.id), 'admin-content')
  await context.clearCookies()
  await button(page, 'Refresh').click()
  await page.waitForURL('**/admin/login')
  await login(page)
  await named(page, 'Station overview').waitFor()
  await button(page, 'Sign out').click()
  await page.waitForURL('**/admin/login')
  await page.goto(app.origin + '/admin/playlist')
  await page.waitForURL('**/admin/login')
  assert.deepEqual(errors, [])

  const phone = await browser.newContext(devices['Pixel 7'])
  const player = await phone.newPage()
  const requests = []
  player.on('request', request => { if (request.url().endsWith('/radio.mp3')) requests.push(request.url()) })
  await player.goto(app.origin + '/player')
  await named(player, 'Branch Player').waitFor()
  assert.equal(requests.length, 0)
  await button(player, 'Play stream').tap()
  await player.locator('.player-status').getByText('Playback advancing', { exact: true }).waitFor()
  assert.deepEqual(requests, [app.origin + '/listen/ghmaas_baladi_radio/radio.mp3'])
})

test('player reports a frozen playback clock and waits for progress after buffering', async t => {
  const app = await fixture()
  t.after(app.close)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.Audio = new Proxy(window.Audio, { construct(target, args) {
      const audio = Reflect.construct(target, args)
      const clock = { audio, position: 0, paused: true, ready: 4, starts: 0 }
      window.testClock = clock
      Object.defineProperties(audio, {
        src: { set: () => {} },
        currentTime: { get: () => clock.position },
        paused: { get: () => clock.paused },
        readyState: { get: () => clock.ready },
        networkState: { get: () => 2 },
      })
      audio.play = async () => {
        clock.starts++
        clock.paused = false
        audio.dispatchEvent(new Event('playing'))
      }
      audio.pause = () => { clock.paused = true }
      audio.load = () => {}
      return audio
    } })
  })
  await page.goto(app.origin + '/player')
  const state = label => page.locator('.player-status').getByText(label, { exact: true })
  const event = (name, values = {}) => page.evaluate(({ name, values }) => {
    Object.assign(window.testClock, values)
    window.testClock.audio.dispatchEvent(new Event(name))
  }, { name, values })

  await button(page, 'Play stream').click()
  await state('Connecting…').waitFor()
  await event('timeupdate', { position: 1 })
  await state('Playback advancing').waitFor()
  await event('stalled')
  await state('Playback stalled').waitFor({ timeout: 6000 })
  await page.getByText('Playback diagnostics', { exact: true }).click()
  const diagnostics = page.locator('.player-diagnostics')
  await diagnostics.getByText(/^stalled · /).waitFor()
  await diagnostics.getByText('4 / 2', { exact: true }).waitFor()

  await event('waiting', { ready: 2 })
  await state('Buffering…').waitFor()
  await event('canplay', { ready: 4 })
  await diagnostics.getByText(/^canplay · /).waitFor()
  assert(!(await state('Playback advancing').isVisible()))
  await event('timeupdate', { position: 2 })
  await state('Playback advancing').waitFor()
  assert.equal(await page.evaluate(() => window.testClock.starts), 1)
  await button(page, 'Pause stream').click()
  await state('Paused').waitFor()
})

test('library rejects an unverified assignment response and clears stale confirmation on refresh', async t => {
  const app = await fixture()
  t.after(app.close)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(app.origin + '/admin/library')
  await page.waitForURL('**/admin/login')
  await login(page)
  await nav(page, 'Music Library').click()
  const add = button(page, 'Add Ready Song to Main Rotation')
  const success = page.getByText('Ready Song is assigned to Ghmaas Main Rotation.', { exact: true })
  const path = '**/admin-api/playlists/2/tracks'
  const target = app.state.files.find(track => track.id === 12)
  const freshMemberships = structuredClone(target.playlists)
  await page.route(path, route => route.fulfill({ json: { id: 12, title: target.title, playlists: [{ id: 2 }] } }))
  await add.click()
  await page.getByRole('alert').getByText(/membership could not be confirmed/).waitFor()
  assert.equal(await success.count(), 0)
  assert.equal(app.state.writes.length, 0)
  await page.unroute(path)

  await add.click()
  await success.waitFor()
  target.playlists = freshMemberships
  app.state.order = app.state.order.filter(([, mediaId]) => mediaId !== target.id)
  await button(page, 'Refresh').click()
  await add.waitFor()
  assert.equal(await success.count(), 0)
})

test('private UI visibly disables mutations when the service is read-only', async t => {
  const app = await fixture({}, {})
  t.after(app.close)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(app.origin + '/admin')
  await named(page, 'Radio administration').waitFor()
  await login(page)
  await page.getByRole('status').getByText(/Read-only access/).waitFor()
  await nav(page, 'Upload Music').click()
  assert(await page.getByLabel('Choose music files').isDisabled())
  assert(await button(page, 'Upload selected').isDisabled())
  await nav(page, 'Main Rotation').click()
  await named(page, 'Ghmaas Main Rotation').waitFor()
  assert.equal(await button(page, 'Save order').count(), 0)
  assert.equal(await button(page, 'Remove Opening Song from Main Rotation').count(), 0)
  assert.equal(app.state.writes.length, 0)
})

test('Android touch admin chooses files, recovers from upload interruption and keeps its session', async t => {
  const app = await fixture({}, {
    ADMIN_ALLOW_WRITES: 'true', ADMIN_APPROVED_UPLOAD_SHA256: createHash('sha256').update(mp3).digest('hex'),
    ADMIN_WRITE_WINDOW_EXPIRES_AT: String(Date.now() + 60_000),
  })
  t.after(app.close)
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const context = await browser.newContext({ ...devices['Pixel 7'], reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto(app.origin + '/admin')
  await named(page, 'Radio administration').waitFor()
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 800 })
    const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
    assert.equal(layout.width, width)
    assert(layout.scroll <= width)
  }
  assert.equal(await page.getByLabel('Password').evaluate(input => getComputedStyle(input).fontSize), '16px')
  await login(page)
  await named(page, 'Station overview').waitFor()
  await page.getByRole('status').getByText(/Approved upload window/).waitFor()
  await nav(page, 'Upload Music').tap()
  const browse = page.getByText('Browse files', { exact: true })
  assert((await browse.boundingBox()).height >= 44)
  const upload = button(page, 'Upload selected')
  assert(await upload.isDisabled())
  const chooser = page.waitForEvent('filechooser')
  await browse.tap()
  assert((await chooser).isMultiple())
  await (await chooser).setFiles([
    { name: 'Mobile MP3.mp3', mimeType: 'audio/mpeg', buffer: mp3 },
    { name: 'Mobile WAV.wav', mimeType: 'audio/wav', buffer: wav },
  ])
  const rows = page.getByRole('list', { name: 'Selected audio' }).getByRole('listitem')
  assert.equal(await rows.count(), 2)
  await button(page, 'Remove Mobile WAV.wav from upload queue').tap()

  await page.route('**/admin-api/media/upload', route => route.abort('internetdisconnected'), { times: 1 })
  await upload.tap()
  await page.getByText(/The upload connection was interrupted/).waitFor()
  assert.equal(app.state.uploads.length, 0)
  await button(page, 'Retry upload').tap()
  await page.getByText('Uploaded and verified · not assigned', { exact: true }).waitFor()
  assert.equal(app.state.uploads.length, 1)
  assert.deepEqual(app.state.uploads[0].bytes, mp3)
  await button(page, 'Add to Main Rotation').tap()
  await page.getByText('Main Rotation addition verified', { exact: true }).waitFor()
  await button(page, 'Clear Mobile MP3.mp3 from upload queue').tap()
  await page.getByText('No files selected', { exact: true }).waitFor()
  await page.reload()
  await named(page, 'Upload music').waitFor()
  await nav(page, 'Main Rotation').tap()
  await page.getByRole('list', { name: 'Rotation tracks' }).getByText('CDR Test Track A', { exact: true }).waitFor()
  assert.equal(await button(page, 'Save order').count(), 0)
  assert.equal(await button(page, 'Remove Opening Song from Main Rotation').count(), 0)
  await button(page, 'Sign out').tap()
  await page.waitForURL('**/admin/login')
})
