import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { parseCookie, stringifySetCookie } from 'cookie'
import type { Request, Response } from 'express'
import type { Config } from './config.js'
import { Problem } from './errors.js'

const token = () => randomBytes(32).toString('base64url')
export const passwordLengthOkay = (password: string) => Buffer.byteLength(password) >= 12 && Buffer.byteLength(password) <= 256

export async function passwordHash(password: string, salt = randomBytes(16)) {
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 ** 2 }, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  })
  return ['scrypt', salt.toString('hex'), key.toString('hex')].join('$')
}

async function validPassword(password: string, encoded: string) {
  const [, salt, key] = encoded.split('$')
  const actual = (await passwordHash(password, Buffer.from(salt, 'hex'))).split('$')[2]
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(key, 'hex'))
}

interface Session { csrfToken: string; expiresAt: number }
function safeEqual(left: string, right: string) {
  const lhs = Buffer.from(left)
  const rhs = Buffer.from(right)
  return lhs.length === rhs.length && timingSafeEqual(lhs, rhs)
}

export function createAuth(config: Config) {
  const secure = config.origin.protocol === 'https:'
  const name = secure ? '__Host-ghmaas_admin' : 'ghmaas_admin'
  const sessions = new Map<string, Session>()
  let attempts = 0
  let pending = 0
  let windowEnds = 0
  function sessionKey(req: Request) { return parseCookie(req.headers.cookie ?? '')[name] ?? '' }

  function cookie(res: Response, value: string, maxAge: number) {
    res.setHeader('Set-Cookie', stringifySetCookie({ name, value, path: secure ? '/' : '/admin-api', httpOnly: true, sameSite: 'strict', secure, maxAge }))
  }
  function requireSession(req: Request): Session {
    const key = sessionKey(req)
    const session = sessions.get(key)
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(key)
      throw new Problem(401, 'session_required', 'Sign in to continue.')
    }
    return session
  }
  function checkOrigin(req: Request) {
    if (req.get('origin') !== config.origin.origin) throw new Problem(403, 'origin', 'This request must come from the private admin site.')
  }
  function checkCsrf(req: Request, session: Session) {
    if (!safeEqual(req.get('x-csrf-token') ?? '', session.csrfToken)) throw new Problem(403, 'csrf', 'Refresh the admin page and try again.')
  }
  async function login(req: Request, res: Response, username: string, password: string) {
    const now = Date.now()
    if (now >= windowEnds) { attempts = 0; windowEnds = now + 15 * 60_000 }
    if (attempts >= 8 || pending >= 2) {
      res.setHeader('Retry-After', pending >= 2 ? '5' : String(Math.ceil((windowEnds - now) / 1000)))
      throw new Problem(429, 'login_limit', 'Too many sign-in attempts. Wait before trying again.')
    }
    attempts++
    pending++
    let verified: boolean
    try { verified = await validPassword(password, config.passwordHash) }
    finally { pending-- }
    if (!verified || !safeEqual(username, config.username)) throw new Problem(401, 'invalid_credentials', 'Incorrect username or password.')
    attempts = Math.max(0, attempts - 1)
    for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key)
    sessions.delete(sessionKey(req))
    if (sessions.size >= 32) {
      const oldest = sessions.keys().next().value
      if (oldest) sessions.delete(oldest)
    }
    const key = token()
    const session = { csrfToken: token(), expiresAt: Date.now() + config.sessionMs }
    sessions.set(key, session)
    cookie(res, key, Math.ceil(config.sessionMs / 1000))
    return { username: config.username, ...session }
  }
  function logout(req: Request, res: Response) {
    sessions.delete(sessionKey(req))
    cookie(res, '', 0)
  }
  return { requireSession, checkOrigin, checkCsrf, login, logout }
}
