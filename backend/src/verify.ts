import { writeFile } from 'node:fs/promises'
import { createAzura } from './azuracast.js'
import { loadConfig, station } from './config.js'
import { Problem } from './errors.js'
import { prepareUpload } from './upload.js'

function rotationSnapshot(rotation: Awaited<ReturnType<ReturnType<typeof createAzura>['playlist']>>) {
  return {
    recordedAt: new Date().toISOString(), station: station.id,
    rotation: { id: rotation.id, name: rotation.name, enabled: rotation.enabled, mode: rotation.mode, total: rotation.total },
    entries: rotation.tracks.map(({ id, entryId, title }) => ({ id, entryId, title })),
  }
}

async function verify() {
  const config = loadConfig(process.env)
  const upstream = createAzura(config)
  const [command, filename, size] = process.argv.slice(2)
  if (command === '--upload' || command === '--snapshot') {
    const rotation = await upstream.playlist(1, false)
    if (!rotation.enabled || rotation.mode !== 'sequential' || rotation.tracks.length !== rotation.total) {
      throw new Problem(409, 'rotation_config', 'The upload test requires a complete and enabled sequential Main Rotation.')
    }
    const snapshot = rotationSnapshot(rotation)
    if (command === '--snapshot') console.log(JSON.stringify(snapshot, null, 2))
    else {
      const upload = await prepareUpload(process.stdin, filename ?? '', Number(size), config.maxUploadBytes, async file => {
        await upstream.checkUploadIdentity(file)
        return { filename, size: file.size, sha256: file.digest }
      })
      console.log(JSON.stringify({ ...snapshot, upload, proposedAction: 'upload once and add to playlist 2' }, null, 2))
    }
    return
  }
  const [overview, library, playlists, rotation] = await Promise.all([
    upstream.overview(), upstream.listMedia('', 1), upstream.listPlaylists(1), upstream.playlist(1),
  ])
  console.log(JSON.stringify({
    station: station.id, online: overview.online, libraryTracks: library.total, playlists: playlists.total,
    rotation: rotation.name, rotationId: rotation.id, enabled: rotation.enabled, mode: rotation.mode,
    activePlaylist: rotation.activePlaylist, rotationEntries: rotation.total,
  }, null, 2))
  const snapshot = command
  if (snapshot) {
    await writeFile(snapshot, JSON.stringify(rotationSnapshot(rotation), null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    console.log('Saved a new private rotation snapshot.')
  }
}

try {
  await verify()
} catch (error) {
  console.error(error instanceof Problem ? 'HTTP ' + error.status + ' ' + error.code + ' — ' + error.message
    : 'The read-only verification could not run. Check the backend environment and snapshot destination.')
  process.exitCode = 1
}
