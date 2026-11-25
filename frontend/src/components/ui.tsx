import { AlertCircle, LoaderCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { useMotionAllowed } from '../hooks/preferences'
import type { StationStatus } from '../types/radio'

const statusLabels: Record<StationStatus, string> = {
  checking: 'Checking',
  unavailable: 'Unavailable',
  offline: 'Offline',
  live: 'LIVE',
}

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'live' | 'warning' | 'danger' }) {
  return <span className={`status-badge status-${tone}`}><span className="status-dot" aria-hidden="true" />{label}</span>
}

export function StationBadge({ status }: { status: StationStatus }) {
  return <StatusBadge label={statusLabels[status]} tone={status === 'live' ? 'live' : status === 'offline' ? 'danger' : status === 'checking' ? 'warning' : 'neutral'} />
}

export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-logo ${className}`}>
      <img src={`${import.meta.env.BASE_URL}images.jpg`} alt="Ghammas Baladi restaurant logo" width={610} height={327} />
    </span>
  )
}

export function Brand({ showName = true }: { showName?: boolean }) {
  return (
    <div className="brand">
      <BrandLogo />
      <div className="brand-name" aria-hidden={!showName}>
        <strong>Ghmaas Baladi Radio</strong>
        <span className="arabic" lang="ar" dir="rtl">راديو غماس بلدي</span>
      </div>
    </div>
  )
}

export function SectionCard({ title, icon: Icon, action, children, className = '' }: {
  title: string
  icon?: LucideIcon
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`section-card ${className}`}>
      <div className="section-heading">
        <h2>{Icon && <Icon size={18} aria-hidden="true" />}{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function StatCard({ icon: Icon, label, value, detail, accent = 'red' }: {
  icon: LucideIcon
  label: string
  value: ReactNode
  detail: string
  accent?: 'red' | 'lilac' | 'blue' | 'green'
}) {
  return (
    <section className="stat-card">
      <div className="stat-top"><span className={`stat-icon icon-${accent}`}><Icon size={18} aria-hidden="true" /></span><h2>{label}</h2></div>
      <div className="stat-value">{value}</div>
      <p>{detail}</p>
    </section>
  )
}

export function EmptyState({ icon: Icon, title, description, action, compact = false }: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`empty-state ${compact ? 'empty-compact' : ''}`}>
      <span className="empty-icon"><Icon size={23} aria-hidden="true" /></span>
      <div><h3>{title}</h3>{description && <p>{description}</p>}</div>
      {action}
    </div>
  )
}

export function LoadingState({ label = 'Checking station data…' }: { label?: string }) {
  return <div className="inline-state" role="status"><LoaderCircle className="spinner" size={18} aria-hidden="true" />{label}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="inline-state error-state"><AlertCircle size={19} aria-hidden="true" /><span role="status">{message}</span><button className="button button-secondary button-small" onClick={onRetry}>Retry</button></div>
}

export function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const animate = useMotionAllowed()
  return (
    <motion.div className={className} initial={animate ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: animate ? 0.25 : 0, delay: animate ? delay : 0, ease: [0.2, 0.7, 0.25, 1] }}>
      {children}
    </motion.div>
  )
}
