import { Music2 } from 'lucide-react'
import { useState } from 'react'
import type { Track } from '../types/radio'
import { formatDuration } from '../utils/format'

export function TrackArtwork({ artwork, large = false }: { artwork?: string; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={`track-art ${large ? 'track-art-large' : ''}`}>
      {artwork && !failed
        ? <img src={artwork} alt="" onError={() => setFailed(true)} />
        : <Music2 size={large ? 31 : 19} aria-hidden="true" />}
    </span>
  )
}

export function TrackDisplay({ track, large = false, emptyTitle = 'No track playing', emptyText = 'Track details will appear when available.' }: {
  track?: Track; large?: boolean; emptyTitle?: string; emptyText?: string
}) {
  return (
    <div className="track-display">
      <TrackArtwork key={track?.artwork} artwork={track?.artwork} large={large} />
      <div className="track-names">
        <strong dir="auto">{track?.title ?? emptyTitle}</strong>
        <span dir="auto">{(track ? track.artist : emptyText) ?? 'Unknown artist'}</span>
      </div>
      {track?.duration !== undefined && !large && <span className="track-duration">{formatDuration(track.duration)}</span>}
    </div>
  )
}
