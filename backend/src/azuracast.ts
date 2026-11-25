import { createHash } from 'node:crypto'
import { z } from 'zod'
import { station, type Config } from './config.js'
import { Problem } from './errors.js'
import { encodeFile, type PreparedUpload } from './upload.js'

const id = z.number().int().positive().safe()
const membershipSchema = z.object({ id, name: z.string(), folder: z.string().nullish(), count: z.number().int().positive().optional() })
const baseTrack = z.object({
  id, title: z.string().nullish(), artist: z.string().nullish(),
  path: z.string().min(1), length: z.number().finite().nonnegative().nullish(),
})
const mediaSchema = baseTrack.extend({ size: z.number().int().nonnegative().nullish(), playlists: z.array(membershipSchema) })
const fileListRow = z.object({ media: mediaSchema.nullable() })
const playlistSchema = z.object({
  id, name: z.string(), order: z.enum(['random', 'shuffle', 'sequential']),
  source: z.enum(['songs', 'playlists', 'remote_url', 'requests']),
  type: z.string(), is_enabled: z.boolean(), schedule_items: z.array(z.unknown()).optional(),
})
const orderSchema = z.array(z.object({ id, weight: z.number().int(), media: baseTrack }))
const songSchema = z.object({ title: z.string().nullish(), text: z.string().nullish(), artist: z.string().nullish() })
const entrySchema = z.object({ playlist: z.string().nullish(), song: songSchema.nullish() }).nullish()
const nowSchema = z.object({
  is_online: z.boolean(), station: z.object({ id, shortcode: z.string(), name: z.string() }),
  listeners: z.object({ current: z.number().nonnegative().optional(), total: z.number().nonnegative().optional() }),
  now_playing: entrySchema, playing_next: entrySchema,
})
const successSchema = z.object({ success: z.literal(true) })
const shapeError = () => new Problem(502, 'upstream_shape', 'AzuraCast returned an unexpected response. Refresh and check station access.')

function parsed<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) throw shapeError()
  return result.data
}

function pageSchema<T>(item: z.ZodType<T>) {
  return z.object({ page: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(), rows: z.array(item) })
}
function listing<T>(item: z.ZodType<T>, body: unknown) {
  const page = parsed(pageSchema(item), body)
  return { page: page.page || 1, total: page.total, pages: Math.max(1, page.total_pages), rows: page.rows }
}

function track(row: z.infer<typeof baseTrack>) {
  const filename = row.path.split('/').at(-1) ?? row.path
  const displayFilename = filename.replace(/^cdr-[a-f0-9]{64}-/, '')
  const type = displayFilename.includes('.') ? displayFilename.split('.').at(-1)?.toUpperCase() ?? 'Unknown' : 'Unknown'
  return { id: row.id, title: row.title?.trim() || displayFilename, artist: row.artist?.trim() || null,
    filename: displayFilename, type, duration: row.length ?? null }
}
function media(row: z.infer<typeof mediaSchema>) {
  return { ...track(row), playlists: row.playlists.map(({ id, name, folder, count }) => ({ id, name, folder: Boolean(folder), count: count ?? 1 })) }
}
function summarize(row: z.infer<typeof playlistSchema>) {
  return { id: row.id, name: row.name, mode: row.order, source: row.source, type: row.type,
    enabled: row.is_enabled, scheduled: Boolean(row.schedule_items?.length) }
}
function song(entry: z.infer<typeof entrySchema>) {
  const title = entry?.song?.title?.trim() || entry?.song?.text?.trim()
  return title ? { title, artist: entry?.song?.artist?.trim() || null, playlist: entry?.playlist?.trim() || null } : null
}

