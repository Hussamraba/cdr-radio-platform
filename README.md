# Ghmaas Baladi Radio

Ghmaas Baladi Radio is a centralized restaurant radio platform built for the CDR Group technical assessment. Branches open the same player and listen to a single AutoDJ broadcast. An authorized operator manages the station library and Main Rotation from a private Admin.

## Assessment demo

- [Public Dashboard](https://hussam.tail1a8390.ts.net/)
- [Public Branch Player](https://hussam.tail1a8390.ts.net/player)
- [Direct MP3 stream](https://hussam.tail1a8390.ts.net/listen/ghmaas_baladi_radio/radio.mp3)

Open the Branch Player and tap **Play**. Public listeners can use a regular browser. Each player has independent buffering and local volume, mute and pause controls.

## Deployed architecture

Tailscale Funnel on the Ubuntu WSL2 host forwards public HTTPS to Caddy at `127.0.0.1:8088`. Caddy serves the React and Vite build from `frontend/dist` and proxies a read-only allowlist for station metadata, artwork and Icecast audio. AzuraCast owns station 1 and playlist 2. Liquidsoap AutoDJ selects the tracks and feeds Icecast.

The private React Admin and Node.js API run in Docker Compose. Desktop operators reach the backend at `127.0.0.1:18090`. Mobile operators connect through a separate tailnet-only Tailscale Serve node and sign in to Admin. The Docker public preview on port 18088 has its own build. The assessment URL is served by host Caddy.

## Operator workflow

An authorized operator signs in, uploads approved audio, verifies the Music Library entry and selects **Add to Main Rotation**. The backend verifies the assignment with fresh AzuraCast reads. To confirm that a track aired, let AutoDJ play through its existing queue, then check Now Playing and listen on the public Branch Player.

## Build and verification

- [Technical architecture, security boundaries and WSL2 pacing](docs/architecture.md)
- [Build commands, tests and iPhone acceptance](docs/testing.md)
- [Frontend setup and local playback validation](frontend/README.md)
- [Private Admin setup and API](deploy/admin/README.md)
- [Docker Compose and mobile operator setup](deploy/docker/README.md)
- [Public demo hosting](deploy/demo/README.md)
- [Linux VPS deployment option](deploy/production/README.md)

The assessment stays online while the Windows laptop, WSL2, Docker, Caddy, Tailscale and the host network are available. A clean application build uses the lockfiles and includes the original studio illustration and restaurant logo. A live installation also needs AzuraCast, the station and rotation, and locally provisioned operator settings. [Release asset provenance](docs/testing.md#release-asset-review)
