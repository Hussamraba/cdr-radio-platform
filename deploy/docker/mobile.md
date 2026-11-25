# Mobile access

Listeners use [the public Branch Player](https://hussam.tail1a8390.ts.net/player) over Wi-Fi or mobile data. The admin phone uses a separate HTTPS hostname on Tailscale. The dedicated `admin-tailnet` Compose service runs a userspace Tailscale client on its own Docker network. It publishes no Docker ports and uses a shared Unix socket to reach Express. The host Funnel keeps routing to Caddy at `127.0.0.1:8088`. Local Admin stays at `http://127.0.0.1:18090/admin`.

The two hostnames keep the private Secure session cookie scoped to the private hostname. On the socket, Serve uses `Host: localhost` and replaces the forwarded host and protocol with the original request values. Express checks the exact private forwarded hostname, HTTPS, and the operator login name asserted by Serve. The application also requires the existing Admin credentials and CSRF token. The desktop listener on port 18090 validates its own Host and ignores forwarded headers. Use a user-owned phone in the tailnet. Serve supplies identity headers for user-owned devices. [Tailscale Serve identity headers](https://tailscale.com/docs/features/tailscale-serve#identity-headers)

## Stage and enroll

From the WSL project root, save the current host configuration and verify the published player before starting the separate node.

```bash
umask 077
snapshot=$(mktemp -d)
tailscale funnel status --json > "$snapshot/host-funnel.json"
tailscale serve status --json > "$snapshot/host-serve.json"
curl --fail --silent --show-error -o /dev/null https://hussam.tail1a8390.ts.net/player
install -d -m 700 deploy/docker/.tailnet-runtime
mobile=(docker compose -f compose.yaml -f deploy/docker/compose.tailnet.yaml)
"${mobile[@]}" config --quiet
"${mobile[@]}" up -d --no-deps admin-tailnet
"${mobile[@]}" logs --tail=40 admin-tailnet
```

Open the most recent enrollment link locally and sign in with the radio operator’s Tailscale account. If device approval is enabled, approve the new `ghmaas-admin` device in the Tailscale admin console. Keep the enrollment URL private. The sidecar gives interactive enrollment 15 minutes and persists its node identity in a named volume. Check the actual name assigned in `"${mobile[@]}" exec admin-tailnet tailscale status --json` under `Self.DNSName`.

In the ignored project-root `.env`, set `GHMAAS_TAILNET_ADMIN_ORIGIN` to the exact HTTPS origin assigned to the new node, with no path. The expected value is `https://ghmaas-admin.tail1a8390.ts.net`. Set `GHMAAS_TAILNET_ADMIN_LOGIN` to the exact Tailscale login name used by the operator’s phone. Use the default `GHMAAS_ADMIN_MANAGEMENT_MODE=read-only` for deployment verification. The separate mode-600 `backend/.env` still holds the AzuraCast API key and private app credentials.

```bash
"${mobile[@]}" up -d --no-deps --build --wait backend
"${mobile[@]}" exec admin-tailnet tailscale serve --bg --https=443 unix:/run/ghmaas-tailnet/admin.sock
"${mobile[@]}" exec admin-tailnet tailscale serve status --json
tailscale funnel status --json | cmp "$snapshot/host-funnel.json" -
tailscale serve status --json | cmp "$snapshot/host-serve.json" -
```

Verify the new node’s status shows its own HTTPS hostname and Unix socket with no enabled `AllowFunnel` entry. The host Funnel mapping must still match the saved configuration. Apply any narrower network grant on the tailnet without changing grants for the public node. An identity mismatch at the admin socket returns HTTP 403 even if an existing broad tailnet grant permits a TLS connection. [Tailscale access controls](https://tailscale.com/docs/features/access-control)

To preserve mobile access during ordinary `docker compose up -d --build` runs on the enrolled host, set `COMPOSE_FILE=compose.yaml:deploy/docker/compose.tailnet.yaml` in the ignored project-root `.env` after the checks above pass. `docker compose config --services` should list `backend`, `frontend`, and `admin-tailnet`. A checkout without this setting starts the two base application services. Use `docker compose -f compose.yaml` when intentionally reverting to local-only Admin.

## Windows host access

On the Windows laptop hosting WSL, open [Local Admin](http://127.0.0.1:18090/admin). WSL forwards this loopback address to the Docker backend. Open the private HTTPS hostname from an authorized device with a tailnet route and MagicDNS. On this laptop the Tailscale client runs inside WSL and provides those to WSL clients. Use the loopback Admin URL from Windows while WSL hosts the public Funnel. Running Tailscale in both environments can interfere with nested Tailscale traffic. [Tailscale on Windows with WSL 2](https://tailscale.com/docs/install/windows/wsl2#considerations)

## Use a phone

### Branch listener

1. With Tailscale disconnected, open [the public Branch Player](https://hussam.tail1a8390.ts.net/player) in Android Chrome. Tap **Play**, listen for audio, and watch Now Playing change on a track transition. Repeat over Wi-Fi and mobile data. Record the phone model, Android and Chrome versions, network type, and time in Amman.
2. Open the same link on a desktop over Wi-Fi while the phone runs on mobile data. Listen through a track transition and confirm the same program and track order. Adjust the phone’s volume, mute it, and pause it while the desktop continues. Tap **Play** again to confirm the phone joins the ongoing program.
3. Turn off the phone’s mobile data briefly while Wi-Fi is off. Restore mobile data and record whether audio resumes by itself or after tapping **Retry**. Repeat with a screen lock, an app switch, a tab switch, and an audio interruption such as a call. Record each outcome. Android can suspend a browser tab or interrupt its audio. Reopen the tab and tap **Play** or **Retry** if playback stops.
4. To estimate the offset, put the two devices near a single stereo recorder, with the desktop speaker near the left microphone and the phone speaker near the right. Record both after they have settled into playback. In a waveform editor, find the same sharp beat or phrase on each channel and subtract the desktop timestamp from the phone timestamp. Repeat across a few events and record the signed offsets, the networks, and whether either device recently reconnected. Independent Icecast buffers can produce different offsets across connections. Measure tap-to-first-audio separately with a stopwatch.

### Private administrator

1. Install Tailscale from Google Play. Sign in with the authorized operator’s Tailscale account, select the correct tailnet, approve the VPN prompt, and confirm that the app shows **Connected**. Keep MagicDNS and Tailscale DNS enabled. [Tailscale on Android](https://tailscale.com/docs/install/android)
2. In Chrome, open [Private Admin](https://ghmaas-admin.tail1a8390.ts.net/admin) and sign in with the existing radio Admin account. Open **Overview**, **Music Library**, **Upload Music**, and **Main Rotation**. Refresh and confirm the same page loads with your session. Sign out, then reopen a protected page and confirm it asks you to sign in. If the private node is enrolled under a different name, use the HTTPS origin reported by its Serve command.
3. Disconnect Tailscale, turn off Wi-Fi, and retry the private URL in a fresh tab on mobile data. It should be unreachable. Confirm the public link still plays. If a second non-operator tailnet identity is available, verify it receives HTTP 403 whenever the tailnet grant lets it connect to Serve.
4. For upload acceptance, supply one original or licensed MP3, run the read-only preflight, and obtain explicit owner approval for the exact file and its addition to playlist 2. Open the scoped upload window from the WSL terminal. Saving the upload creates a catalog entry. Assignment adds it to the central rotation and can change what branches hear after the existing AutoDJ queue drains. [Scoped upload window](README.md#approved-mobile-upload-test) · [Acceptance and restoration](../admin/README.md#acceptance-and-rollback)
5. After approval, save the verified file to Android Downloads. Open **Upload Music → Browse files**, select the file, then tap **Upload selected**. Confirm the queued name, browser transfer progress, and the subsequent Music Library result. The limit is 24 MiB per file and ten queued files. Keep the tab open until verification. If the connection drops, check Music Library before retrying. Use **Add to Main Rotation** only within the approved scope and listen for the track on the public player.

For the same approved test on iPhone, connect Tailscale and open [Upload Music](https://ghmaas-admin.tail1a8390.ts.net/admin/upload) in Safari. Sign in, select the approved MP3 from iOS Files, upload it, and wait for verification. Use **Add to Main Rotation** in the upload queue, then type `CLOSE` in the WSL terminal after Admin confirms the assignment. [Approved upload window](README.md#approved-mobile-upload-test)

Once the owner enables persistent management for daily use, sign in through the same private URL and use Upload Music, Music Library and Main Rotation directly. [Owner activation and read-only switch](README.md#private-music-writes)

## Roll back the private access path

```bash
"${mobile[@]}" exec admin-tailnet tailscale serve --https=443 off
"${mobile[@]}" stop admin-tailnet
docker compose -f compose.yaml up -d --no-deps --no-build --wait backend
tailscale funnel status --json | cmp "$snapshot/host-funnel.json" -
```

Remove the `COMPOSE_FILE` setting from the project-root `.env` to keep future ordinary Compose runs in local-only mode. Recreating the backend expires admin sessions. To withdraw the node identity completely, remove the `ghmaas-admin` device in the tailnet admin console.
