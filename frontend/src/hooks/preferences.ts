import { createContext, useContext, useSyncExternalStore } from 'react'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

function subscribeToMotion(callback: () => void) {
  const query = window.matchMedia(reducedMotionQuery)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

function getSystemReducedMotion() {
  return window.matchMedia(reducedMotionQuery).matches
}

export function readPreference(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export const PreferencesContext = createContext({
  reducedMotion: false,
  setReducedMotion: (_value: boolean) => { void _value },
})

export function usePreferences() {
  return useContext(PreferencesContext)
}

export function useMotionAllowed() {
  const { reducedMotion } = usePreferences()
  const systemReducedMotion = useSyncExternalStore(subscribeToMotion, getSystemReducedMotion)
  return !reducedMotion && !systemReducedMotion
}
