import { constants } from 'node:fs'
import { access, lstat, realpath, rm, stat } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { ListenOptions } from 'node:net'
import { dirname, resolve } from 'node:path'
import { createAdminApp, createMusicChangeGuard } from './app.js'
import { defaultAdminPort, loadConfig, loadTailnetConfig, tailnetSocket, type Config } from './config.js'

try {
  const config = loadConfig(process.env)
  const file = await realpath(config.frontendDir)
  const publicBuild = await realpath(resolve('../frontend/dist')).catch(() => resolve('../frontend/dist'))
  if (file === publicBuild || file.startsWith(publicBuild + '/')) throw new Error('Use a separate private build directory.')
  await access(resolve(file, 'index.html'), constants.R_OK)
  if ((await stat(resolve(file, 'index.html'))).size === 0) throw new Error('Build the private frontend first.')
  const port = Number(process.env.ADMIN_LISTEN_PORT ?? defaultAdminPort)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ADMIN_LISTEN_PORT must be 1024 through 65535.')
  if (config.origin.protocol === 'http:' && config.origin.port !== String(port)) throw new Error('Use the listen port in the local ADMIN_ORIGIN.')
  const composeRuntime = process.env.GHMAAS_RUNTIME === 'compose'
  const bindAddress = composeRuntime ? '0.0.0.0' : '127.0.0.1'
  const tailnet = loadTailnetConfig(process.env)
  if (tailnet) {
    const directory = await stat(dirname(tailnetSocket))
    if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) {
      throw new Error('Create the private admin socket directory with mode 700 and the runtime UID as owner.')
    }
    const existing = await lstat(tailnetSocket).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    if (existing && !existing.isSocket()) throw new Error('The private admin socket path is occupied.')
    if (existing) await rm(tailnetSocket)
  }
  const change = createMusicChangeGuard(config)
  const listeners: Server[] = []
  function shutdown() {
    for (const server of listeners) server.close()
    setTimeout(() => { for (const server of listeners) server.closeAllConnections() }, 10_000).unref()
  }
  function listen(settings: Config, binding: ListenOptions, message: string) {
    const server = createAdminApp(settings, undefined, change).listen(binding, () => console.info(message))
    listeners.push(server)
    server.headersTimeout = 10_000
    server.requestTimeout = 310_000
    server.on('error', () => {
      console.error('The private listener could not start. Check the port and socket configuration.')
      process.exitCode = 1
      shutdown()
    })
  }
  listen(config, { port, host: bindAddress }, 'Private admin listening on port ' + port)
  if (tailnet) listen({ ...config, ...tailnet }, { path: tailnetSocket }, 'Private admin listening on its Tailscale socket')
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
} catch {
  console.error('Private admin configuration or build is invalid. Check backend/.env and the private build directory.')
  process.exitCode = 1
}
