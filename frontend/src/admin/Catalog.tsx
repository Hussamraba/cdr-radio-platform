import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, AudioLines, Disc3, Library, Music2, RefreshCw, Upload, Users } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState, PageHeading, SectionCard, StatCard, StatusBadge } from '../components/ui'
import { config } from '../services/config'
import { adminRequest, mainRotationId, message, setMembership, type MusicPage, type Playlist, type Station } from './api'
import { Pages, Resource, TrackText } from './shared'
import { useResource } from './useAdminResource'

export function OverviewPage() {
  const resource = useResource<Station>('/station')
  const { refresh } = resource
  useEffect(() => {
    const timer = window.setInterval(refresh, 12_000)
    return () => window.clearInterval(timer)
  }, [refresh])
  return <>
    <PageHeading title="Station overview" description="Monitor the central broadcast and manage music for every branch."
      action={<button type="button" className="button button-secondary" onClick={refresh}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>} />
    <div className="admin-shortcuts">
      <Link className="button button-primary" to="/admin/upload"><Upload size={17} aria-hidden="true" /> Upload music</Link>
      <Link className="button button-secondary" to="/admin/playlist"><Disc3 size={17} aria-hidden="true" /> Manage main rotation</Link>
    </div>
    <Resource resource={resource} label="Loading station overview…">{data => <>
      <div className="admin-stats">
        <StatCard icon={AudioLines} label="Broadcast" value={<StatusBadge label={data.online ? 'Live' : 'Offline'} tone={data.online ? 'live' : 'danger'} />} detail={data.name} />
        <StatCard icon={Users} label="Listeners" value={data.listeners?.toLocaleString() ?? 'Unavailable'} detail="Across the whole station" />
        <StatCard icon={Disc3} label="Main rotation" value={<StatusBadge label={data.rotation.enabled ? 'Enabled' : 'Disabled'} tone={data.rotation.enabled ? 'live' : 'warning'} />} detail={data.rotation.name} />
      </div>
      <div className="admin-stats admin-tracks">
        {([['Now playing', data.online ? data.current : null], ['Coming next', data.next]] as const).map(([label, song]) =>
          <SectionCard title={label} key={label} icon={Music2}>
            {song ? <div className="admin-track-text">
              <strong dir="auto">{song.title}</strong>
              {song.artist && <span dir="auto">{song.artist}</span>}
              {song.playlist && <small dir="auto">{song.playlist}</small>}
            </div> : <p className="section-description">{data.online ? 'Track information unavailable.' : 'Station offline.'}</p>}
          </SectionCard>)}
      </div>
    </>}</Resource>
    <SectionCard title="Branch listening link">
      <a className="admin-url" href={config.publicPlayerUrl}>{config.publicPlayerUrl}</a>
    </SectionCard>
  </>
}

