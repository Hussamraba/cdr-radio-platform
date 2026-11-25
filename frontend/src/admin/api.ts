export const expiredEvent = 'ghmaas-admin-session-expired'
const prefix = '/admin-api'

export interface Session {
  username: string; csrfToken: string; expiresAt: number; uploadLimit: number; canWrite: boolean; uploadWindowEndsAt?: number
  managementMode?: 'read-only' | 'persistent' | 'approved-upload'
}
export interface Track { id: number; title: string; artist: string | null; filename: string; type: string; duration: number | null }
export interface MusicFile extends Track { playlists: { id: number; name: string; folder: boolean; count: number }[] }
export interface MusicPage { page: number; total: number; pages: number; rows: MusicFile[] }
export interface Rotation {
  id: number; name: string; enabled: boolean; source: string; type: string; scheduled: boolean
  mode: 'sequential' | 'shuffle' | 'random'
}
export interface Playlist extends Rotation {
  activePlaylist: string | null; editableOrder: boolean; page: number; pages: number; total: number
  tracks: (Track & { entryId: number | null })[]
}
interface RadioSong { title: string; artist: string | null; playlist: string | null }
export interface Station {
  name: string; online: boolean; listeners: number | null; current: RadioSong | null; next: RadioSong | null; rotation: Rotation
}

export class AdminError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function responseError(status: number, body: unknown, authenticate: boolean) {
  if (status === 401 && authenticate) window.dispatchEvent(new Event(expiredEvent))
  const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  return new AdminError(status, typeof payload.code === 'string' ? payload.code : 'request', typeof payload.message === 'string'
    ? payload.message : 'The admin request could not be completed. Please try again.')
}

export async function adminRequest<T>(path: string, options?: { method?: string; csrf?: string; body?: object; signal?: AbortSignal }) {
  const headers = new Headers({ Accept: 'application/json' })
  if (options?.csrf) headers.set('X-CSRF-Token', options.csrf)
  if (options?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(prefix + path, {
    method: options?.method ?? 'GET', body: options?.body && JSON.stringify(options.body), headers,
    credentials: 'same-origin', cache: 'no-store', signal: options?.signal,
  })
  if (response.status === 204) return undefined as T
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw responseError(response.status, body, path !== '/auth/login')
  if (body === null) throw new AdminError(502, 'response', 'The admin service returned an unexpected response.')
  return body as T
}

export function uploadMusic(file: File, csrf: string, onProgress: (percent: number) => void, signal: AbortSignal) {
  return new Promise<MusicFile>((resolve, reject) => {
    const request = new XMLHttpRequest()
    const abort = () => request.abort()
    if (signal.aborted) { reject(new DOMException('Upload cancelled.', 'AbortError')); return }
    request.open('POST', prefix + '/media/upload')
    request.timeout = 510_000
    request.responseType = 'json'
    request.setRequestHeader('Content-Type', 'application/octet-stream')
    request.setRequestHeader('X-CSRF-Token', csrf)
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
    request.upload.onprogress = ({ lengthComputable, loaded, total }) => {
      if (lengthComputable && total > 0) onProgress(Math.min(100, Math.floor(100 * loaded / total)))
    }
    request.upload.onload = () => onProgress(100)
    request.onload = () => {
      if (request.status === 201 && request.response) resolve(request.response as MusicFile)
      else reject(responseError(request.status, request.response, true))
    }
    request.onerror = request.ontimeout = () => reject(new AdminError(503, 'upload_network',
      'The upload connection was interrupted. Check the library before retrying.'))
    request.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'))
    request.onloadend = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    request.send(file)
  })
}

export const mainRotationId = 2
export async function setMembership(trackId: number, add: boolean, csrf: string, signal?: AbortSignal): Promise<MusicFile> {
  const path = '/playlists/' + mainRotationId + '/tracks'
  const result = await adminRequest<MusicFile & { rotationVerified?: true }>(add ? path : path + '/' + trackId,
    add ? { method: 'POST', csrf, body: { trackId }, signal } : { method: 'DELETE', csrf, signal })
  if (result?.rotationVerified !== true || result.id !== trackId || !Array.isArray(result.playlists)
    || result.playlists.some(item => item?.id === mainRotationId) !== add) {
    throw new AdminError(502, 'membership_verification', 'Main Rotation membership could not be confirmed. Refresh and check the track before retrying.')
  }
  return result
}

export function message(error: unknown) {
  return error instanceof AdminError ? error.message : 'Could not connect to the private admin service. Try again.'
}

export function fileSize(bytes: number) {
  return bytes < 1024 ** 2 ? Math.max(1, Math.ceil(bytes / 1024)) + ' KiB' : (bytes / 1024 ** 2).toFixed(1) + ' MiB'
}
