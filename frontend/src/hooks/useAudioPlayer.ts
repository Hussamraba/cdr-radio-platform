import { useEffect, useRef, useState } from 'react'
import { readPreference } from './preferences'

type PlaybackState = 'idle' | 'connecting' | 'playing' | 'buffering' | 'stalled' | 'paused' | 'reconnecting' | 'blocked' | 'error'
interface PlaybackDiagnostics {
  position: number
  readyState: number
  networkState: number
  bufferedSeconds?: number
  lastSignal: string
  signalAt: number
  lastAdvanceAt?: number
  errorCode?: number
}
const volumeKey = 'ghmaas.playerVolume'
const mutedKey = 'ghmaas.playerMuted'
const maxReconnectAttempts = 4
const stallThresholdMs = 3000

function initialVolume() {
  const saved = readPreference(volumeKey)
  if (saved === null) return 0.75
  const volume = Number(saved)
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.75
}

export function useAudioPlayer(url: string) {
  const [state, setState] = useState<PlaybackState>('idle')
  const [startDelayMs, setStartDelayMs] = useState<number>()
  const [volume, setVolume] = useState(initialVolume)
  const [muted, setMuted] = useState(() => readPreference(mutedKey) === 'true')
  const [systemVolume, setSystemVolume] = useState(false)
  const [diagnostics, setDiagnostics] = useState<PlaybackDiagnostics>()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const toggle = useRef<() => void>(null)

  useEffect(() => {
    const source = url
    const audio = new Audio()
    const lifetime = new AbortController()
    const options = { signal: lifetime.signal }
    audioRef.current = audio
    audio.preload = 'none'
    let requested = false
    let attempt = 0
    let generation = 0
    let startedAt: number | undefined
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let monitor: ReturnType<typeof setInterval> | undefined
    let lastPosition = 0
    let lastAdvance = 0
    let lastAdvanceAt: number | undefined
    let lastSignal = 'Starting'
    let signalAt = 0

    function publishDiagnostics() {
      const position = audio.currentTime
      const ranges = audio.buffered
      let bufferedSeconds: number | undefined
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= position && position <= ranges.end(i)) {
          bufferedSeconds = ranges.end(i) - position
          break
        }
      }
      setDiagnostics({ position, bufferedSeconds, readyState: audio.readyState, networkState: audio.networkState,
        lastSignal, signalAt, lastAdvanceAt, errorCode: audio.error?.code })
    }

    function signal(name: string) {
      lastSignal = name
      signalAt = Date.now()
      publishDiagnostics()
    }

    function observeProgress() {
      if (!requested || reconnect !== undefined || audio.paused) return
      const now = performance.now()
      const position = audio.currentTime
      if (position > lastPosition) {
        lastPosition = position
        lastAdvance = now
        lastAdvanceAt = Date.now()
        clearTimeout(watchdog)
        watchdog = undefined
        if (startedAt !== undefined) {
          setStartDelayMs(now - startedAt)
          startedAt = undefined
        }
        attempt = 0
        setState('playing')
      } else if (position < lastPosition) {
        lastPosition = position
        lastAdvance = now
        lastAdvanceAt = undefined
      } else if (!document.hidden && startedAt === undefined && now - lastAdvance >= stallThresholdMs) {
        setState(audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ? 'buffering' : 'stalled')
      }
    }

    function releaseStream() {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }

    function stop(next: PlaybackState) {
      requested = false
      generation += 1
      clearTimeout(reconnect)
      clearTimeout(watchdog)
      clearInterval(monitor)
      monitor = undefined
      reconnect = undefined
      watchdog = undefined
      releaseStream()
      setState(next)
    }

    function waitForAudio() {
      if (watchdog === undefined) {
        watchdog = setTimeout(() => {
          watchdog = undefined
          retry()
        }, 12_000)
      }
    }

    function retry() {
      if (!requested || reconnect !== undefined) return
      if (attempt >= maxReconnectAttempts) {
        stop('error')
        return
      }
      generation += 1
      clearTimeout(watchdog)
      watchdog = undefined
      const delay = 2 ** attempt * 2000
      attempt += 1
      setState('reconnecting')
      signal('Reconnect scheduled')
      reconnect = setTimeout(() => {
        reconnect = undefined
        start(true)
      }, delay)
      releaseStream()
    }

    function start(retrying = false) {
      if (!requested) return
      const playback = ++generation
      setState(retrying ? 'reconnecting' : 'connecting')
      startedAt = performance.now()
      lastAdvance = startedAt
      lastAdvanceAt = undefined
      lastPosition = 0
      audio.src = source
      signal(retrying ? 'Reconnect started' : 'Play requested')
      waitForAudio()
      void audio.play().catch((error: DOMException) => {
        if (!requested || playback !== generation) return
        if (error.name === 'NotAllowedError') stop('blocked')
        else if (error.name === 'NotSupportedError') handleMediaError()
        else retry()
      })
    }

    audio.addEventListener('playing', () => { observeProgress(); if (requested) signal('playing') }, options)
    audio.addEventListener('timeupdate', observeProgress, options)
    audio.addEventListener('canplay', () => { if (requested) signal('canplay') }, options)
    audio.addEventListener('stalled', () => { if (requested) signal('stalled') }, options)
    audio.addEventListener('waiting', () => {
      if (requested && reconnect === undefined) {
        signal('waiting')
        setState(attempt ? 'reconnecting' : startedAt === undefined ? 'buffering' : 'connecting')
        waitForAudio()
      }
    }, options)
    audio.addEventListener('ended', () => { if (requested) signal('ended'); retry() }, options)
    function handleMediaError() {
      if (!requested) return
      signal('error')
      // A failed HTTP response can be reported as an unsupported source.
      if (audio.error?.code === MediaError.MEDIA_ERR_DECODE) stop('error')
      else retry()
    }

    audio.addEventListener('error', handleMediaError, options)
    audio.addEventListener('pause', () => {
      if (requested && reconnect === undefined && audio.getAttribute('src') && audio.paused && !audio.ended && !audio.error) {
        signal('pause')
        stop('paused')
      }
    }, options)

    document.addEventListener('visibilitychange', () => {
      if (requested && !document.hidden) {
        lastAdvance = performance.now()
        observeProgress()
      }
    }, options)

    toggle.current = () => {
      if (requested) {
        signal('Pause requested')
        stop('paused')
        return
      }
      requested = true
      attempt = 0
      monitor = setInterval(() => { observeProgress(); publishDiagnostics() }, 1000)
      start()
    }

    return () => {
      requested = false
      clearTimeout(reconnect)
      clearTimeout(watchdog)
      clearInterval(monitor)
      lifetime.abort()
      releaseStream()
      audioRef.current = null
      toggle.current = null
    }
  }, [url])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
      audioRef.current.muted = muted
    }
    try {
      localStorage.setItem(volumeKey, String(volume))
      localStorage.setItem(mutedKey, String(muted))
    } catch {
      // Controls remain usable when storage is disabled.
    }
  }, [muted, url, volume])

  const active = state === 'playing' || state === 'connecting' || state === 'buffering' || state === 'stalled' || state === 'reconnecting'

  function changeVolume(next: number) {
    const audio = audioRef.current
    if (audio) {
      audio.volume = next
      setSystemVolume(Math.abs(audio.volume - next) > 0.01)
    }
    setVolume(next)
    if (next > 0 && muted) setMuted(false)
  }

  return {
    state, active, volume, muted, systemVolume, changeVolume, diagnostics,
    startDelayMs: state === 'playing' ? startDelayMs : undefined,
    togglePlayback: () => toggle.current?.(),
    toggleMute: () => {
      if (!muted && volume === 0) setVolume(0.75)
      else setMuted(!muted)
    },
  }
}
