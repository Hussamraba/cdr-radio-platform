import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getNowPlaying } from '../services/azuracast'
import type { StationStatus } from '../types/radio'
import { StationContext } from './station-context'
import type { StationState } from './station-context'

const pollInterval = 8_000
const requestTimeout = 6_000

export function StationProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<StationState>({ phase: 'loading' })

  useEffect(() => {
    let activeRequest: AbortController | undefined
    let stopped = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      const startedAt = performance.now()
      const request = new AbortController()
      activeRequest = request
      timeout = setTimeout(() => request.abort(), requestTimeout)
      try {
        const data = await getNowPlaying(request.signal)
        if (!stopped) setState({ phase: 'ready', data })
      } catch (error) {
        if (stopped) return
        const message = request.signal.aborted
          ? 'The station API took too long to respond.'
          : error instanceof Error && error.message.startsWith('The station API')
            ? error.message
            : 'The station API could not be reached.'
        setState({ phase: 'error', error: message })
      } finally {
        clearTimeout(timeout)
        activeRequest = undefined
      }
      if (!stopped) pollTimer = setTimeout(poll, Math.max(0, pollInterval - (performance.now() - startedAt)))
    }

    void poll()
    return () => {
      stopped = true
      activeRequest?.abort()
      clearTimeout(timeout)
      clearTimeout(pollTimer)
    }
  }, [revision])

  function refresh() {
    setState({ phase: 'loading' })
    setRevision((previous) => previous + 1)
  }

  const status: StationStatus = state.phase === 'loading' ? 'checking'
    : state.phase === 'error' ? 'unavailable'
      : state.data?.online ? 'live' : 'offline'

  return (
    <StationContext.Provider value={{ ...state, status, refresh }}>
      {children}
    </StationContext.Provider>
  )
}
