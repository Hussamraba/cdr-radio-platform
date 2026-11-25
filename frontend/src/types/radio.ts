export interface AzuraCastSong {
  title?: string
  artist?: string
  text?: string
  art?: string
}

export interface AzuraCastTrack {
  song?: AzuraCastSong
  duration?: number
  elapsed?: number
  played_at?: number
  playlist?: string
}

export interface AzuraCastNowPlaying {
  station: { id?: number; name?: string; shortcode?: string; description?: string }
  is_online: boolean
  listeners?: { current?: number; total?: number; unique?: number }
  now_playing?: AzuraCastTrack | null
  playing_next?: AzuraCastTrack | null
  song_history?: AzuraCastTrack[]
}

export interface Track {
  title: string
  artist?: string
  artwork?: string
  duration?: number
  elapsed?: number
  playedAt?: number
}

export interface StationSnapshot {
  name?: string
  description?: string
  online: boolean
  listeners: { current?: number; total?: number; unique?: number }
  current?: Track
  next?: Track
  history: Track[]
  receivedAt: number
}

export type StationStatus = 'checking' | 'unavailable' | 'offline' | 'live'
