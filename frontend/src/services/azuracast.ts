import { config, publicHttpUrl } from './config'
import type { AzuraCastNowPlaying, AzuraCastTrack, StationSnapshot, Track } from '../types/radio'

function trimmed(value: unknown) {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function nonNegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function artworkUrl(value: unknown) {
  const url = publicHttpUrl(value, window.location.origin)
  if (!url) return undefined
  if (/^\/api\/station\/[\w-]+\/art\/[\w-]+(?:\.[\w-]+)?$/.test(url.pathname)) {
    return `${url.pathname}${url.search}`
  }
  return url.protocol === 'https:' ? url.href : undefined
}

function normalizeTrack(entry?: AzuraCastTrack | null): Track | undefined {
  const title = trimmed(entry?.song?.title) ?? trimmed(entry?.song?.text)
  if (!entry || !title) return undefined
  const playedAt = nonNegative(entry.played_at)
  return {
    title,
    artist: trimmed(entry.song?.artist),
    artwork: artworkUrl(entry.song?.art),
    duration: nonNegative(entry.duration),
    elapsed: nonNegative(entry.elapsed),
    playedAt: playedAt !== undefined && Number.isFinite(new Date(playedAt * 1000).getTime()) ? playedAt : undefined,
  }
}

function isNowPlaying(value: unknown): value is AzuraCastNowPlaying {
  if (typeof value !== 'object' || !value || !('station' in value) || !('is_online' in value)) return false
  return typeof value.station === 'object' && value.station !== null && !Array.isArray(value.station)
    && ('name' in value.station || 'id' in value.station || 'shortcode' in value.station)
    && typeof value.is_online === 'boolean'
}

export async function getNowPlaying(signal: AbortSignal): Promise<StationSnapshot> {
  const response = await fetch(config.nowPlayingUrl, {
    signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`The station API returned HTTP ${response.status}.`)
  const payload: unknown = await response.json()
  if (!isNowPlaying(payload)) throw new Error('The station API returned an unexpected response.')

  const online = payload.is_online
  const total = nonNegative(payload.listeners?.total)
  return {
    name: trimmed(payload.station.name),
    description: trimmed(payload.station.description),
    online,
    listeners: {
      current: nonNegative(payload.listeners?.current) ?? total,
      total,
      unique: nonNegative(payload.listeners?.unique),
    },
    current: online ? normalizeTrack(payload.now_playing) : undefined,
    next: normalizeTrack(payload.playing_next),
    history: Array.isArray(payload.song_history)
      ? payload.song_history.flatMap((entry) => {
          const track = normalizeTrack(entry)
          return track ? [track] : []
        })
      : [],
    receivedAt: Date.now(),
  }
}
