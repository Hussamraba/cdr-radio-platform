import { Braces, Gauge, Headphones, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ErrorState, LoadingState, PageHeading, Reveal, SectionCard, StatusBadge } from '../components/ui'
import { usePreferences } from '../hooks/preferences'
import { useStation } from '../hooks/station-context'
import { config } from '../services/config'

export function Preferences() {
  const { reducedMotion, setReducedMotion } = usePreferences()
  const { phase, data, error, refresh } = useStation()

  return (
    <div className="page">
      <Reveal>
        <PageHeading title="Preferences & Diagnostics" description="Adjust this browser’s preferences and check the station metadata connection." />
      </Reveal>
      <div className="content-grid">
        <Reveal delay={0.035}>
          <SectionCard title="This browser" icon={Gauge}>
            <label className="switch-row">
              <span><strong>Reduce motion</strong><small>Turn off dashboard animation and reduce interface motion on this device.</small></span>
              <input type="checkbox" role="switch" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} />
            </label>
            <p className="field-note">Motion, player volume, and mute preferences are saved in this browser.</p>
          </SectionCard>
        </Reveal>
        <Reveal delay={0.065}>
          <SectionCard title="Station metadata" icon={Braces}>
            <dl className="detail-list">
              <div><dt>Station shortcode</dt><dd><code>{config.station}</code></dd></div>
              <div><dt>Now Playing API</dt><dd><code>{config.nowPlayingUrl}</code></dd></div>
              <div><dt>Metadata status</dt><dd aria-live="polite"><StatusBadge label={phase === 'ready' ? 'Connected' : phase === 'loading' ? 'Checking' : 'Unavailable'} tone={phase === 'ready' ? 'live' : phase === 'error' ? 'danger' : 'neutral'} /></dd></div>
              <div><dt>Latest response</dt><dd>{data ? <time dateTime={new Date(data.receivedAt).toISOString()}>{new Date(data.receivedAt).toLocaleTimeString()}</time> : 'Unavailable'}</dd></div>
            </dl>
            {phase === 'error' && error ? <ErrorState message={error} onRetry={refresh} />
              : phase === 'loading' ? <LoadingState label="Checking metadata…" />
                : <button type="button" className="button button-secondary button-small" onClick={refresh}><RefreshCw size={16} aria-hidden="true" /> Refresh metadata</button>}
            <p className="field-note">This check refreshes Now Playing information. To verify audio, open the player and listen.</p>
            <Link className="text-link diagnostics-player-link" to="/player"><Headphones size={16} aria-hidden="true" /> Open Branch Player</Link>
          </SectionCard>
        </Reveal>
      </div>
    </div>
  )
}
