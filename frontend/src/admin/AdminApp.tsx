import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowUpRight, AudioLines, CircleHelp, Disc3, Library, LogOut, Upload } from 'lucide-react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Brand, ErrorState, LoadingState, PageHeading, SectionCard } from '../components/ui'
import { config } from '../services/config'
import { adminRequest, AdminError, expiredEvent, message, type Session } from './api'
import { LibraryPage, OverviewPage, PlaylistPage } from './Catalog'
import { UploadPage } from './UploadPage'
import './admin.css'

const links = [
  ['/admin', 'Overview', AudioLines], ['/admin/library', 'Music Library', Library],
  ['/admin/upload', 'Upload Music', Upload], ['/admin/playlist', 'Main Rotation', Disc3], ['/admin/help', 'Help', CircleHelp],
] as const

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return
    const form = event.currentTarget
    const fields = new FormData(form)
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const session = await adminRequest<Session>('/auth/login', {
        method: 'POST', body: { username: fields.get('username'), password: fields.get('password') },
      })
      form.reset()
      onLogin(session)
    } catch (error) { setError(message(error)) }
    finally { pending.current = false; setBusy(false) }
  }

  return <div className="admin-login">
    <PageHeading title="Radio administration" description="Sign in to manage music for every branch." />
    <form className="section-card admin-form" onSubmit={submit} aria-busy={busy}>
      <label htmlFor="admin-username">Username</label>
      <input id="admin-username" name="username" autoComplete="username" required maxLength={80} autoCapitalize="none" />
      <label htmlFor="admin-password">Password</label>
      <input id="admin-password" name="password" type="password" autoComplete="current-password" required minLength={12} maxLength={256} />
      {error && <p className="admin-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>
}

function Help() {
  return <>
    <PageHeading title="Administration help" description="Manage the central rotation and verify it from the listener’s perspective." />
    <SectionCard title="Update the music">
      <ol className="management-steps">
        <li><Link to="/admin/upload">Upload approved MP3 or WAV files.</Link></li>
        <li><Link to="/admin/library">Verify the tracks in Music Library.</Link></li>
        <li>Add the tracks to Ghmaas Main Rotation.</li>
        <li><Link to="/admin/playlist">Review and save the order when the playlist uses Sequential mode.</Link></li>
        <li><Link to="/admin">Check the current and upcoming tracks on Overview.</Link></li>
        <li><a href={config.publicPlayerUrl}>Open the public Branch Player</a> and tap Play.</li>
      </ol>
    </SectionCard>
    <SectionCard title="What branches control">
      <p className="section-description">Share the same public listener link with every branch. Each device controls its own Play, Pause, mute, and volume. Uploads and playlist changes happen here and apply to the central station for all listeners.</p>
    </SectionCard>
  </>
}

export default function AdminApp() {
  const [auth, setAuth] = useState<{ session: Session | null; error?: string }>()
  const [attempt, setAttempt] = useState(0)
  const [logoutError, setLogoutError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const session = auth?.session
  const canManageRotation = Boolean(session?.canWrite && !session.uploadWindowEndsAt)
  useEffect(() => {
    const controller = new AbortController()
    const expire = () => setAuth({ session: null })
    window.addEventListener(expiredEvent, expire)
    void adminRequest<Session>('/auth/me', { signal: controller.signal }).then(
      session => { if (!controller.signal.aborted) setAuth({ session }) },
      error => {
        if (controller.signal.aborted) return
        if (error instanceof AdminError && error.status === 401) setAuth({ session: null })
        else setAuth({ session: null, error: message(error) })
      },
    )
    return () => { window.removeEventListener(expiredEvent, expire); controller.abort() }
  }, [attempt])
  useEffect(() => {
    if (!session) return
    const timer = window.setTimeout(() => setAuth({ session: null }), Math.max(0, session.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [session])
  useEffect(() => {
    if (!session?.canWrite || !session.uploadWindowEndsAt) return
    const timer = window.setTimeout(() => setAuth(current => current?.session === session
      ? { session: { ...session, canWrite: false } } : current), Math.max(0, session.uploadWindowEndsAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [session])
  useEffect(() => { document.title = 'Private Administration | Ghmaas Baladi Radio' }, [])

  async function logout() {
    if (!session || signingOut) return
    setSigningOut(true)
    setLogoutError('')
    try {
      await adminRequest('/auth/logout', { method: 'POST', csrf: session.csrfToken })
      setAuth({ session: null })
    } catch (error) { setLogoutError(message(error)) }
    finally { setSigningOut(false) }
  }

  return <div className="admin-shell">
    <a href="#admin-content" className="skip-link">Skip to content</a>
    <header className="admin-header">
      <div className="admin-header-inner">
        <Link to="/admin" aria-label="Radio administration home"><Brand /></Link>
        <div className="admin-header-actions">
          <a className="button button-secondary" href={config.publicPlayerUrl}>Public player <ArrowUpRight size={16} aria-hidden="true" /></a>
          {session && <button className="button button-secondary" type="button" onClick={logout} disabled={signingOut}>
            <LogOut size={16} aria-hidden="true" /> {signingOut ? 'Signing out…' : 'Sign out'}
          </button>}
        </div>
      </div>
      {session && <nav className="admin-nav" aria-label="Administration">
        {links.map(([to, text, Icon]) => <NavLink to={to} key={to} end={to === '/admin'}>
          <Icon size={17} aria-hidden="true" />{text}
        </NavLink>)}
      </nav>}
    </header>
    <main className="admin-content" id="admin-content" tabIndex={-1}>
      {session && !session.canWrite && <p className="section-description" role="status">Read-only access. Music changes are disabled for this admin instance.</p>}
      {session?.canWrite && session.managementMode === 'persistent' && <p className="section-description" role="status">
        Music management enabled. Uploads enter the library. Use Add to Main Rotation when a track is ready to air.
      </p>}
      {session?.canWrite && session.uploadWindowEndsAt && <p className="section-description" role="status">
        Approved upload window. Upload the approved file and add it to Main Rotation from the upload queue.
      </p>}
      {logoutError && session && <p className="admin-error" role="alert">{logoutError}</p>}
      {!auth ? <LoadingState label="Checking your admin session…" /> : auth.error
        ? <ErrorState message={auth.error} onRetry={() => { setAuth(undefined); setAttempt(value => value + 1) }} />
        : !session
          ? <Routes><Route path="login" element={<Login onLogin={session => setAuth({ session })} />} /><Route path="*" element={<Navigate to="/admin/login" replace />} /></Routes>
          : <Routes>
            <Route index element={<OverviewPage />} />
            <Route path="library" element={<LibraryPage csrf={session.csrfToken} canWrite={canManageRotation} />} />
            <Route path="upload" element={<UploadPage csrf={session.csrfToken} limit={session.uploadLimit} canWrite={session.canWrite} />} />
            <Route path="playlist" element={<PlaylistPage csrf={session.csrfToken} canWrite={canManageRotation} />} />
            <Route path="help" element={<Help />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>}
    </main>
  </div>
}
