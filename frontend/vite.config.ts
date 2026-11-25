import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'AZURACAST_')
  const target = new URL(env.AZURACAST_ORIGIN?.trim() || 'http://localhost')
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password
    || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('AZURACAST_ORIGIN must be an HTTP(S) origin without credentials or a path.')
  }

  const publicEndpoint: ProxyOptions = {
    target: target.origin,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (request) => {
        request.removeHeader('authorization')
        request.removeHeader('cookie')
      })
      proxy.on('proxyRes', (response) => {
        delete response.headers['set-cookie']
      })
    },
  }
  return {
    plugins: [react()],
    server: {
      proxy: {
        '^/api/nowplaying/[\\w-]+(?:\\?.*)?$': publicEndpoint,
        '^/api/station/[\\w-]+/art/[\\w-]+(?:\\.[\\w-]+)?(?:\\?.*)?$': publicEndpoint,
        '^/static/vite_dist/assets/generic_song-[\\w-]+\\.jpg(?:\\?.*)?$': publicEndpoint,
        '^/listen/[\\w-]+/[\\w-]+\\.mp3(?:\\?.*)?$': publicEndpoint,
      },
    },
  }
})