type OrderRow = z.infer<typeof orderSchema>[number]
function blockedUpstream(status: number, write: boolean) {
  if (status === 401 || status === 403) return new Problem(403, 'azuracast_permission', 'AzuraCast denied access. Check the station API key and permissions.')
  if (status === 404) return new Problem(404, 'not_found', 'The station resource no longer exists.')
  if (status === 409) return new Problem(409, 'azuracast_conflict', 'AzuraCast reported a conflict. Refresh and try again.')
  if (status === 413) return new Problem(413, 'azuracast_limit', 'AzuraCast rejected the file size.')
  if (status === 422 || (write && status === 400)) return new Problem(422, 'azuracast_validation', 'AzuraCast rejected the submitted change.')
  if (status === 429 || status === 503) return new Problem(503, 'azuracast_unavailable', 'AzuraCast is temporarily unavailable. Check the library before retrying a write.')
  if (status === 504) return new Problem(504, 'azuracast_timeout', 'AzuraCast timed out. Check the library or playlist before retrying a write.')
  return new Problem(502, 'azuracast_failure', 'AzuraCast could not complete the request. Check the library or playlist before retrying a write.')
}

const MAX_JSON = 16 * 1024 ** 2
async function readJson(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) throw shapeError()
  const chunks: Buffer[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_JSON) throw shapeError()
      chunks.push(Buffer.from(chunk.value))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw shapeError() }
}

