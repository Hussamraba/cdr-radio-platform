import { AudioLines, BookOpen, ChevronRight, Headphones, LayoutDashboard, Menu, PanelLeftClose, PanelLeftOpen, Settings, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Brand, StationBadge } from '../components/ui'
import { readPreference } from '../hooks/preferences'
import { useStation } from '../hooks/station-context'

const navigation = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Music Management', path: '/library', icon: BookOpen },
  { label: 'Preferences & Diagnostics', path: '/settings', icon: Settings },
]

function Sidebar({ collapsed = false, close }: { collapsed?: boolean; close?: () => void }) {
  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <Link to="/" className="brand-link" aria-label="Ghmaas Baladi Radio dashboard" onClick={close}>
          <Brand showName={!collapsed} />
        </Link>
        {close && <button className="icon-button mobile-close" aria-label="Close navigation" onClick={close}><X size={20} /></button>}
      </div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="nav-group">
          {navigation.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end className="nav-link" aria-label={label} title={collapsed ? label : undefined} onClick={close}>
              <Icon size={18} aria-hidden="true" /><span>{label}</span>
            </NavLink>
          ))}
        </div>
        <Link to="/player" className="branch-shortcut" aria-label="Open Branch Player" title={collapsed ? 'Open Branch Player' : undefined} onClick={close}>
          <span className="shortcut-icon"><Headphones size={18} aria-hidden="true" /></span>
          <span className="shortcut-text"><strong>Branch Player</strong><small>Listen live</small></span>
          <ChevronRight className="shortcut-chevron" size={16} aria-hidden="true" />
        </Link>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-foot"><AudioLines size={15} aria-hidden="true" /><span>Ghammas Baladi · CDR Group</span></div>
      </div>
    </div>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  const { status } = useStation()
  const dialog = useRef<HTMLDialogElement>(null)
  const main = useRef<HTMLElement>(null)
  const previousPath = useRef(pathname)
  const [collapsed, setCollapsed] = useState(() => readPreference('ghmaas.sidebarCollapsed') === 'true')
  const current = navigation.find(({ path }) => path === (pathname.replace(/\/$/, '') || '/'))
  const title = current?.label ?? 'Page unavailable'

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 961px)')
    const currentDialog = dialog.current
    function closeOnDesktop() {
      if (desktop.matches) currentDialog?.close()
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  useEffect(() => {
    document.title = `${title} | Ghmaas Baladi Radio`
  }, [title])

  useEffect(() => {
    if (previousPath.current === pathname) return
    previousPath.current = pathname
    dialog.current?.close()
    window.scrollTo(0, 0)
    main.current?.focus({ preventScroll: true })
  }, [pathname])

  function toggleSidebar() {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem('ghmaas.sidebarCollapsed', String(next))
    } catch {
      // The toggle still applies for this session.
    }
  }

  return (
    <div className={`app-shell ${collapsed ? 'shell-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="desktop-sidebar" id="desktop-navigation"><Sidebar collapsed={collapsed} /></aside>
      <dialog ref={dialog} className="mobile-dialog" id="mobile-navigation" aria-label="Navigation" onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close()
      }}>
        <Sidebar close={() => dialog.current?.close()} />
      </dialog>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="icon-button desktop-toggle" onClick={toggleSidebar} aria-controls="desktop-navigation" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
              {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </button>
            <button type="button" className="icon-button mobile-toggle" aria-label="Open navigation" aria-haspopup="dialog" aria-controls="mobile-navigation" onClick={() => dialog.current?.showModal()}><Menu size={21} /></button>
            <span className="header-separator" />
            <nav aria-label="Breadcrumb" className="breadcrumbs"><span>Radio</span><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{title}</span></nav>
          </div>
          <div className="topbar-status"><span>Station status</span><div aria-live="polite"><StationBadge status={status} /></div></div>
        </header>
        <main ref={main} id="main-content" tabIndex={-1} className="main-content"><Outlet /></main>
      </div>
    </div>
  )
}
