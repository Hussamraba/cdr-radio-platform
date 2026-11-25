import type { ReactNode } from 'react'
import { ErrorState, LoadingState } from '../components/ui'
import type { Track } from './api'
import type { useResource } from './useAdminResource'

export function Resource<T>({ resource, label, children }: { resource: ReturnType<typeof useResource<T>>; label: string; children: (data: T) => ReactNode }) {
  if (resource.error) return <ErrorState message={resource.error} onRetry={resource.refresh} />
  if (resource.data === undefined) return <LoadingState label={label} />
  return children(resource.data)
}

export function Pages({ page, pages, change }: { page: number; pages: number; change: (value: number) => void }) {
  if (pages < 2 && page === 1) return null
  return <nav aria-label="Results pages" className="admin-pagination">
    <button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => change(page - 1)}>Previous</button>
    <span role="status">Page {page} of {pages}</span>
    <button type="button" className="button button-secondary" disabled={page >= pages} onClick={() => change(page + 1)}>Next</button>
  </nav>
}

export function TrackText({ track }: { track: Track }) {
  const seconds = track.duration === null ? null : Math.floor(track.duration)
  const duration = seconds === null ? null : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
  return <div className="admin-track-text">
    <strong dir="auto">{track.title}</strong>
    <span dir="auto">{track.artist || 'Unknown artist'}</span>
    <small dir="auto">{[track.filename, track.type, duration].filter(Boolean).join(' · ')}</small>
  </div>
}
