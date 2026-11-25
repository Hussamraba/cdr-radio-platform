import { resolve } from 'node:path'

export const defaultAdminPort = 18090
export const tailnetSocket = '/run/ghmaas-tailnet/admin.sock'
export const station = { id: 1, shortcode: 'ghmaas_baladi_radio', playlist: { id: 2, name: 'Ghmaas Main Rotation' } } as const

export interface Config {
  origin: URL
  tailnetLogin?: string
  azuraOrigin: URL
  radioOrigin: URL
  apiKey: string
  allowWrites: boolean
  uploadWindow?: { sha256: string; expiresAt: number }
  username: string
  passwordHash: string
  maxUploadBytes: number
  sessionMs: number
  upstreamMs: number
  uploadMs: number
  frontendDir: string
}

function origin(value: string, name: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(name + ' must be an HTTP(S) origin without credentials or a path.')
  }
  return url
}

export function loadTailnetConfig(env: NodeJS.ProcessEnv) {
  const hostname = env.ADMIN_TAILNET_ORIGIN?.trim()
  const login = env.ADMIN_TAILNET_LOGIN?.trim().toLowerCase()
  if (!hostname && !login) return undefined
  if (!hostname || !login || !/^[a-z0-9][a-z0-9_.+@-]{0,253}$/.test(login)) {
    throw new Error('Configure both ADMIN_TAILNET_ORIGIN and ADMIN_TAILNET_LOGIN.')
  }
  const url = origin(hostname, 'ADMIN_TAILNET_ORIGIN')
  if (url.protocol !== 'https:' || url.port || !url.hostname.endsWith('.ts.net')) {
    throw new Error('ADMIN_TAILNET_ORIGIN must be an HTTPS Tailscale hostname on port 443.')
  }
  return { origin: url, tailnetLogin: login }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const composeRuntime = env.GHMAAS_RUNTIME === 'compose'
  function required(name: string) {
    const value = env[name]?.trim()
    if (!value || value.startsWith('replace-')) throw new Error(name + ' must be set.')
    return value
  }
  const adminOrigin = origin(env.ADMIN_ORIGIN ?? `http://127.0.0.1:${defaultAdminPort}`, 'ADMIN_ORIGIN')
  if (adminOrigin.protocol === 'http:' && adminOrigin.hostname !== '127.0.0.1') {
    throw new Error('HTTP admin access requires the literal 127.0.0.1 origin.')
  }
  // Compose joins the private AzuraCast bridge and uses its fixed DNS names.
  const azuraOrigin = composeRuntime ? new URL('http://azuracast')
    : origin(env.AZURACAST_ORIGIN ?? 'http://127.0.0.1', 'AZURACAST_ORIGIN')
  if (!composeRuntime && azuraOrigin.protocol === 'http:' && azuraOrigin.hostname !== '127.0.0.1') {
    throw new Error('AzuraCast credentials require HTTPS except on 127.0.0.1.')
  }
  const apiKey = required('AZURACAST_API_KEY')
  const username = required('ADMIN_USERNAME')
  const passwordHash = required('ADMIN_PASSWORD_HASH')
  if (!/^[\x21-\x7e]{16,256}$/.test(apiKey) || !/^[\w.@-]{1,80}$/.test(username)) {
    throw new Error('Invalid admin username or AzuraCast key format.')
  }
  if (!/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(passwordHash)) throw new Error('Generate ADMIN_PASSWORD_HASH with npm run password.')
  const managementMode = env.ADMIN_MANAGEMENT_MODE ?? 'read-only'
  if (managementMode !== 'read-only' && managementMode !== 'persistent') {
    throw new Error('ADMIN_MANAGEMENT_MODE must be read-only or persistent.')
  }
  const temporaryWrites = env.ADMIN_ALLOW_WRITES ?? 'false'
  if (temporaryWrites !== 'true' && temporaryWrites !== 'false') throw new Error('ADMIN_ALLOW_WRITES must be true or false.')
  const sha256 = env.ADMIN_APPROVED_UPLOAD_SHA256
  const deadline = env.ADMIN_WRITE_WINDOW_EXPIRES_AT
  let uploadWindow: Config['uploadWindow']
  if (temporaryWrites === 'true' || sha256 || deadline) {
    if (managementMode === 'persistent') throw new Error('Persistent management and an approved upload window are mutually exclusive.')
    const expiresAt = Number(deadline)
    if (temporaryWrites !== 'true' || !sha256 || !/^[a-f0-9]{64}$/.test(sha256) || !deadline || !/^\d{13}$/.test(deadline) || expiresAt > Date.now() + 30 * 60_000) {
      throw new Error('The approved upload requires a SHA-256 and a write deadline no more than 30 minutes away.')
    }
    uploadWindow = { sha256, expiresAt }
  }
  const maxMiB = Number(env.ADMIN_UPLOAD_MIB ?? 24)
  if (!Number.isInteger(maxMiB) || maxMiB < 1 || maxMiB > 24) throw new Error('ADMIN_UPLOAD_MIB must be an integer from 1 through 24.')
  return {
    origin: adminOrigin, azuraOrigin, radioOrigin: new URL(composeRuntime ? 'http://frontend:8080' : 'http://127.0.0.1:8088'),
    apiKey, username, passwordHash, allowWrites: managementMode === 'persistent' || Boolean(uploadWindow), uploadWindow, maxUploadBytes: maxMiB * 1024 ** 2,
    sessionMs: 4 * 60 * 60_000, upstreamMs: 8_000, uploadMs: 180_000,
    frontendDir: resolve(env.ADMIN_FRONTEND_DIR ?? '../frontend/dist-admin'),
  }
}
