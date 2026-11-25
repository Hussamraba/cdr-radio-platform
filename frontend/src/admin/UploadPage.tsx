import { useEffect, useRef, useState } from 'react'
import { FileAudio, Music2, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeading, SectionCard } from '../components/ui'
import { fileSize, message, setMembership, uploadMusic, type MusicFile } from './api'
import { TrackText } from './shared'

interface Selection {
  key: string
  file: File
  state: 'selected' | 'uploading' | 'failed' | 'verified' | 'assigned'
  percent: number
  result?: MusicFile
  error?: string
}

const maxFiles = 10
const fileKey = (file: File) => JSON.stringify([file.name, file.size, file.lastModified])

export function UploadPage({ csrf, limit, canWrite }: { csrf: string; limit: number; canWrite: boolean }) {
  const active = useRef<AbortController | null>(null)
  const [items, setItems] = useState<Selection[]>([])
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => () => active.current?.abort(), [])

  function update(key: string, values: Partial<Selection>) {
    setItems(current => current.map(item => item.key === key ? { ...item, ...values } : item))
  }
  function select(files: FileList | null) {
    if (!canWrite || active.current || !files) return
    const candidates = [...items]
    const errors: string[] = []
    for (const file of files) {
      const key = fileKey(file)
      if (!/\.(mp3|wav)$/i.test(file.name) || !file.size) errors.push(file.name + ' • Choose a non-empty MP3 or WAV.')
      else if (file.size > limit) errors.push(file.name + ' • Maximum per file is ' + fileSize(limit) + '.')
      else if (candidates.some(item => item.key === key)) errors.push(file.name + ' • Already in this selection.')
      else if (candidates.length >= maxFiles) { errors.push('Select up to ' + maxFiles + ' files at a time.'); break }
      else candidates.push({ key, file, state: 'selected', percent: 0 })
    }
    setItems(candidates)
    setErrors(errors)
  }

  async function send(queue: Selection[]) {
    if (active.current || !queue.length) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    try {
      for (const item of queue) {
        if (controller.signal.aborted) break
        update(item.key, { state: 'uploading', percent: 0, error: undefined })
        setAnnouncement('Uploading ' + item.file.name)
        try {
          const result = await uploadMusic(item.file, csrf, percent => update(item.key, { percent }), controller.signal)
          if (!controller.signal.aborted) {
            update(item.key, { state: 'verified', result, percent: 100 })
            setAnnouncement(item.file.name + ' verified in the library.')
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            update(item.key, { state: 'failed', error: message(error) })
            setAnnouncement(item.file.name + ' upload failed.')
          }
        }
      }
    } finally {
      active.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function assign(item: Selection) {
    if (!item.result || active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setAnnouncement('')
    update(item.key, { error: undefined })
    try {
      const result = await setMembership(item.result.id, true, csrf, controller.signal)
      if (!controller.signal.aborted) {
        update(item.key, { result, state: 'assigned' })
        setAnnouncement('Verified the addition of ' + result.title + ' to Ghmaas Main Rotation.')
      }
    } catch (error) {
      if (!controller.signal.aborted) update(item.key, { error: message(error) })
    } finally {
      active.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const queued = items.filter(item => item.state === 'selected')
  return <>
    <PageHeading title="Upload music" description="Transfer approved audio to the station, then choose which tracks join the rotation." />
    <SectionCard title="Select audio" icon={Upload}>
      <div className={'admin-drop' + (dragActive && !busy ? ' admin-drop-active' : '')}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = canWrite && !busy ? 'copy' : 'none'; setDragActive(canWrite && !busy) }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }}
        onDrop={event => { event.preventDefault(); setDragActive(false); select(event.dataTransfer.files) }}>
        <span className="empty-icon"><FileAudio size={24} aria-hidden="true" /></span>
        <div><strong>MP3 or PCM WAV files</strong>
          <p className="section-description" id="upload-format">Up to {fileSize(limit)} per file. Choose up to {maxFiles} files.</p></div>
        <label className="button button-secondary admin-file-picker" data-disabled={!canWrite || busy}>
          Browse files
          <input className="sr-only" type="file" multiple accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav,audio/wave"
            aria-label="Choose music files" aria-describedby="upload-format" disabled={!canWrite || busy}
            onChange={event => { select(event.currentTarget.files); event.currentTarget.value = '' }} />
        </label>
      </div>
      {errors.length > 0 && <ul className="admin-error" role="alert">{errors.map((text, index) => <li key={index}>{text}</li>)}</ul>}
      <p className="section-description">Uploads are checked against the station library. An identical file is rejected even if its name is different.</p>
    </SectionCard>
    <SectionCard title="Upload queue" icon={Music2}
      action={<button type="button" className="button button-primary" disabled={!canWrite || busy || !queued.length} onClick={() => { void send(queued) }}>
        <Upload size={16} aria-hidden="true" /> {busy ? 'Working…' : 'Upload selected'}</button>}>
      <p className="admin-notice" role="status">{announcement}</p>
      {items.length ? <ul className="admin-list" aria-label="Selected audio">{items.map(item => <li key={item.key}>
        <div className="admin-track-text">
          {item.result ? <TrackText track={item.result} /> : <><strong dir="auto">{item.file.name}</strong><small>{fileSize(item.file.size)}</small></>}
          <span>{{
            selected: 'Ready to upload', uploading: item.percent === 100 ? 'Verifying in AzuraCast…' : 'Uploading ' + item.percent + '%',
            failed: 'Upload failed', verified: 'Uploaded and verified · not assigned', assigned: 'Main Rotation addition verified',
          }[item.state]}</span>
          {item.state === 'uploading' && <progress value={item.percent} max={100} aria-label={'Upload progress for ' + item.file.name} />}
          {item.error && <p className="admin-error" role="alert">{item.error}</p>}
        </div>
        <div className="admin-row-actions">
          {item.state === 'failed' && <button type="button" className="button button-secondary" disabled={!canWrite || busy} onClick={() => { void send([item]) }}>Retry upload</button>}
          {item.state === 'verified' && <button type="button" className="button button-secondary" disabled={!canWrite || busy} onClick={() => { void assign(item) }}>Add to Main Rotation</button>}
          {item.result && <Link className="button button-secondary" to={'/admin/library?' + new URLSearchParams({ q: item.result.filename })}>View in library</Link>}
          <button type="button" className="button button-secondary" disabled={busy}
            onClick={() => setItems(current => current.filter(row => row.key !== item.key))}
            aria-label={(item.result ? 'Clear ' : 'Remove ') + item.file.name + ' from upload queue'}>{item.result ? 'Clear from queue' : 'Remove'}</button>
        </div>
      </li>)}</ul> : <EmptyState icon={FileAudio} title="No files selected" description="Add approved files using the drop zone or Browse files." />}
    </SectionCard>
  </>
}
