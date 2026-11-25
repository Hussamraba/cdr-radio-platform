export function formatDuration(duration?: number) {
  if (duration === undefined) return '—'
  const seconds = Math.floor(duration)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
