import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { Request } from 'express'
import { z } from 'zod'
import { Problem } from './errors.js'

const execute = promisify(execFile)
const invalidMedia = () => new Problem(422, 'invalid_audio', 'The file must contain valid MP3 or PCM WAV audio.')
const probeSchema = z.object({
  streams: z.array(z.object({ codec_name: z.string() })),
  format: z.object({ duration: z.coerce.number().finite().positive() }),
})

export interface PreparedUpload {
  localPath: string
  digest: string
  azuraPath: string
  size: number
}

export async function withUpload<T>(req: Request, limit: number, consume: (file: PreparedUpload) => Promise<T>) {
  const filename = req.get('x-file-name') ?? ''
  let decoded: string
  try { decoded = decodeURIComponent(filename) }
  catch { throw new Problem(400, 'filename', 'Invalid file name.') }
  if (req.get('content-type') !== 'application/octet-stream') throw invalidMedia()
  const length = req.get('content-length') ?? ''
  const size = /^\d+$/.test(length) ? Number(length) : 0
  return prepareUpload(req, decoded, size, limit, consume)
}

export async function prepareUpload<T>(input: Readable, filename: string, size: number, limit: number, consume: (file: PreparedUpload) => Promise<T>) {
  if (!filename || filename.length > 160 || filename.startsWith('.') || /[\\/:\p{Cc}\p{Cf}]/u.test(filename)) {
    throw new Problem(400, 'filename', 'Use a plain file name without folders or control characters.')
  }
  const extension = filename.match(/\.(mp3|wav)$/i)?.[1].toLowerCase()
  if (!extension) throw invalidMedia()
  if (!Number.isInteger(size) || size < 1) throw new Problem(400, 'upload_length', 'A non-empty file with a known size is required.')
  if (size > limit) throw new Problem(413, 'upload_size', 'This file exceeds the upload size limit.')

  const folder = await mkdtemp(join(tmpdir(), 'ghmaas-upload-'))
  const localPath = join(folder, 'source.' + extension)
  try {
    const hash = createHash('sha256')
    let bytes = 0
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length
        if (bytes > limit || bytes > size) {
          done(new Problem(413, 'upload_size', 'This file exceeds the upload size limit.'))
          return
        }
        hash.update(chunk)
        done(null, chunk)
      },
    })
    await pipeline(input, measure, createWriteStream(localPath, { mode: 0o600, flags: 'wx' }), { signal: AbortSignal.timeout(300_000) })
    if (bytes !== size) throw new Problem(400, 'upload_length', 'The upload ended early. Please retry.')
    try {
      const result = await execute('ffprobe', [
        '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', extension, '-select_streams', 'a',
        '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', localPath,
      ], { timeout: 10_000, maxBuffer: 64 * 1024 })
      const audio = probeSchema.parse(JSON.parse(result.stdout))
      const codec = audio.streams[0]?.codec_name
      if (audio.streams.length !== 1 || !codec || (extension === 'mp3' ? codec !== 'mp3' : !codec.startsWith('pcm_'))) throw invalidMedia()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Problem(503, 'audio_validator', 'The audio validator is unavailable.')
      throw invalidMedia()
    }
    const digest = hash.digest('hex')
    const stem = filename.slice(0, -4).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'track'
    return await consume({ localPath, digest, azuraPath: `cdr-${digest}-${stem}.${extension}`, size })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

export function encodeFile(path: string, destination: string, size: number) {
  const head = Buffer.from('{"path":' + JSON.stringify(destination) + ',"file":"')
  const tail = Buffer.from('"}')
  const body = Readable.from((async function* () {
    yield head
    let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    for await (const chunk of createReadStream(path, { highWaterMark: 48 * 1024 })) {
      const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk as Buffer
      const boundary = bytes.length - bytes.length % 3
      if (boundary) yield bytes.subarray(0, boundary).toString('base64')
      pending = bytes.subarray(boundary)
    }
    if (pending.length) yield pending.toString('base64')
    yield tail
  })())
  return { body, length: head.length + Math.ceil(size / 3) * 4 + tail.length }
}
