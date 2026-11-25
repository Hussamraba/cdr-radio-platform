import { useCallback, useEffect, useState } from 'react'
import { adminRequest, message } from './api'

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: string }

export function useResource<T>(path: string) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ path: string; attempt: number; value: Result<T> }>()
  const refresh = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    function save(value: Result<T>) { if (!signal.aborted) setResult({ path, attempt, value }) }
    void adminRequest<T>(path, { signal }).then(data => save({ data }), error => save({ error: message(error) }))
    return () => controller.abort()
  }, [path, attempt])
  const current = result?.path === path && result.attempt === attempt ? result.value : undefined
  return { data: current?.data, error: current?.error, refresh }
}
