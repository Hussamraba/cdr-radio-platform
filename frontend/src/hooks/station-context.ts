import { createContext, useContext } from 'react'
import type { StationSnapshot, StationStatus } from '../types/radio'

export interface StationState {
  phase: 'loading' | 'ready' | 'error'
  data?: StationSnapshot
  error?: string
}

export const StationContext = createContext<StationState & {
  status: StationStatus
  refresh: () => void
}>({ phase: 'loading', status: 'checking', refresh: () => undefined })

export function useStation() {
  return useContext(StationContext)
}
