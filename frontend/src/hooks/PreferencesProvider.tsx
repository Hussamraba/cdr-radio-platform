import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { PreferencesContext, readPreference } from './preferences'

const preferenceKey = 'ghmaas.reducedMotion'

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(() => readPreference(preferenceKey) === 'true')

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'system'
    try {
      localStorage.setItem(preferenceKey, String(reducedMotion))
    } catch {
      // Keep the current preference when browser storage is disabled.
    }
  }, [reducedMotion])

  return (
    <PreferencesContext.Provider value={{ reducedMotion, setReducedMotion }}>
      <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>{children}</MotionConfig>
    </PreferencesContext.Provider>
  )
}
