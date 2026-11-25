import { LoaderCircle, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useId } from 'react'
import type { CSSProperties } from 'react'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import type { StationStatus, Track } from '../types/radio'
import { TrackDisplay } from './TrackDisplay'
import { StatusBadge } from './ui'

const secondsFormat = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'second', maximumFractionDigits: 1 })
const ammanTime = new Intl.DateTimeFormat(undefined, { timeZone: 'Asia/Amman', timeStyle: 'medium' })

export function AudioPlayer({ streamUrl, track, stationStatus, listeners }: {
  streamUrl: string
  track?: Track
  stationStatus: StationStatus
  listeners?: number
}) {
  const audio = useAudioPlayer(streamUrl)
  const volumeId = useId()
  const waiting = audio.state === 'connecting' || audio.state === 'buffering' || audio.state === 'stalled' || audio.state === 'reconnecting'
  const action = audio.active ? 'Pause' : audio.state === 'error' ? 'Retry' : 'Play'
  const labels = {
    idle: 'Ready to play',
    connecting: 'Connecting…',
    playing: 'Playback advancing',
    buffering: 'Buffering…',
    stalled: 'Playback stalled',
    paused: 'Paused',
    reconnecting: 'Reconnecting…',
    blocked: 'Playback requires a tap',
    error: 'Playback unavailable',
  }
  const guidance: Partial<Record<keyof typeof labels, string>> = {
    buffering: 'Keep this page open while the player buffers audio.',
    stalled: 'The browser’s playback clock has stopped advancing.',
    reconnecting: 'Check your network and keep this page open while the player reconnects.',
    blocked: 'Tap Play again to start audio on this device.',
    error: 'Check your connection, then tap Retry to rejoin the broadcast.',
  }
  const message = guidance[audio.state]

  return (
    <div className="audio-player audio-player-branch">
      <div className="player-main">
        <div className="player-transport">
          <button className="play-button" type="button" aria-label={`${action} stream`} onClick={audio.togglePlayback}>
            {waiting ? <LoaderCircle className="spinner" size={27} aria-hidden="true" /> : audio.active ? <Pause size={26} fill="currentColor" aria-hidden="true" /> : <Play size={26} fill="currentColor" aria-hidden="true" />}
          </button>
          <span aria-hidden="true">{action}</span>
        </div>
        <TrackDisplay track={track} emptyTitle="Station audio" emptyText="Track information unavailable" />
      </div>
      <div className="player-secondary">
        <div className="player-status" aria-live="polite">
          <StatusBadge label={labels[audio.state]} tone={waiting ? 'warning' : audio.state === 'error' ? 'danger' : 'neutral'} />
        </div>
        <div className="volume">
          <button type="button" className="icon-button" aria-label={audio.muted || audio.volume === 0 ? 'Unmute audio' : 'Mute audio'} onClick={audio.toggleMute}>
            {audio.muted || audio.volume === 0 ? <VolumeX size={19} aria-hidden="true" /> : <Volume2 size={19} aria-hidden="true" />}
          </button>
          <label className="sr-only" htmlFor={volumeId}>Volume</label>
          <input id={volumeId} type="range" min="0" max="100" value={Math.round(audio.volume * 100)}
            aria-valuetext={`${Math.round(audio.volume * 100)} percent`}
            style={{ '--volume': `${audio.volume * 100}%` } as CSSProperties}
            onChange={(event) => audio.changeVolume(Number(event.currentTarget.value) / 100)} />
          <span className="volume-value" aria-hidden="true">{Math.round(audio.volume * 100)}%</span>
        </div>
      </div>
      {message && <p className="player-message" role="status">{message}</p>}
      {audio.systemVolume && <p className="player-message" role="status">Use the device volume controls to adjust the output.</p>}
      <details className="player-diagnostics">
        <summary>Playback diagnostics</summary>
        <p>The browser’s playback clock can advance during silence.</p>
        <dl>
          <div><dt>This player</dt><dd>{labels[audio.state]}</dd></div>
          <div><dt>Station now playing</dt><dd dir="auto">{track?.title ?? 'Unavailable'}</dd></div>
          <div><dt>Station listeners</dt><dd>{listeners?.toLocaleString() ?? (stationStatus === 'checking' ? 'Checking…' : 'Unavailable')}</dd></div>
          <div><dt>Local startup delay</dt><dd>{audio.startDelayMs === undefined ? '—' : secondsFormat.format(audio.startDelayMs / 1000)}</dd></div>
          <div><dt>Delay from live</dt><dd>Unavailable for this stream</dd></div>
          {audio.diagnostics && <>
            <div><dt>Playback position</dt><dd>{secondsFormat.format(audio.diagnostics.position)}</dd></div>
            <div><dt>Buffered ahead</dt><dd>{audio.diagnostics.bufferedSeconds === undefined ? 'Unavailable' : secondsFormat.format(audio.diagnostics.bufferedSeconds)}</dd></div>
            <div><dt>Media readiness / network state</dt><dd>{audio.diagnostics.readyState} / {audio.diagnostics.networkState}</dd></div>
            <div><dt>Last media signal (Amman)</dt><dd>{audio.diagnostics.lastSignal} · {ammanTime.format(audio.diagnostics.signalAt)}</dd></div>
            <div><dt>Last clock advance (Amman)</dt><dd>{audio.diagnostics.lastAdvanceAt === undefined ? '—' : ammanTime.format(audio.diagnostics.lastAdvanceAt)}</dd></div>
            {audio.diagnostics.errorCode && <div><dt>Media error code</dt><dd>{audio.diagnostics.errorCode}</dd></div>}
          </>}
        </dl>
      </details>
    </div>
  )
}
