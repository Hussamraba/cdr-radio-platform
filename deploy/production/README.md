# Ghmaas Baladi Radio production runbook

## Server and DNS information to collect

| Area | Information required before deployment |
| --- | --- |
| VPS | Provider and region, Linux distribution and version, CPU architecture, vCPU/RAM, usable disk space and attached volumes, and monthly outbound transfer allowance. Provide the fixed public IPv4 and any existing IPv6 address or records. |
| Operator access | SSH hostname or IP, SSH port, deployment username, whether it can use `sudo` and Docker, and the public source IPv4 CIDRs for SSH and the AzuraCast admin panel. Confirm provider firewall access and an out-of-band recovery console. Use your existing SSH key or an approved access mechanism. |
| Port ownership | List the processes and Docker publications on TCP 80/443 on the target, plus any existing websites or proxies that must keep those ports. Confirm whether anyone needs external DJ/source connections or AzuraCast SFTP, and their source networks if needed. |
| DNS and TLS | Public listener hostname and a separate admin hostname, authoritative DNS provider and zone, who can change records, current A/AAAA/CNAME records and TTLs for both names, any inherited CAA policy, any CDN/proxy mode, and an ACME operations email address. Confirm that the intended audience can access the listener URL without signing in. |
| Radio and recovery | Source AzuraCast version and release channel or image digest, station shortcode/ID, MP3 mount, configured bitrate, expected concurrent listeners, media/recording size and storage locations, encrypted off-site backup destination, retention and recovery targets, and an approved maintenance window with an operator for the phone test. |

Share configuration facts through the project handoff. Use a password manager or approved secrets channel for private credentials and never include them in repository files, build settings, or the deployment handoff.

## Architecture and ports

```text
Desktop / Android ── HTTPS radio.example.com ───────┐
Operator IPv4 CIDR ─ HTTPS radio-admin.example.com ─┤
                                                    v
                                               Caddy :80/:443
                                               ├── static frontend release
                                               └── private Docker bridge ── azuracast-radio:80
                                                                             └── AzuraCast / Icecast / Liquidsoap
```

The public host serves the compiled Vite `dist/` and forwards only `GET` and `HEAD` for the station's Now Playing, artwork, and MP3 routes. The browser uses the same HTTPS hostname for all three. Caddy reaches AzuraCast using its Docker network alias and forwards the path and query. The administration host reaches the full AzuraCast UI only from the approved source IP ranges. Caddy handles public TLS and keeps certificate state in its persistent `/data` volume. This example assumes DNS points directly to the VPS. An upstream CDN or load balancer would change the peer IP seen by Caddy and needs its own trusted-proxy design and streaming validation. [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https) · [Caddy proxy headers and streaming](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

AzuraCast's stock Compose file publishes host 80/443, SFTP, and a range of station ports. Two services cannot bind the same host address and port. The example override replaces the AzuraCast publication list with an empty one and adds its `web` service to the edge network. Leave the AzuraCast internal HTTP port at `80` for this example. If the target already uses a custom internal port, confirm it and update the Caddy upstream accordingly. The MP3 still goes through AzuraCast's internal web mount. Keep database, cache, raw Icecast, DJ/source, SFTP, the Docker API, and Caddy's management API off the public internet. If remote source or SFTP access is required, scope that access through an approved private network before cutover. [AzuraCast Compose sample](https://github.com/AzuraCast/AzuraCast/blob/main/docker-compose.sample.yml) · [Docker port publishing and firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/)

| DNS record | Value for this example |
| --- | --- |
| `radio.example.com` `A` | The VPS's fixed public IPv4 address. |
| `radio-admin.example.com` `A` | The same public IPv4. The Caddy allowlist controls access separately from DNS. |
| `AAAA` | The sample binds IPv4 only. Publish AAAA after configuring and testing IPv6 ingress and the admin allowlist over IPv6. Clear stale AAAA records during cutover if IPv6 is unavailable. |
| `CAA`, if configured | Permit `letsencrypt.org` for both hosts, accounting for parent-zone inheritance. |

