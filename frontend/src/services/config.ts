export function publicHttpUrl(value: unknown, base?: string) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value.trim(), base)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) {
      return url
    }
  } catch {
    return undefined
  }
}

const station = import.meta.env.VITE_AZURACAST_STATION?.trim() || 'ghmaas_baladi_radio'
const stationPath = encodeURIComponent(station)
const streamOverride = publicHttpUrl(import.meta.env.VITE_STREAM_URL, window.location.origin)
const defaultStreamPath = `/listen/${stationPath}/radio.mp3`
const streamUrl = streamOverride?.href ?? defaultStreamPath
const configuredPublicOrigin = publicHttpUrl(import.meta.env.VITE_PUBLIC_RADIO_ORIGIN)
const publicOrigin = configuredPublicOrigin?.protocol === 'https:' ? configuredPublicOrigin.origin
  : window.location.protocol === 'https:' ? window.location.origin : 'https://hussam.tail1a8390.ts.net'
const shareStream = streamOverride?.origin === window.location.origin ? streamOverride.pathname + streamOverride.search
  : streamOverride?.protocol === 'https:' ? streamOverride.href : defaultStreamPath

export const config = {
  station,
  streamUrl,
  nowPlayingUrl: `/api/nowplaying/${stationPath}`,
  publicPlayerUrl: new URL('/player', publicOrigin).href,
  publicStreamUrl: new URL(shareStream, publicOrigin).href,
}
