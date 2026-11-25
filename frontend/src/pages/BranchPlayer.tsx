import { AudioLines, ChevronLeft, Headphones } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AudioPlayer } from '../components/AudioPlayer'
import { Brand, StationBadge } from '../components/ui'
import { useStation } from '../hooks/station-context'
import { config } from '../services/config'

export function BranchPlayer() {
  const { status, data } = useStation()

  useEffect(() => {
    document.title = 'Branch Player | Ghmaas Baladi Radio'
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="branch-shell">
      <header className="branch-header">
        <Brand />
        <Link to="/" className="button button-secondary"><ChevronLeft size={17} aria-hidden="true" /> Dashboard</Link>
      </header>
      <main className="branch-main">
        <section className="branch-listening" aria-labelledby="branch-player-title">
          <div className="branch-radio-icon"><AudioLines size={52} strokeWidth={1.4} aria-hidden="true" /></div>
          <div className="branch-status" aria-live="polite"><span>Station status</span> <StationBadge status={status} /></div>
          <h1 id="branch-player-title">Branch Player</h1>
          <p className="branch-subtitle"><Headphones size={17} aria-hidden="true" /> Ghmaas Baladi Radio</p>
          <AudioPlayer
            streamUrl={config.streamUrl}
            track={data?.current}
            stationStatus={status}
            listeners={data?.listeners.current}
          />
          <p className="branch-help">Every branch uses this player without registration. Tap Play to start. Pause, mute, and volume affect this device only.</p>
          <details className="branch-instructions">
            <summary>Listening at your branch</summary>
            <ul>
              <li>Bookmark the <a href={config.publicPlayerUrl}>public player link</a> on your branch device.</li>
              <li>If Wi-Fi drops, wait for the player to reconnect. After Wi-Fi returns, tap Retry if playback is unavailable.</li>
              <li>If you hear silence, open Playback diagnostics and check whether Playback position advances.</li>
              <li>Approved administrators manage the central playlist in the private Ghmaas Admin Panel.</li>
            </ul>
          </details>
        </section>
      </main>
    </div>
  )
}