Allow inbound TCP 80/443 to Caddy after staging. Restrict the SSH port to approved operator networks. DNS-only records let Let's Encrypt reach Caddy directly for validation. The example uses Caddy's defaults for TLS, HTTP-to-HTTPS redirects, and automatic renewal. [Let's Encrypt HTTP-01 and TLS-ALPN-01](https://letsencrypt.org/docs/challenge-types/) · [Let's Encrypt CAA](https://letsencrypt.org/docs/caa/)

## Configuration

| Where | Setting | Production value |
| --- | --- | --- |
| Frontend build | `VITE_AZURACAST_STATION` | Optional. Defaults to `ghmaas_baladi_radio`. A change must match the station allowlist in the Caddyfile. |
| Frontend build | `VITE_STREAM_URL` | Leave unset or empty to use `/listen/ghmaas_baladi_radio/radio.mp3` for this station. Coordinate any same-origin mount override with the Caddyfile. |
| Local Vite only | `AZURACAST_ORIGIN` | Local Vite proxy target. The static production release uses the edge proxy's Docker upstream at runtime. |
| Edge `.env` | `RADIO_HOST`, `RADIO_ADMIN_HOST`, `ACME_EMAIL` | Real hostnames without a scheme or port, and the operations contact email. Use distinct hostnames. |
| Edge `.env` | `RADIO_ADMIN_CIDRS` | Space-separated approved operator public IPv4 addresses or CIDRs. The example uses a documentation-only address. |
| Edge `.env` | `FRONTEND_ROOT`, `CADDY_IMAGE` | Host release directory and validated Caddy image. Pin the tested image digest for the rollout. |
| AzuraCast | `.env`, `azuracast.env`, Compose override | Server-side install settings generated for the destination. Keep AzuraCast's internally configured port aligned with the edge upstream. Store any AzuraCast passwords, private API keys, and storage credentials in AzuraCast or protected server-side configuration. |

Examples are in [.env.example](.env.example), [edge Compose](compose.example.yml), [AzuraCast override](azuracast.override.example.yml), and [Caddyfile](caddy/Caddyfile). The Caddyfile uses station ID `1` as an artwork route alias for this installation. Verify the restored ID and the generic artwork redirect path before going live. Use AzuraCast's public Now Playing endpoint and web-proxied MP3 mount. Set the AzuraCast site base URL to the administrator HTTPS hostname for links generated outside an HTTP request. Check generated artwork and mount links through the listener hostname and confirm that the web proxy honors the incoming HTTPS host and scheme. [AzuraCast mount settings](https://www.azuracast.com/docs/user-guide/mount-points/)

Every `VITE_*` value is public. Keep the deployment directory, secrets, and AzuraCast files outside the static document roots. Public proxy requests have authorization, API-key, and cookie headers removed. Caddy replaces inbound forwarded host/protocol/IP values with edge-generated values for a direct DNS deployment. Keep the admin login on its restricted hostname and use strong credentials and MFA. Review current AzuraCast security advisories and choose a patched image before making the service reachable. [AzuraCast security advisories](https://github.com/AzuraCast/AzuraCast/security/advisories) · [Vite environment variables](https://vite.dev/guide/env-and-mode)

## Deployment checklist

- [ ] Confirm the server and DNS details above. Check `sudo ss -ltnp` and `docker ps --format '{{.Names}} {{.Ports}}'` on the target. Resolve any existing 80/443 ownership with its operator before changing listeners. Size egress for `bitrate in kb/s × concurrent listeners`, plus overhead. Allow disk for media, database, logs, and staging an archive for backup or restore.
- [ ] Choose a tested source revision, patched AzuraCast build, and Caddy image digest. Set up Linux security updates, key-based SSH, Docker Engine with Compose 2.24.4 or later, provider firewall rules, and time synchronization. Keep the VPS web ports restricted during initial AzuraCast install or restore. [Docker Compose override requirements](https://docs.docker.com/reference/compose-file/merge/#replace-value)
- [ ] Create the external bridge on the future VPS with `docker network create ghmaas-radio-edge`. Install or restore the target AzuraCast in a maintenance window. Merge the example into the target `docker-compose.override.yml` without dropping other required overrides. Verify the resulting `web` publish list is empty, then run `docker compose up -d web` in the target AzuraCast directory. The port/network change can interrupt listeners. Keep the working local station available during the cutover.
- [ ] Build a reproducible frontend release with a maintained Node.js LTS that satisfies the locked Vite engine requirement (`^20.19.0 || >=22.12.0` in the current checkout). Have `rsync` available for release staging, `curl` and `jq` for health checks, and `unzip` for backup verification. Stage `dist/` under a new release ID and activate it as shown below. Copy the edge example files to an operations directory and create the edge `.env` from its example with destination values. Only the release tree is mounted as website content. [Vite static deployment](https://vite.dev/guide/static-deploy.html)
- [ ] Validate the edge Compose model with `docker compose -f compose.example.yml config --quiet`. Validate the Caddyfile before publishing the edge using `docker compose -f compose.example.yml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`. On the target AzuraCast, use `docker compose config --quiet` and inspect only its port bindings, for example `docker compose config --format json | jq '.services.web.ports // []'` without dumping the full config. Confirm the inspector returns `[]` and the recreated `web` container publishes no host ports.
- [ ] Point DNS at the VPS and open 80/443 to Caddy. Start the edge with `docker compose -f compose.example.yml up -d` from its operations directory. Check certificate issuance and the external health checks below. Confirm that an allowed operator reaches the admin login and that a connection from an unapproved network gets HTTP 403.
- [ ] Run the desktop/Android test below before handing the listener URL to branches. Record the release IDs, image digests, timestamp, probe results, and verified backup/restore location. Start monitoring external HTTPS, certificate expiry, station status, stream bytes, storage, and backup age.

### Stage and activate a frontend release

From `frontend/`, use the production build environment when running the checks and build.

```sh
npm ci
npm run lint
VITE_AZURACAST_STATION=ghmaas_baladi_radio VITE_STREAM_URL= npm run build
```

On the destination VPS, from the directory containing the staged `dist/` artifact, substitute your own release ID and match `FRONTEND_ROOT` in the edge environment. Run under the deployment account authorized to write the release directory.

```sh
set -eu
release_root=/srv/ghmaas-radio
release_id=replace-with-release-id
install -d "$release_root/releases/$release_id" "$release_root/assets"
rsync -a dist/ "$release_root/releases/$release_id/"
rsync -a --ignore-existing dist/assets/ "$release_root/assets/"
test -s "$release_root/releases/$release_id/index.html"
cd "$release_root"
ln -s "releases/$release_id" ".current-$release_id"
mv -Tf ".current-$release_id" current
```

Keep the prior release alongside the new one. Caddy serves content-hashed Vite assets from the shared `assets/` directory so pages loaded before a release switch can still fetch their assets. Keep the assets for rollback candidates and expire obsolete releases only after the rollback window and client cache period.

## External health checks

Run these from outside the VPS against the real listener hostname. Check HTTP redirects to HTTPS and ensure normal certificate chain and hostname validation succeeds. Use a known artwork path from Now Playing to check that its redirect stays on HTTPS and returns an image. A request to a nonallowlisted path such as `/api/admin` on the listener host should return 404. The admin host should return 403 from the non-operator network. Monitor expiry and alert before certificate or backup age thresholds are exceeded.

```sh
set -eu
origin=https://radio.example.com
curl --fail --silent --show-error --max-time 10 "$origin/player" | grep -q '<div id="root">'
curl --fail --silent --show-error --max-time 10 "$origin/api/nowplaying/ghmaas_baladi_radio" |
  jq -e '.station.shortcode == "ghmaas_baladi_radio" and .is_online == true' >/dev/null

probe=$(mktemp -d)
trap 'rm -rf -- "$probe"' EXIT
status=0
curl --fail --silent --max-time 8 --dump-header "$probe/headers" \
  --output "$probe/audio" "$origin/listen/ghmaas_baladi_radio/radio.mp3" || status=$?
# Curl can time out after receiving audio because a healthy live stream stays open.
test "$status" -eq 0 || test "$status" -eq 28
grep -Eiq '^HTTP/[^ ]+ 200([[:space:]]|$)' "$probe/headers"
grep -Eiq '^content-type:[[:space:]]*audio/mpeg([;[:space:]]|$)' "$probe/headers"
test "$(wc -c < "$probe/audio")" -ge 4096
```

Run both API and bounded stream probes. JSON alone misses audio failures, and HTTP headers alone miss a stalled stream. Alert on repeated failures, and inspect Caddy and AzuraCast service logs on the VPS without copying secrets or authorization material into incident reports.

## Rollback

1. For a frontend regression, atomically switch `current` to the previous `releases/<id>` with the same relative symlink and `mv -Tf` procedure. Keep the shared assets for both versions. Run the external checks again.
2. For an edge routing or configuration regression, restore the previous Caddyfile and env values. Validate first, then reload with `docker compose -f compose.example.yml exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`. If the Compose environment or edge image changed, restore the prior values and recreate the edge service in the rollback window. Preserve certificate volumes. Confirm audio, metadata, and the admin access boundary again.
3. For an AzuraCast data or upgrade failure, keep the last good source available and restore the verified backup onto an isolated replacement, or revert a tested consistent snapshot from before the change. Use an AzuraCast version compatible with the archived database and media. Treat a database migration rollback as a data restore. Switch upstream or DNS back once the recovered station passes health checks. DNS caches may continue using the previous record until its TTL expires.

## Back up and restore AzuraCast

**Backup.** Schedule backups in AzuraCast's System Administration and make an on-demand full backup before the move and before upgrades. Include local station media. Record the source version and image digest, backup creation time, and storage locations. Copy backups off the VPS to encrypted storage with access controls and retention. Independently back up externally mounted or object-stored media and recordings, and preserve server-side installation settings, custom files, Compose overrides, and any required credentials in a separate protected recovery bundle. Verify which recordings and custom uploads are present in the archive during the restore drill. [AzuraCast Backup & Restore](https://www.azuracast.com/docs/administration/backup-and-restore/) · [AzuraCast storage locations](https://www.azuracast.com/docs/administration/storage-locations/)

```sh
set -eu
cd /var/azuracast
umask 077
backup_dir=/var/backups/azuracast
install -d -m 700 "$backup_dir"
archive="ghmaas-$(date -u +%Y%m%dT%H%M%SZ).zip"
./docker.sh backup "$backup_dir/$archive"
unzip -tq "$backup_dir/$archive"
(cd "$backup_dir" && sha256sum "$archive" > "$archive.sha256")
```

**Restore drill.** On a separate destination or recovery Docker host, stage a disposable copy of the backup and its checksum with restricted permissions. Run `sha256sum -c` on the staged copy and install a compatible AzuraCast release. The restore command replaces existing AzuraCast data and the utility can move the input archive into a Docker volume. Keep the off-site copy intact and use a Docker host with no other AzuraCast installation that could be affected by volume cleanup. [AzuraCast Docker utility](https://www.azuracast.com/docs/administration/docker/)

```sh
cd /var/azuracast
./docker.sh restore /restricted/staging/replace-with-archive.zip
```

Reconnect any separately backed-up media storage and restore environment-specific settings. Before cutover, verify admin sign-in, station shortcode, local media and recordings, playlist order and schedules, metadata/artwork, and several minutes of playback. Measure the time to recover and confirm it meets the agreed target. If the source is still broadcasting, keep the restored station isolated from external relays or live inputs during the drill.

## Real Android and desktop acceptance test

1. Open `https://<radio-host>/player` on a desktop on broadband and a real Android phone in Chrome on mobile data with Wi-Fi disabled. Use the normal public DNS on both. Confirm a valid certificate, direct loading of `/player`, and silence in both browsers until Play is pressed.
2. Start the desktop, then Android. Open **Playback diagnostics** on both. Confirm playback and station metadata. On the desktop, use Network tools to verify that the MP3 request and Now Playing polls use the listener HTTPS hostname. Leave both running through a track change. A matching station and audible program are the pass criteria. Icecast connections may buffer at different points and this MP3 cannot report delay from live.
3. Briefly interrupt only the phone's data connection, then restore it. Confirm desktop playback continues. Allow the phone to use its buffer, then check automatic recovery or tap Play/Retry if Android requires a gesture. Repeat after locking/unlocking the phone and when switching from mobile data to Wi-Fi. Confirm pause and volume behavior with the device controls.
4. Record the device/browser versions, networks, stream URL, the two connection outcomes, and any manual action required. Verify the admin hostname returns 403 from the phone's non-operator network. Save the results alongside the release ID.
