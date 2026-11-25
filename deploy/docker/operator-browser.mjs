import assert from 'node:assert/strict'
import { chromium } from '../../backend/node_modules/playwright/index.mjs'

const origin = 'http://127.0.0.1:18090'
const [username = 'radio-operator', selectedFile] = process.argv.slice(2)
const expectWrites = Boolean(selectedFile)
let stage = 'operator input'
let browser
try {
  const chunks = []
  let length = 0
  for await (const chunk of process.stdin) {
    length += chunk.length
    assert(length <= 256)
    chunks.push(chunk)
  }
  const password = Buffer.concat(chunks).toString('utf8')
  assert(password.length)
  stage = 'login'
  browser = await chromium.launch()
  const page = await browser.newPage()
  page.setDefaultTimeout(12_000)
  const loginPath = origin + '/admin-api/auth/login'
  await page.goto(origin + '/admin')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  const auth = page.waitForResponse(response => response.url() === loginPath && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  assert.equal((await auth).status(), 200)
  const get = path => page.evaluate(async path => {
    const response = await fetch('/admin-api' + path, { signal: AbortSignal.timeout(8000) })
    return { status: response.status, data: await response.json() }
  }, path)
  stage = 'session persistence and real station overview'
  await page.reload()
  await page.getByRole('heading', { name: 'Station overview', exact: true }).waitFor()
  const { status: sessionStatus, data: session } = await get('/auth/me')
  assert.equal(sessionStatus, 200)
  assert.equal(session.canWrite, expectWrites)
  const { status: overviewStatus, data: overview } = await get('/station')
  assert.equal(overviewStatus, 200)
  assert(overview.online && overview.rotation.id === 2 && overview.current?.title)
  await page.getByText(overview.current.title, { exact: true }).first().waitFor()

  stage = 'real library, membership and order in the UI'
  const nav = page.getByRole('navigation', { name: 'Administration' })
  await nav.getByRole('link', { name: 'Music Library' }).click()
  await page.getByRole('list', { name: 'Station tracks' }).waitFor()
  await nav.getByRole('link', { name: 'Main Rotation' }).click()
  await page.getByRole('list', { name: 'Rotation tracks' }).waitFor()
  const { status: orderStatus, data: rotation } = await get('/playlists/2')
  assert.equal(orderStatus, 200)
  assert(rotation.id === 2 && rotation.mode === 'sequential' && rotation.tracks.length && rotation.tracks.every(row => Number.isInteger(row.entryId)))
  if (expectWrites) {
    stage = 'upload controls and CSRF protection'
    const uploadWithoutCsrf = await page.evaluate(async () => {
      const response = await fetch('/admin-api/media/upload', { method: 'POST' })
      return { status: response.status, code: (await response.json()).code }
    })
    assert.equal(uploadWithoutCsrf.status, 403)
    assert.equal(uploadWithoutCsrf.code, 'csrf')
    await nav.getByRole('link', { name: 'Upload Music' }).click()
    await page.getByRole('heading', { name: 'Upload music', exact: true }).waitFor()
    assert.equal(await page.getByText(/Read-only access/).count(), 0)
    const browse = page.getByText('Browse files', { exact: true })
    const input = page.getByLabel('Choose music files')
    const upload = page.getByRole('button', { name: 'Upload selected', exact: true })
    assert(await input.isEnabled())
    assert(await upload.isDisabled())
    const chooser = page.waitForEvent('filechooser')
    await browse.click()
    await (await chooser).setFiles(selectedFile)
    await page.getByRole('list', { name: 'Selected audio' }).getByText('Ready to upload', { exact: true }).waitFor()
    assert(await upload.isEnabled())
  } else {
    assert.equal(await page.getByRole('button', { name: 'Save order', exact: true }).count(), 0)
  }
  stage = 'logout'
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.waitForURL('**/admin/login')
  assert.equal((await get('/auth/me')).status, 401)
  console.log('PASS operator login/logout, persistent session, real catalog and sequential rotation.')
  console.log(expectWrites ? 'PASS upload controls, file selection, queue and CSRF. No upload was submitted.' : 'PASS read-only UI.')
} catch {
  console.error('FAIL operator browser check during ' + stage + '.')
  process.exitCode = 1
} finally {
  await browser?.close()
}
