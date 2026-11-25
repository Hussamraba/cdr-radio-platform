import { AudioLines, BookOpen, Copy, Headphones, History, Link2, ListEnd, Radio, Users } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { HeroArtwork } from '../components/HeroArtwork'
import { TrackDisplay } from '../components/TrackDisplay'
import { formatDuration } from '../utils/format'
import { EmptyState, ErrorState, LoadingState, PageHeading, Reveal, SectionCard, StatCard, StationBadge } from '../components/ui'
import { useStation } from '../hooks/station-context'
import { config } from '../services/config'

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function ShareLink({ label, url }: { label: string; url: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [feedback, setFeedback] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setFeedback(`${label} link copied.`)
    } catch {
      input.current?.focus()
      input.current?.select()
      setFeedback('Link selected. Use your device’s copy command.')
    }
  }

  return (
    <div className="share-link">
      <a className="text-link" href={url}>{label}</a>
      <div className="copy-row">
        <input ref={input} aria-label={`${label} URL`} value={url} readOnly />
        <button type="button" className="button button-secondary button-small" aria-label={`Copy ${label} link`} onClick={() => void copy()}>
          <Copy size={15} aria-hidden="true" /> Copy
        </button>
      </div>
      <p className="field-note" role="status">{feedback}</p>
    </div>
  )
}

export function Dashboard() {
  const { phase, data, status, error, refresh } = useStation()
  const listeners = data?.listeners.current
  const nextTrack = status === 'offline' ? undefined : data?.next

  return (
    <div className="page dashboard">
      <Reveal>
        <PageHeading title="Dashboard" description="Monitor the central broadcast and share the listening links with branches." />
      </Reveal>
      <Reveal delay={0.045}>
        <section className="hero" aria-labelledby="hero-title">
          <HeroArtwork />
          <div className="hero-content">
            <div className="hero-label"><Radio size={15} aria-hidden="true" /> Central broadcast</div>
            <h2 id="hero-title">One Stream.<br /><span>Every Branch.</span></h2>
            <p>A shared soundtrack for every Ghammas Baladi location.</p>
            <div className="hero-actions">
              <Link className="button button-primary" to="/player"><Headphones size={17} aria-hidden="true" /> Branch Player</Link>
              <Link className="button button-hero" to="/library"><BookOpen size={17} aria-hidden="true" /> Music Management</Link>
            </div>
          </div>
        </section>
      </Reveal>
      <div className="stats-grid">
        <Reveal delay={0.075}><StatCard icon={Radio} label="Station status" value={<StationBadge status={status} />} detail={data?.name ?? 'Reported by AzuraCast'} /></Reveal>
        <Reveal delay={0.11}><StatCard icon={Users} label="Station listeners" value={listeners?.toLocaleString() ?? '—'} detail={listeners === undefined ? 'Listener data unavailable' : 'Across the whole station'} accent="lilac" /></Reveal>
      </div>
      <div className="dashboard-grid">
        <Reveal delay={0.15}>
          <SectionCard title="Now playing" icon={AudioLines} className="now-card">
            {phase === 'loading' ? <LoadingState /> : phase === 'error' && error ? <ErrorState message={error} onRetry={refresh} /> : (
              <div className="now-track">
                <TrackDisplay track={data?.current} large emptyTitle={status === 'offline' ? 'Station offline' : undefined} emptyText={status === 'offline' ? 'Track details return when the broadcast resumes.' : 'Track details will appear when available.'} />
                <div className="track-timing">
                  {data?.current?.duration && data.current.elapsed !== undefined
                    ? <progress aria-label="Track progress at last update" value={Math.min(data.current.elapsed, data.current.duration)} max={data.current.duration} />
                    : <div className="track-progress-empty" aria-hidden="true" />}
                  <div className="track-time"><span>{formatDuration(data?.current?.elapsed)}</span><span>{formatDuration(data?.current?.duration)}</span></div>
                </div>
              </div>
            )}
            <div className="next-track">
              <div className="subheading"><ListEnd size={16} aria-hidden="true" /> Up next</div>
              {nextTrack ? <TrackDisplay track={nextTrack} /> : <p>{phase === 'loading' ? 'Checking upcoming tracks…' : phase === 'error' ? 'Upcoming track data unavailable.' : 'No upcoming track available.'}</p>}
            </div>
          </SectionCard>
        </Reveal>
        <Reveal delay={0.175}>
          <SectionCard title="Recently played" icon={History} className="activity-card">
            {phase === 'loading' ? <LoadingState label="Checking track history…" /> : data?.history.length ? (
              <ul className="activity-list">
                {data.history.slice(0, 5).map((track, index) => (
                  <li key={`${track.playedAt}-${track.title}-${index}`}>
                    <TrackDisplay track={track} />
                    {track.playedAt ? <time dateTime={new Date(track.playedAt * 1000).toISOString()}>{timeFormat.format(track.playedAt * 1000)}</time> : null}
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={History} title={phase === 'error' ? 'Track history unavailable' : 'No recent plays'} description={phase === 'error' ? 'Retry the metadata check to reload the history.' : 'Track history will appear when the station reports plays.'} compact />}
          </SectionCard>
        </Reveal>
      </div>
      <Reveal delay={0.2}>
        <SectionCard title="Listening links" icon={Link2}>
          <div className="share-links">
            <ShareLink label="Public player" url={config.publicPlayerUrl} />
            <ShareLink label="Direct MP3" url={config.publicStreamUrl} />
          </div>
        </SectionCard>
      </Reveal>
    </div>
  )
}
