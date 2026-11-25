# Engineering challenges and lessons

The incidents below occurred during the November 2026 assessment build and acceptance work. The linked runbooks describe the current setup and how to repeat the relevant checks.

## AzuraCast and Docker setup

- **Problem** — Package the custom app while preserving an existing AzuraCast installation and its active broadcast. The Compose Bake builder also crashed on the assessment WSL2 host.
- **Investigation** — Checked Docker network membership, the AzuraCast alias, host port ownership, operator file permissions, build output, and the existing station API.
- **Root cause** — The custom containers depend on the existing `azuracast_default` bridge and its `azuracast` alias. The previous standalone Admin already owned port 18090. The build failure was isolated to the Bake path on the installed Compose version.
- **Correction** — Kept AzuraCast in its own Compose lifecycle, joined its external network, and published the new app services on loopback. Released port 18090 after checking the previous process was idle. Used `COMPOSE_BAKE=false` on the affected host.
- **Verification** — The custom services reported healthy, the backend reached the station API, and the base and mobile Compose models validated. The public Caddy endpoint continued serving the station.
- **Lesson** — Verify network aliases, port ownership, and runtime prerequisites before replacing an app service. Record builder workarounds as host-specific. [Compose runbook](../deploy/docker/README.md)

## WSL2 streaming pace

- **Problem** — Audio arrived slightly slower than real time even as connections stayed open.
- **Investigation** — Captured the Liquidsoap source and the Icecast, Caddy, and Funnel outputs. Counted MP3 samples against `CLOCK_MONOTONIC_RAW` after the initial burst and compared that with WSL's adjusted clock.
- **Root cause** — The deficit was already present at the Liquidsoap source at about 0.981 audio seconds per raw monotonic second. The adjusted clock showed a similar rate deficit. The measurements identified host clock behavior as the likely cause on this host.
- **Correction** — Temporarily stopped Windows Time and disabled its startup during the diagnosis. Pacing recovered during the observation. A later audit measured near-real-time delivery with Windows Time running in demand-start mode.
- **Verification** — The post-intervention source and Funnel measured about 1.001× real time over roughly seven minutes. During the public release cutover, direct Icecast measured 1.000016× and public Funnel measured 1.001640× in continuous 90-second samples.
- **Lesson** — Compare decoded samples with a raw monotonic clock at several points in the pipeline. Measure before changing host time settings, then recheck under the intended service configuration. [Pacing evidence and checks](architecture.md#wsl2-audio-pacing)

## iPhone playback troubleshooting

- **Problem** — The operator reported intermittent audio in iPhone Safari even when server-side checks showed an active station.
- **Investigation** — Compared physical phone observations with server-side MP3 timing, transport continuity, and browser playback progress. Checked that a stalled browser playback clock could be identified separately from online station metadata.
- **Root cause** — A sustained upstream pacing deficit reduced the margin available to the listener's buffer. The investigation confirmed this deficit. An exact Safari buffer threshold or a universal iPhone failure mode was outside the measurement.
- **Correction** — Rechecked phone playback after the host pacing intervention. The player reports stalls and reconnection from audio events and advancing playback time, independently of Now Playing.
- **Verification** — The operator reported two separate ten-minute Wi-Fi listening passes. The iPhone upload-to-air test also reached AutoDJ naturally. Media ID 9 aired at 16:25:15 Asia/Amman on 25 November, history ID 1853, with public audio matched to the test source.
- **Lesson** — Collect source, transport, and physical-device evidence separately. Use a real phone for listening and a browser fixture for repeatable playback-state regressions. [iPhone verification procedure](testing.md#iphone-upload-and-on-air-verification)

## Playlist verifier false HTTP 409

- **Problem** — Music Library reported `409 rotation_order_changed` even though AzuraCast had added media ID 10 to Main Rotation.
- **Investigation** — Compared the catalog, playlist rows, and backend verification. Fresh reads found media ID 10 once at position 10 with weight 6. The preceding nine row IDs, media IDs, and weights matched. Five existing entries shared weight 3.
- **Root cause** — The post-write comparison treated array position as stable. AzuraCast can return entries sharing the same weight in a different relative order.
- **Correction** — Matched existing rows by playlist-entry ID, media ID, and weight, and preserved the weight sequence so only equal-weight rows could permute. The verifier checks fresh media membership and requires the appended item once at the end, above the previous maximum weight. An already verified assignment returns without a second write.
- **Verification** — Backend fixtures covered tied-weight permutations, repeat assignment, invalid or duplicate rows, changed weights, and upstream failure. The fix was deployed to the private backend on 25 November. The live read-back confirmed ten entries and media ID 10 once while the public MP3 sample decoded across the replacement.
- **Lesson** — Treat a post-write error as an uncertain outcome until an authoritative read confirms what happened. Compare durable row identities and sort keys before attempting a retry. [Verifier source](../backend/src/azuracast.ts) · [Backend regressions](../backend/tests/admin.test.mjs)

## Private Admin access and security

- **Problem** — Operators needed to upload from a phone while branch listeners needed ordinary public browser access. Private enrollment and socket reachability also had to be verified on the real mobile path.
- **Investigation** — Checked the independent Tailscale Serve path, node enrollment, Unix socket, forwarded identity, session authentication, public route denial, and the scope of the AzuraCast service account.
- **Root cause** — The public Funnel intentionally exposes only the listener surface. Desktop Admin binds to loopback, so an authorized phone needs its own private ingress path in addition to an app session.
- **Correction** — Enrolled a separate Serve node that sends private HTTPS to Express over a Unix socket. Kept a separate Admin sign-in and Origin and CSRF checks for writes. Kept the AzuraCast key server-side.
- **Verification** — The iPhone upload and assignment exercise reached the real station through Admin. Release checks returned 404 for sampled public Admin paths and 401 for unauthenticated private API calls. Isolated fixtures tested authentication and CSRF. The audit also found that the deployed key could read protected station settings beyond this workflow.
- **Lesson** — Verify public route denial, private network access, and application authentication independently. Confirm effective upstream permissions before expanding access. [Access boundaries](architecture.md#admin-authentication-and-music-workflow) · [Mobile Admin runbook](../deploy/docker/mobile.md)

## Deployment and source release

- **Problem** — The Git release had to build from a clean checkout. The former web build depended on a video and raster artwork with unresolved redistribution rights, and the live Caddy root initially served an older build.
- **Investigation** — Audited the Git index, local-only files, asset provenance, build references, and the actual Caddy document root. Compared live files with a clean build of the release commit.
- **Root cause** — Essential project files were initially outside Git. Early builds referenced locally available assets, and the host Caddy document root and Docker preview each had their own build.
- **Correction** — Reviewed an explicit source allowlist and replaced the old visual with CSS and an original SVG. Built the public frontend from the exact release commit, verified the previous files and rollback copy, and exchanged only the Caddy static directory atomically. Kept previously served compatibility assets available for open browser sessions.
- **Verification** — All 19 public release files matched the clean build byte for byte. The live browser loaded the SVG, had no missing assets or console errors, and made no legacy artwork requests. The public and direct MP3 samples spanned the cutover.
- **Lesson** — Build from the release commit, verify the live root and emitted asset bytes, keep rollback content, and measure broadcast continuity across a static publish. [Submission evidence](submission.md#test-evidence) · [Release asset review](testing.md#release-asset-review)