export function LibraryPage({ csrf, canWrite }: { csrf: string; canWrite: boolean }) {
  const [search, setSearch] = useSearchParams()
  const q = search.get('q') ?? ''
  const page = Math.max(1, Number(search.get('page')) || 1)
  const scope = search.get('scope') === 'rotation' ? 'rotation' : 'all'
  const path = '/media?' + new URLSearchParams({ q, page: String(page), scope })
  const resource = useResource<MusicPage>(path)
  const [confirmed, setConfirmed] = useState<{ id: number; path: string }>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState<number>()
  const confirmedTrack = confirmed?.path === path ? resource.data?.rows.find(row =>
    row.id === confirmed.id && row.playlists.some(list => list.id === mainRotationId)) : undefined
  async function assign(id: number) {
    if (pending !== undefined) return
    setPending(id)
    setError('')
    setConfirmed(undefined)
    try {
      await setMembership(id, true, csrf)
      setConfirmed({ id, path })
    } catch (error) { setError(message(error)) }
    finally {
      resource.refresh()
      setPending(undefined)
    }
  }
  function refresh() {
    setConfirmed(undefined)
    setError('')
    resource.refresh()
  }
  function changePage(page: number) { setSearch({ q, page: String(page), scope }) }
  return <>
    <PageHeading title="Music library" description="Search station media and add a track to the main rotation."
      action={<Link className="button button-primary" to="/admin/upload"><Upload size={17} aria-hidden="true" /> Upload music</Link>} />
    <SectionCard title="Station tracks" icon={Library}
      action={<button type="button" className="button button-secondary" onClick={refresh}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>}>
      <form className="admin-search" key={q + scope} onSubmit={event => {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        setSearch({ q: String(fields.get('q') ?? '').trim(), scope: String(fields.get('scope') ?? 'all') })
      }}>
        <div><label htmlFor="music-search">Search music</label>
          <input id="music-search" type="search" name="q" placeholder="Title, artist, or file name" maxLength={100} defaultValue={q} /></div>
        <div className="admin-search-filter"><label htmlFor="music-scope">Playlist filter</label>
          <select id="music-scope" name="scope" defaultValue={scope}><option value="all">All station tracks</option><option value="rotation">Main Rotation only</option></select></div>
        <button type="submit" className="button button-secondary">Search</button>
        {(q || scope !== 'all') && <button type="button" className="button button-secondary" onClick={() => setSearch({})}>Clear</button>}
      </form>
      <p className="admin-notice" role="status">{confirmedTrack ? confirmedTrack.title + ' is assigned to Ghmaas Main Rotation.' : ''}</p>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <Resource resource={resource} label="Loading music library…">{data => <>
        {data.rows.length ? <>
          <p className="section-description" role="status">{data.total} {data.total === 1 ? 'track' : 'tracks'}</p>
          <ul className="admin-list" aria-label="Station tracks">
            {data.rows.map(file => {
              const assigned = file.playlists.some(list => list.id === mainRotationId)
              return <li key={file.id}>
                <TrackText track={file} />
                <div className="admin-row-actions">
                  {file.playlists.length ? <span className="admin-memberships" title="Playlist memberships">{file.playlists.map(list => list.name + (list.folder ? ' (folder)' : '')).join(', ')}</span> : <span className="admin-memberships">Unassigned</span>}
                  {canWrite && !assigned && <button type="button" className="button button-secondary" onClick={() => { void assign(file.id) }} disabled={pending !== undefined}
                    aria-label={'Add ' + file.title + ' to Main Rotation'}>{pending === file.id ? 'Adding…' : 'Add to Main Rotation'}</button>}
                </div>
              </li>
            })}
          </ul>
        </> : <EmptyState icon={Library} title={q || scope !== 'all' ? 'No tracks match your search' : 'No tracks in this library'} description={q || scope !== 'all' ? 'Try a different title, artist, or file name.' : 'Upload approved audio to add your first track.'} />}
        <Pages page={data.page} pages={data.pages} change={changePage} />
      </>}</Resource>
    </SectionCard>
  </>
}

export function PlaylistPage({ csrf, canWrite }: { csrf: string; canWrite: boolean }) {
  const [page, setPage] = useState(1)
  const resource = useResource<Playlist>('/playlists/' + mainRotationId + '?page=' + page)
  const [notice, setNotice] = useState('')
  return <>
    <PageHeading title="Main rotation" description="Manage the station playlist shared by every branch."
      action={<Link className="button button-secondary" to="/admin/library"><Library size={17} aria-hidden="true" /> Add from library</Link>} />
    <p role="status" className="admin-notice">{notice}</p>
    <Resource resource={resource} label="Loading main rotation…">{playlist =>
      <PlaylistEditor playlist={playlist} csrf={csrf} canWrite={canWrite} pageChange={setPage} onSaved={value => { setNotice(value); resource.refresh() }}
        refresh={resource.refresh} />}
    </Resource>
  </>
}

