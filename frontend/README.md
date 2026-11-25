# Ghmaas Baladi Radio

The React and TypeScript frontend for CDR Group’s centralized restaurant radio platform.

| Route | Screen |
| --- | --- |
| `/` | Dashboard with station metadata and public player and MP3 share links. |
| `/player` | Branch Player with playback controls, onboarding, and recovery guidance. |
| `/library` | Music Management Guide for private AzuraCast operators. |
| `/settings` | Browser preferences and Now Playing diagnostics. |

The existing `/library` and `/settings` paths preserve bookmarked links and work with the current proxy. `/broadcast` redirects to the Dashboard, `/playlists` redirects to the guide, and `/branches` and `/branches/:branchId` redirect to the player.

## Run locally

```sh
npm ci
npm run dev
npm run lint
npm run build
```

With AzuraCast running at `http://localhost`, the defaults work without an environment file. Copy `.env.example` to `.env.local` to override them. Restart Vite after editing environment variables.

| Variable | Value |
| --- | --- |
| `AZURACAST_ORIGIN` | HTTP(S) origin reachable by the Vite process. Defaults to `http://localhost`. |
| `VITE_AZURACAST_STATION` | Public station shortcode. Defaults to `ghmaas_baladi_radio`. |
| `VITE_STREAM_URL` | Optional stable stream override. Use a same-origin path or a public HTTPS stream URL. Defaults to `/listen/ghmaas_baladi_radio/radio.mp3` for this station. |
| `VITE_PUBLIC_RADIO_ORIGIN` | Optional HTTPS origin for share links. Defaults to the current HTTPS origin or the assessment Funnel origin when opened over HTTP. |

Vite proxies metadata, the MP3 stream, and station artwork on the frontend origin. `AZURACAST_ORIGIN` stays in Vite’s server configuration. Variables prefixed with `VITE_` are bundled into the browser application. Keep administrator credentials, API keys, and broadcasting passwords on the server.

## Integration

The frontend polls the public Now Playing API every eight seconds for online status, listener counts, the current and next track, and recent track history. The player opens a separate connection to the MP3 stream after the user presses Play. It keeps that connection through metadata updates, releases it on Pause or navigation away, and retries interrupted playback while the user is listening. Buffering delays can vary by device. Volume, mute, navigation, and motion preferences are stored on the device. [AzuraCast Now Playing API](https://www.azuracast.com/docs/developers/now-playing-data/)

Operators use the private Ghmaas Admin to upload approved files, assign them to **Ghmaas Main Rotation**, and review the playlist order. The public guide at `/library` links to the Dashboard and Branch Player for on-air verification. Each branch bookmarks the same public player, taps Play, and adjusts local audio. [Private Admin workflow](../deploy/admin/README.md#operator-and-branch-workflows)

The app uses the supplied restaurant logo at `public/images.jpg`. The Dashboard uses the original studio illustration at `src/assets/broadcast-studio.svg`. A CSS glow animates when motion is enabled and can be paused from the Dashboard. The illustration stays visible with reduced motion. [Release asset provenance](../docs/testing.md#release-asset-review)

## Validate playback on two devices

Both Branch Players connect to `/listen/ghmaas_baladi_radio/radio.mp3` through the frontend host. Each device opens its own Icecast connection to the shared broadcast. Icecast and browsers buffer each connection independently, so the same audible cue can reach the two devices at different times. [Icecast buffering and queue settings](https://www.icecast.org/docs/icecast-latest/config_file/)

1. On the host running Vite, start `npm run dev -- --host 0.0.0.0` from `frontend/` on a trusted LAN. Join that network on both test devices. Open `http://<host-LAN-IP>:5173/player` on both, using the port shown by Vite. Use the host's LAN address since `localhost` on either device points back to that device. If the page is unreachable, check the host firewall and Wi-Fi client isolation.
2. Open **Playback diagnostics** on both devices. Verify that both stay at **Ready to play** and silent until tapped. Tap **Play** on device A, then on device B a few seconds later. Confirm both reach **Playing locally**, both play the station, and both show station metadata. If developer tools are available, confirm both media requests use the same `/listen/ghmaas_baladi_radio/radio.mp3` path and stay open across Now Playing refreshes.
3. Keep both playing through at least one song transition. Listen for the same distinctive cue, such as the first beat or a spoken word. Note which device hears it first and the rough time difference. Repeat after pausing and starting one device. Log the browser, OS, and approximate offset for each run. This checks the relative offset between the two outputs.
4. With both players active, briefly disconnect device B from the network. Turn off mobile data too if it can take over from Wi-Fi. B can keep playing while it has buffered audio. When that runs out, look for **Buffering…**, **Reconnecting…**, or **Playback unavailable**. Restore the network and check that B resumes or offers a tap to play again. Verify that A continues playing throughout.
5. Repeat with Safari on iOS and Chrome on Android, if available. Lock and unlock the phone or switch apps while playing, then check audio and the connection state after returning. If the OS or browser pauses the stream or blocks automatic restart, tap **Play** or **Retry**. Verify output volume with the device controls as well as the player controls. [WebKit media gesture requirements](https://webkit.org/blog/6784/new-video-policies-for-ios/)

While the stream is playing, **Local startup delay** shows the time from starting the current connection attempt to the browser's first `playing` event. **Delay from live** is unavailable because this MP3 stream supplies no source playback timestamp that the browser can use to measure it. The **Station now playing** label and **Station listeners** count come from AzuraCast. The label can change before a buffered client reaches that track, and the station-wide count can lag and includes listeners outside the Branch Player.

## Production routing

Production serves `dist/` and the allowlisted AzuraCast API, artwork, and audio routes on the same HTTPS hostname. The deployment runbook includes the edge configuration, port and DNS checklist, backups, rollback, and physical-device acceptance test. [Linux VPS deployment runbook](../deploy/production/README.md)
