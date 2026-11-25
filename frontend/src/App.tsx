import { lazy, Suspense } from 'react'
import { CircleHelp } from 'lucide-react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { EmptyState, LoadingState } from './components/ui'
import { PreferencesProvider } from './hooks/PreferencesProvider'
import { StationProvider } from './hooks/StationProvider'
import { AppShell } from './layouts/AppShell'
import { BranchPlayer } from './pages/BranchPlayer'
import { Dashboard } from './pages/Dashboard'
import { MusicManagement } from './pages/MusicManagement'
import { Preferences } from './pages/Settings'

const PrivateAdmin = import.meta.env.VITE_ADMIN_ENABLED === 'true' ? lazy(() => import('./admin/AdminApp')) : undefined

function App() {
  return (
    <BrowserRouter>
      <PreferencesProvider>
        <StationProvider>
          <Routes>
            {PrivateAdmin && <Route path="/admin/*" element={<Suspense fallback={<LoadingState label="Loading administration…" />}><PrivateAdmin /></Suspense>} />}
            <Route path="/player" element={<BranchPlayer />} />
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="library" element={<MusicManagement />} />
              <Route path="settings" element={<Preferences />} />
              <Route path="broadcast" element={<Navigate to="/" replace />} />
              <Route path="playlists" element={<Navigate to="/library" replace />} />
              <Route path="branches/:branchId?" element={<Navigate to="/player" replace />} />
              <Route path="*" element={<div className="page"><EmptyState icon={CircleHelp} title="Page unavailable"
                description="Check the address or return to the dashboard."
                action={<Link to="/" className="button button-primary">Dashboard</Link>} /></div>} />
            </Route>
          </Routes>
        </StationProvider>
      </PreferencesProvider>
    </BrowserRouter>
  )
}

export default App