function PlaylistEditor({ playlist, csrf, canWrite, refresh, onSaved, pageChange }: {
  playlist: Playlist; csrf: string; canWrite: boolean; refresh: () => void; onSaved: (value: string) => void; pageChange: (page: number) => void
}) {
  const [tracks, setTracks] = useState(playlist.tracks)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const dirty = tracks.some((row, index) => row.entryId !== playlist.tracks[index]?.entryId)
  function move(index: number, by: number) {
    const updated = [...tracks]
    const target = index + by
    if (target < 0 || target >= updated.length) return
    const moved = updated[index]
    updated[index] = updated[target]
    updated[target] = moved
    setTracks(updated)
  }
  async function persist(change: () => Promise<unknown>, success: string) {
    if (pending) return
    setError('')
    setPending(true)
    try { await change(); onSaved(success) }
    catch (error) { setError(message(error)) }
    finally { setPending(false) }
  }
  function saveOrder() {
    if (!dirty || !window.confirm('Save this order for Ghmaas Main Rotation? Already queued tracks may still play first.')) return
    const ids = (rows: Playlist['tracks']) => rows.flatMap(row => row.entryId === null ? [] : [row.entryId])
    void persist(() => adminRequest('/playlists/' + mainRotationId + '/order', {
      method: 'PUT', csrf, body: { baseline: ids(playlist.tracks), order: ids(tracks) },
    }), 'The new playlist order was saved and verified in AzuraCast.')
  }
  function remove(track: Playlist['tracks'][number]) {
    if (!window.confirm('Remove "' + track.title + '" from Ghmaas Main Rotation? Its media file will stay in the library.')) return
    void persist(() => setMembership(track.id, false, csrf), track.title + ' was removed from the main rotation.')
  }

  return <SectionCard title={playlist.name} icon={Disc3}
    action={<button type="button" className="button button-secondary" disabled={pending} onClick={() => {
      if (!dirty || window.confirm('Discard unsaved order changes?')) refresh()
    }}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>}>
    <div className="admin-shortcuts">
      <StatusBadge label={playlist.enabled ? 'Enabled' : 'Disabled'} tone={playlist.enabled ? 'live' : 'warning'} />
      {playlist.activePlaylist === playlist.name && <StatusBadge label="On air now" tone="live" />}
      {playlist.activePlaylist && playlist.activePlaylist !== playlist.name && <span className="section-description">On air now · {playlist.activePlaylist}</span>}
      <StatusBadge label={{ sequential: 'Sequential', shuffle: 'Shuffle', random: 'Random' }[playlist.mode]} />
      <span className="section-description">{playlist.total} {playlist.total === 1 ? 'track' : 'tracks'} · {playlist.scheduled ? 'Schedule configured' : 'No schedule configured'}</span>
    </div>
    <p className="section-description">{playlist.editableOrder
      ? 'Use Up and Down to set the order. Already queued tracks may still play first.'
      : 'Fixed ordering is available only in Sequential mode. The station operator can review playback mode in AzuraCast.'}</p>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {canWrite && playlist.editableOrder && tracks.length > 1 && <div className="admin-save">
      <button type="button" className="button button-primary" disabled={!dirty || pending} onClick={saveOrder}>{pending && dirty ? 'Saving…' : 'Save order'}</button>
      {dirty && <><button type="button" className="button button-secondary" disabled={pending} onClick={() => setTracks(playlist.tracks)}>Reset edits</button>
        <span role="status">{tracks.filter((row, index) => row.entryId !== playlist.tracks[index]?.entryId).length} positions changed</span></>}
    </div>}
    {tracks.length ? <ol className="admin-list" aria-label="Rotation tracks">{tracks.map((track, index) =>
      <li key={track.entryId ?? track.id}>
        <div className="admin-order-track">{playlist.editableOrder && <span className="admin-position" aria-label={'Position ' + (index + 1)}>{index + 1}</span>}
          <TrackText track={track} /></div>
        <div className="admin-row-actions">
          {canWrite && playlist.editableOrder && <div className="admin-move">
            <button type="button" className="button button-secondary" aria-label={'Move ' + track.title + ' up'} disabled={index === 0 || pending} onClick={() => move(index, -1)}><ArrowUp size={16} aria-hidden="true" /> Up</button>
            <button type="button" className="button button-secondary" aria-label={'Move ' + track.title + ' down'} disabled={index === tracks.length - 1 || pending} onClick={() => move(index, 1)}><ArrowDown size={16} aria-hidden="true" /> Down</button>
          </div>}
          {canWrite && <button type="button" className="button button-secondary" aria-label={'Remove ' + track.title + ' from Main Rotation'}
            title={dirty ? 'Save or reset your order before removing tracks.' : undefined} disabled={pending || dirty} onClick={() => remove(track)}>Remove</button>}
        </div>
      </li>)}</ol> : <EmptyState icon={Disc3} title="The main rotation has no tracks" description="Add music from the station library." />}
    <Pages page={playlist.page} pages={playlist.pages} change={pageChange} />
  </SectionCard>
}