async function hashMedia(response: Response, size: number) {
  const reader = response.body?.getReader()
  if (!reader) throw shapeError()
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return bytes === size ? hash.digest('hex') : null
      bytes += value.byteLength
      if (bytes > size) return null
      hash.update(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export function createAzura(config: Config) {
  type UpstreamOptions = { public?: boolean; timeout?: number; deadline?: AbortSignal }
  async function withResponse<T>(path: string, read: (response: Response) => Promise<T>, init: (RequestInit & { duplex?: 'half' }) = {}, options: UpstreamOptions = {}) {
    const timeout = AbortSignal.timeout(options.timeout ?? config.upstreamMs)
    const signal = options.deadline ? AbortSignal.any([options.deadline, timeout]) : timeout
    const headers = new Headers(init.headers)
    if (!headers.has('accept')) headers.set('accept', 'application/json')
    if (!options.public) headers.set('x-api-key', config.apiKey)
    try {
      const response = await fetch(new URL('/api' + path, config.azuraOrigin), { ...init, headers, signal, redirect: 'manual' })
      if (!response.ok) {
        await response.body?.cancel()
        throw blockedUpstream(response.status, Boolean(init.method))
      }
      return await read(response)
    } catch (error) {
      if (error instanceof Problem) throw error
      if (signal.aborted) throw blockedUpstream(504, Boolean(init.method))
      throw new Problem(503, 'azuracast_unreachable', 'AzuraCast could not be reached. Check the library or playlist before retrying a write.')
    }
  }
  const request = (path: string, init?: RequestInit & { duplex?: 'half' }, options?: UpstreamOptions) => withResponse(path, readJson, init, options)

  const base = '/station/' + station.id
  const rotationPath = '/playlist/' + station.playlist.id
  const az = (path: string, init?: RequestInit, deadline?: AbortSignal) => request(base + path, init, { deadline })
  const json = (body: object): RequestInit => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const file = async (trackId: number, deadline?: AbortSignal) => {
    const result = parsed(mediaSchema, await az('/file/' + trackId, undefined, deadline))
    if (result.id !== trackId) throw shapeError()
    return result
  }
  const invalidRotation = () => new Problem(409, 'rotation_config', 'The configured main rotation no longer matches AzuraCast. Ask the station operator to check playlist 2.')
  const main = async () => {
    const result = parsed(playlistSchema, await az(rotationPath))
    if (result.id !== station.playlist.id || result.name !== station.playlist.name || result.source !== 'songs') throw invalidRotation()
    return result
  }
  const order = async () => {
    const rows = parsed(orderSchema, await az(rotationPath + '/order'))
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw shapeError()
    return rows
  }
  function verifyIds(rows: OrderRow[], proposed: number[]) {
    return rows.length === proposed.length && rows.every((row, index) => row.id === proposed[index])
  }
  const mediaPage = async (q: string, page: number, deadline?: AbortSignal) => {
    const query = new URLSearchParams({ page: String(page), per_page: '25', searchPhrase: q })
    return listing(mediaSchema, await az('/files?' + query, undefined, deadline))
  }
  async function checkUploadIdentity(upload: PreparedUpload, deadline = AbortSignal.timeout(config.uploadMs)) {
    for (let page = 1; ; page++) {
      const result = await mediaPage('', page, deadline)
      if (result.page !== page) throw shapeError()
      for (const existing of result.rows) {
        // Older station files do not have app-generated names. Use the size only to narrow the hash check.
        if (existing.size == null || existing.size === upload.size) {
          const download = base + '/files/download?' + new URLSearchParams({ file: existing.path })
          const digest = await withResponse(download, response => hashMedia(response, upload.size), { headers: { accept: '*/*' } }, { deadline })
          if (digest === upload.digest) {
            throw new Problem(409, 'duplicate_audio', 'This same audio file already exists. Search the library and use the existing track.')
          }
        }
        if (existing.path === upload.azuraPath) {
          throw new Problem(409, 'upload_path_conflict', 'A different file occupies the upload destination. Check the station library before retrying.')
        }
      }
      if (page >= result.pages) return
    }
  }
  async function rotationMediaPage(q: string, page: number, deadline?: AbortSignal) {
    if (/(?:playlist|special):/i.test(q)) throw new Problem(400, 'search_term', 'Use a plain title, artist, or file name in the rotation filter.')
    const query = new URLSearchParams({ page: String(page), per_page: '25', searchPhrase: ('playlist:' + station.playlist.id + ' ' + q).trim() })
    const result = listing(fileListRow, await az('/files/list?' + query, undefined, deadline))
    return { ...result, rows: result.rows.flatMap(row => row.media ? [row.media] : []) }
  }
  async function rotationContains(trackId: number) {
    const deadline = AbortSignal.timeout(config.upstreamMs)
    for (let page = 1; ; page++) {
      const result = await rotationMediaPage('', page, deadline)
      if (result.page !== page) throw shapeError()
      if (result.rows.some(row => row.id === trackId)) return true
      if (page >= result.pages) return false
    }
  }
  const broadcast = async () => {
    const live = parsed(nowSchema, await request('/nowplaying/' + station.shortcode, {}, { public: true }))
    if (live.station.id !== station.id || live.station.shortcode !== station.shortcode) throw shapeError()
    return live
  }
  async function playlist(page: number, withBroadcast = true) {
    const [rotation, activePlaylist] = await Promise.all([
      main(), withBroadcast ? broadcast().then(live => live.is_online ? live.now_playing?.playlist || null : null).catch(() => null) : null,
    ])
    if (rotation.order === 'sequential') {
      const ordered = await order()
      return { ...summarize(rotation), activePlaylist, editableOrder: true, page: 1, pages: 1, total: ordered.length,
        tracks: ordered.map(row => ({ ...track(row.media), entryId: row.id })) }
    }
    const members = await rotationMediaPage('', page)
    return { ...summarize(rotation), activePlaylist, editableOrder: false, page: members.page, pages: members.pages, total: members.total,
      tracks: members.rows.map(row => ({ ...track(row), entryId: null })) }
  }

  return {
    async overview() {
      const [live, rotation] = await Promise.all([broadcast(), main()])
      return { name: live.station.name, online: live.is_online, listeners: live.listeners.current ?? live.listeners.total ?? null,
        current: song(live.now_playing), next: song(live.playing_next), rotation: summarize(rotation) }
    },
    async listMedia(q: string, page: number, inRotation = false) {
      const result = await (inRotation ? rotationMediaPage(q, page) : mediaPage(q, page))
      return { ...result, rows: result.rows.map(media) }
    },
    async listPlaylists(page: number) {
      const result = listing(playlistSchema, await az('/playlists?' + new URLSearchParams({ page: String(page), per_page: '25' })))
      return { ...result, rows: result.rows.map(item => ({ ...summarize(item), managed: item.id === station.playlist.id && item.name === station.playlist.name && item.source === 'songs' })) }
    },
    playlist,
    checkUploadIdentity,
    async upload(upload: PreparedUpload) {
      const deadline = AbortSignal.timeout(config.uploadMs)
      await checkUploadIdentity(upload, deadline)
      const encoded = encodeFile(upload.localPath, upload.azuraPath, upload.size)
      const body = await request(base + '/files', {
        method: 'POST', body: encoded.body as unknown as BodyInit, duplex: 'half',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(encoded.length) },
      }, { timeout: config.uploadMs, deadline }).finally(() => encoded.body.destroy())
      const result = parsed(mediaSchema, body)
      const verified = await file(result.id, deadline)
      if (verified.path !== upload.azuraPath || verified.playlists.length) throw shapeError()
      return media(verified)
    },
    async setMembership(trackId: number, add: boolean) {
      const rotation = await main()
      const sequential = rotation.order === 'sequential'
      const [before, existingOrder] = await Promise.all([file(trackId), sequential ? order() : undefined])
      const matching = before.playlists.filter(item => item.id === rotation.id)
      if (!add && matching.some(item => item.folder)) {
        throw new Problem(409, 'folder_membership', 'This track is assigned by a playlist folder. Ask the station operator to manage the folder in AzuraCast.')
      }
      const membershipError = () => new Problem(409, 'membership_verification',
        'AzuraCast could not confirm the track’s Main Rotation membership. Refresh the playlist before retrying.')
      const existingTarget = existingOrder?.filter(row => row.media.id === trackId)
      const present = existingTarget ? existingTarget.length > 0 : await rotationContains(trackId)
      if (Boolean(matching.length) !== present || (add && existingTarget && existingTarget.length > 1)) {
        throw membershipError()
      }
      if (present === add) return media(before)
      const other = new Set(before.playlists.filter(item => item.id !== rotation.id).map(item => item.id))
      const memberships = [...other]
      if (add) memberships.push(rotation.id)
      parsed(successSchema, await az('/file/' + trackId, json({ playlists: memberships })))
      const [after, savedOrder] = await Promise.all([file(trackId), sequential ? order() : undefined])
      const verified = new Set(after.playlists.map(item => item.id))
      if (verified.size !== memberships.length || memberships.some(value => !verified.has(value))) {
        throw membershipError()
      }
      if (existingOrder && savedOrder) {
        const savedTarget = savedOrder.filter(row => row.media.id === trackId)
        if (savedTarget.length !== Number(add)) throw membershipError()
        const unchanged = existingOrder.filter(row => row.media.id !== trackId)
        const unchangedByEntryId = new Map(unchanged.map(row => [row.id, row]))
        const savedOthers = savedOrder.filter(row => row.media.id !== trackId)
        // AzuraCast can return equal-weight entries in any relative order.
        const preserved = unchanged.length === savedOthers.length && savedOthers.every((saved, index) => {
          const original = unchangedByEntryId.get(saved.id)
          return original !== undefined && original.media.id === saved.media.id
            && original.weight === saved.weight && unchanged[index].weight === saved.weight
        })
        const [appended] = savedTarget
        if (!preserved || (appended && (savedOrder.at(-1)?.id !== appended.id
          || existingOrder.some(row => row.weight >= appended.weight)))) {
          throw new Problem(409, 'rotation_order_changed', 'AzuraCast reported an unexpected rotation order. Refresh and review the playlist before retrying.')
        }
      } else if (await rotationContains(trackId) !== add) {
        throw membershipError()
      }
      return media(after)
    },
    async reorder(baseline: number[], proposed: number[]) {
      const rotation = await main()
      if (rotation.order !== 'sequential') throw new Problem(409, 'playlist_mode', 'Only sequential playlists support a fixed order.')
      const existing = await order()
      if (!verifyIds(existing, baseline)) throw new Problem(409, 'order_changed', 'The playlist changed since it was loaded. Refresh before saving.')
      const unique = new Set(proposed)
      if (unique.size !== existing.length || proposed.length !== existing.length || existing.some(row => !unique.has(row.id))) {
        throw new Problem(422, 'invalid_order', 'The new order must include every current playlist entry exactly once.')
      }
      if (!verifyIds(existing, proposed)) {
        await az(rotationPath + '/order', json({ order: Object.fromEntries(proposed.map((entry, position) => [entry, position + 1])) }))
      }
      const refreshed = await playlist(1, false)
      if (refreshed.tracks.length !== proposed.length || refreshed.tracks.some((row, index) => row.entryId !== proposed[index])) {
        throw new Problem(409, 'order_verification', 'The saved order could not be verified. Refresh and review the playlist before retrying.')
      }
      return refreshed
    },
  }
}
