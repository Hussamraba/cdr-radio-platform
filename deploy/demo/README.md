# Ghmaas Baladi Radio public assessment demo

The assessment runs Caddy and Tailscale Funnel inside Ubuntu WSL2. Caddy serves `frontend/dist`, listens on **`127.0.0.1:8088` only** and makes read-only requests to the existing AzuraCast at `127.0.0.1:80`. An evaluator can open the HTTPS Funnel URL in a regular browser. [Public Dashboard](https://hussam.tail1a8390.ts.net/) · [Funnel requirements](https://tailscale.com/docs/features/tailscale-funnel)

The proxy serves the SPA, its build assets, one station's Now Playing API, public track and fallback artwork, and the MP3 mount. The public player and playlist links emitted by AzuraCast resolve to the React player and one-stream playlist descriptors served by Caddy. All other paths return 404 and methods other than GET/HEAD return 405. The proxy sets upstream origin headers from its configured host, removes incoming headers except media range headers, and drops query parameters before forwarding. AzuraCast admin, login, account, and management routes have no upstream handler.

## Build and start locally in Ubuntu WSL2

Run from the repository root. Check that the existing AzuraCast installation is reachable and port 8088 is free.

```bash
curl --fail --silent --show-error --max-time 5 \
  http://127.0.0.1/api/nowplaying/ghmaas_baladi_radio >/dev/null
ss -ltn 'sport = :8088'

cd frontend
npm ci
npm run lint
VITE_ADMIN_ENABLED=false VITE_AZURACAST_STATION=ghmaas_baladi_radio \
  VITE_PUBLIC_RADIO_ORIGIN=https://hussam.tail1a8390.ts.net VITE_STREAM_URL= npm run build
cd ..
```

Use Caddy 2.11.9 or a compatible current version. The example below installs only the verified Linux binary under your user account. A system Caddy service can take ports 80/443 during package installation, so use the standalone binary for this demo. [Caddy v2.11.9 release](https://github.com/caddyserver/caddy/releases/tag/v2.11.9)

```bash
(
  set -eu
  version=2.11.9
  arch=$(dpkg --print-architecture)  # amd64 or arm64 on WSL2
  release="https://github.com/caddyserver/caddy/releases/download/v$version"
  archive="caddy_${version}_linux_${arch}.tar.gz"
  checksums="caddy_${version}_checksums.txt"
  scratch=$(mktemp -d)
  trap 'rm -rf -- "$scratch"' EXIT
  cd "$scratch"
  curl -fSsLO "$release/$archive"
  curl -fSsLO "$release/$checksums"
  awk -v archive="$archive" '$2 == archive { print $1 "  " $2 }' "$checksums" | sha512sum --check -
  tar -xzf "$archive" caddy
  install -D -m 0755 caddy "$HOME/.local/bin/caddy"
)
```

Start from the repository root in a dedicated terminal. For local-only use, leave `GHMAAS_DEMO_HOST` unset. To prepare for Funnel, export the exact hostname from the section below first.

```bash
test -s frontend/dist/index.html
demo_state="${XDG_STATE_HOME:-$HOME/.local/state}/ghmaas-radio-demo"
mkdir -p "$demo_state"
"$HOME/.local/bin/caddy" validate --config deploy/demo/Caddyfile --adapter caddyfile
"$HOME/.local/bin/caddy" run --config deploy/demo/Caddyfile --adapter caddyfile \
  2>&1 | tee "$demo_state/caddy.log"
```

In a second Ubuntu terminal, run the health and security checks, confirm the listener address, and inspect startup or proxy errors.

```bash
node deploy/demo/smoke-test.mjs
ss -ltn 'sport = :8088'
tail -f "${XDG_STATE_HOME:-$HOME/.local/state}/ghmaas-radio-demo/caddy.log"
```

Open `http://127.0.0.1:8088/player` locally. Press **Ctrl+C** in the Caddy terminal to stop the demo proxy. `tail -f` has its own **Ctrl+C**. This process uses the compiled build and does not start Vite or manage Docker.

The smoke test checks direct SPA routes, assets, range delivery for the restaurant logo, JSON-provided media and player links, real MP3 bytes, and denial of private routes and writes. The logo must return `206` with the requested byte range. The proxy passes `Range` and `If-Range` upstream. This mount returned `206` for a bounded MP3 range, and some live mounts answer `200` and continue streaming. A `206` response alone does not establish a seekable broadcast timeline. Caddy leaves the response streaming and disables cache for proxied responses. [Caddy streaming behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming)

## Publish with Tailscale Funnel when ready

The assessment uses the Ubuntu WSL2 procedure below. The Windows procedure is available for a host where Windows can reach WSL over loopback. Use one Tailscale client for the public host path. The Windows command below verifies localhost forwarding before publication. [Tailscale on WSL2](https://tailscale.com/docs/install/windows/wsl2) · [Windows-to-WSL localhost forwarding](https://learn.microsoft.com/en-us/windows/wsl/networking#accessing-linux-networking-apps-from-windows-localhost)

1. In PowerShell, confirm Ubuntu uses WSL2 and get the Tailscale hostname for the Windows node. If localhost forwarding is unavailable on your machine, use the Ubuntu-only alternative below.

   ```powershell
   wsl -l -v
   curl.exe --fail --silent --show-error http://127.0.0.1:8088/player -o NUL
   (tailscale status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
   ```

2. Stop the local Caddy process. In Ubuntu, set the returned hostname without `https://`, a port, or a trailing dot, and repeat the **Start** command block above. Caddy selects HTTPS URL generation only for this configured host, independent of incoming forwarded headers.

   ```bash
   export GHMAAS_DEMO_HOST='your-node.your-tailnet.ts.net'
   ```

3. When you are ready to make it public, check for an existing Serve or Funnel mapping on the Windows node before assigning HTTPS 443. Allow the official CLI prompts to enable Funnel, HTTPS certificates, and the necessary tailnet policy for the demo node. If you do not control the tailnet, its administrator must enable Funnel for that node. The target is **8088**. The public port **443** is a Tailscale HTTPS listener, separate from AzuraCast's host ports. [Funnel setup](https://tailscale.com/docs/features/tailscale-funnel) · [Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel)

   ```powershell
   tailscale serve status
   tailscale funnel status
   tailscale funnel --bg --https=443 http://127.0.0.1:8088
   tailscale funnel status
   ```

   To remove this persistent mapping, run `tailscale funnel --bg --https=443 off` and confirm with `tailscale funnel status`. Then stop Caddy if the demo is over.

**Ubuntu WSL2 procedure used by the assessment.** Use the official Linux install and sign-in procedure. With the daemon running, use these commands to obtain the Ubuntu node hostname, configure Caddy as in step 2, and manage Funnel. [Tailscale Linux installation](https://tailscale.com/docs/install/linux)

```bash
sudo tailscale up
sudo tailscale status --json | node -pe 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).Self.DNSName.replace(/\.$/, "")'
sudo tailscale serve status
sudo tailscale funnel status
# Run after setting GHMAAS_DEMO_HOST and restarting Caddy.
sudo tailscale funnel --bg --https=443 http://127.0.0.1:8088
sudo tailscale funnel status
# Run when finished sharing.
sudo tailscale funnel --bg --https=443 off
```

## Test the public HTTPS URL

Use the actual HTTPS origin shown by `tailscale funnel status`. Run the same smoke test with that origin. The test validates HTTPS with the normal trust store, checks that JSON-provided links and artwork redirects stay on the same origin, and repeats the denial checks.

```bash
node deploy/demo/smoke-test.mjs 'https://your-node.your-tailnet.ts.net'
```

On a tailnet host, MagicDNS can resolve the Funnel hostname to the host’s private Tailscale address. If that produces a TLS error, look up a public A record with an external DNS resolver and set `PUBLIC_FUNNEL_IP` to that address for this command. The smoke test keeps the HTTPS hostname and normal certificate verification.

From an Android phone on mobile data with Wi-Fi and Tailscale disconnected, open the public dashboard and `/player`. Check the logo, current track and artwork. Confirm playback starts only after a tap and the stream continues through a metadata refresh. In a desktop browser's Network tools, confirm the API, artwork, and audio requests stay on the public HTTPS origin. Open `/admin`, `/login`, and `/api/admin` on the public host and confirm HTTP 404 before sharing the link with an evaluator.

## Assessment limits

- Keep the Windows laptop powered on and awake. Ubuntu WSL2, Docker/AzuraCast, Caddy, and the selected Tailscale client must keep running.
- Availability follows the laptop and its internet connection. Funnel is a beta service with bandwidth limits and this setup has no guaranteed 24/7 uptime. [Funnel limits](https://tailscale.com/docs/features/tailscale-funnel#limitations)
- Icecast sessions buffer independently. Multiple players share the same broadcast and their audible playback can be offset. [Icecast buffering settings](https://www.icecast.org/docs/icecast-latest/config_file/)
- A sustained WSL2 clock-rate change can affect source pacing. Use the recorded frame-rate checks and a physical phone listening test when diagnosing audio drift. [WSL2 pacing evidence and checks](../../docs/architecture.md#wsl2-audio-pacing)
- The Funnel URL is public. Share it when the public checks pass and turn Funnel off when the assessment ends.
