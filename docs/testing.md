# Ghmaas Baladi Radio verification and acceptance

Use the automated fixtures to validate application behavior and the public demo to validate transport and device playback. Run the build and fixture commands from the repository root in a disposable checkout when the live host is serving the assessment.

## Reproduce the builds and fixtures

The assessment used Node.js 20.20.2 and the checked-in npm lockfiles. Backend audio fixtures require `ffmpeg` and `ffprobe`. The browser suite requires Playwright Chromium and its system libraries. The upload wrapper uses Python 3, Bash and a pseudo-terminal.

```bash
npm ci --prefix frontend
npm ci --prefix backend
npm run lint --prefix frontend
npm run check --prefix backend
npm run build --prefix backend

VITE_ADMIN_ENABLED=false VITE_AZURACAST_STATION=ghmaas_baladi_radio \
  VITE_PUBLIC_RADIO_ORIGIN=https://hussam.tail1a8390.ts.net VITE_STREAM_URL= \
  npm run build --prefix frontend

VITE_ADMIN_ENABLED=true VITE_AZURACAST_STATION=ghmaas_baladi_radio \
  VITE_PUBLIC_RADIO_ORIGIN=https://hussam.tail1a8390.ts.net VITE_STREAM_URL= \
  npm run build --prefix frontend -- --outDir dist-admin --emptyOutDir

npm run test --prefix backend
npm exec --prefix backend -- playwright install chromium
npm run test:browser --prefix backend
python3 deploy/docker/tests/approved-upload.test.py

docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml -f deploy/docker/compose.tailnet.yaml config --quiet
```

The backend suite uses a local AzuraCast fixture for API authorization, upload, playlist verification and error handling. The browser suite tests the private Admin workflow and verifies dashboard artwork, responsive layouts and reduced motion in both frontend builds. The Python suite substitutes a Compose fixture to exercise the approved upload window. Production keys, station music and live radio services are outside these fixture runs.

The dedicated public Playwright and smoke scripts also exercise blocked requests, including negative-test POSTs. Use an isolated or explicitly authorized target for those suites. A read-only live check can load the Dashboard and Branch Player, fetch Now Playing and sample the HTTPS MP3 connection. The visual smoke checks require the release assets below. [Public demo smoke checks](../deploy/demo/README.md#test-the-public-https-url)

## iPhone upload and on-air verification

1. Confirm permission for the exact input audio and the playlist addition. On the iPhone, connect to the authorized tailnet and open Private Admin in Safari. Sign in with the Admin account.
2. Open **Upload Music**, select the approved MP3 from iOS Files, and wait until Music Library verifies the upload. Record the media ID and its library membership.
3. Select **Add to Main Rotation** if authorized. Refresh the Library and Main Rotation and confirm the track appears once. Compare the other entries with the recorded baseline and use the authenticated AzuraCast order endpoint to check weights. If a request times out, inspect the catalog and playlist before repeating it. [AzuraCast order endpoint](../deploy/admin/README.md#installed-azuracast-contract)
4. Keep the public Branch Player open while AutoDJ reaches the track naturally. Record the Amman timestamp and AzuraCast song history ID. Confirm the title in public Now Playing and confirm the audio in the listener connection. A history record and audible output distinguish a successful broadcast from a successful upload.
5. For a Wi-Fi listening check, use the public link without the private VPN route. After tapping **Play**, listen through at least one track transition and record elapsed listening time, interruptions and recovery behavior.

For the assessment on 25 November 2026, two separate ten-minute iPhone Wi-Fi listening checks were reported as passed. Media ID 9 was uploaded on iPhone, assigned and played naturally at **16:25:15 Asia/Amman**, song history ID **1853**. Captured public audio matched the source. The rotation restoration passed at **16:38**. A later append produced ten entries with media ID 10 at position 10, weight 6. The verifier fix was deployed to the private backend at **17:32**. A 62-second HTTPS MP3 sample decoded without errors across that replacement.

[Private mobile workflow](../deploy/docker/mobile.md#use-a-phone) · [Admin workflow and verification](../deploy/admin/README.md#operator-and-branch-workflows)

## Release asset review

| Path | Provenance and release disposition |
| --- | --- |
| `frontend/public/images.jpg` | Supplied by the restaurant/company. The operator reports permission to use and publish it for the project. The release uses that permission for the CDR assessment. |
| `frontend/src/assets/broadcast-studio.svg` | Original vector illustration drawn from geometric shapes for this release. The public and private builds bundle it locally. |

The CSS glow and original SVG replace the previous dashboard video and raster backdrop. The old video, raw source footage, raster artwork, station tracks and private diagnostics stay outside the submission repository.
