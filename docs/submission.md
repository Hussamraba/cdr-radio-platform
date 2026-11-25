# CDR Group Online Radio Practical Assessment

Ghmaas Baladi Radio is a technical assessment implementation for delivering one centrally managed restaurant radio program to multiple branches. Listeners open a shared public player. An authorized operator uses a separate private console to upload approved audio, assign it to Main Rotation, and verify the result in AzuraCast and on air.

## Demo and source

| Item | Link or reference |
| --- | --- |
| Public Dashboard | [Open Dashboard](https://hussam.tail1a8390.ts.net/) |
| Public Branch Player | [Open Branch Player](https://hussam.tail1a8390.ts.net/player) |
| Direct MP3 | [Open live MP3](https://hussam.tail1a8390.ts.net/listen/ghmaas_baladi_radio/radio.mp3) |
| Public Music Management guide | [Open Music Management](https://hussam.tail1a8390.ts.net/library) |
| GitHub repository | [Hussamraba/cdr-radio-platform](https://github.com/Hussamraba/cdr-radio-platform) |
| Verified application release | [`07d07bbbf3369e7a9be4815a112e5e10c9b2516d`](https://github.com/Hussamraba/cdr-radio-platform/commit/07d07bbbf3369e7a9be4815a112e5e10c9b2516d) |

The frontend uses React, TypeScript, Vite, and HTML audio. The private service uses Node.js, TypeScript, Express, and FFmpeg tools for upload validation. Docker Compose runs the custom app alongside AzuraCast. Liquidsoap AutoDJ feeds Icecast. Caddy and Tailscale Funnel serve the public HTTPS site, and a separate Tailscale Serve endpoint provides private operator access.

## Evaluator walkthrough

1. Open the public Dashboard. Check the station status, current track, and upcoming track when available.
2. Open Branch Player and tap **Play**. Open the player in a second browser or on another device, then pause the first. The second player continues playing the shared broadcast, with its own buffer.
3. Open the direct MP3 link to try the underlying listener feed. Use the Branch Player for Now Playing and local playback controls.
4. Open public Music Management to see the operator workflow. For a private walkthrough, ask the operator to screen-share the authenticated Music Library and Main Rotation. Use the recorded iPhone upload-to-air evidence for the live-write demonstration.

## Test evidence

The following checks were recorded for the assessment release on 25 November 2026. Automated fixtures and live observations cover different parts of the system.

| Area | Recorded result |
| --- | --- |
| Clean release build | npm lockfile installs, frontend lint, public and private frontend builds, backend type check and build, and base and mobile Compose validation passed. |
| Automated suites | 21 backend tests, 6 browser fixture tests, and 10 upload-wrapper tests passed. The fixtures covered authentication and CSRF, upload, playlist verification, responsive artwork, reduced motion, and failure handling. |
| Live public release | Dashboard, Branch Player, and Music Management returned HTTP 200. All 19 served release files matched the clean build. Browser checks recorded zero console errors, failed assets, or legacy visual requests. Two separate browser contexts played concurrently. |
| Broadcast and pacing | Now Playing stayed online. Direct Icecast and public Funnel each delivered a continuous 90-second, decodable MP3 sample across the static release cutover. Their steady rates were 1.000016× and 1.001640× real time respectively. |
| Access boundaries | Sampled public Admin paths returned 404. The private Admin page responded, unauthenticated private API requests returned 401, and backend health returned 204. The private Admin backend matched the release. Its frontend retained an older shared visual bundle, with equivalent Admin route logic and styles in the comparison. |
| Physical iPhone | The operator reported two ten-minute Wi-Fi listening passes. An authorized iPhone upload became media ID 9 and aired naturally at 16:25:15 Asia/Amman, song history ID 1853. The public audio matched the test source. |

[Reproduction commands and phone procedure](testing.md) · [Observed challenges and fixes](challenges.md)

## Hosting and playback limits

This assessment demo is hosted on the operator's Windows laptop under Ubuntu WSL2. It is available while the host stays awake and online and Docker, Caddy, and Tailscale remain active. Each browser buffers independently, so the same track can be heard at slightly different times across branches. Long-term availability, unattended recovery, and sustained listener capacity would need validation on a dedicated host. [Current architecture](architecture.md) · [Proposed Linux VPS deployment](../deploy/production/README.md)

## Project documentation

- [Technical architecture and trust boundaries](architecture.md)
- [Testing and acceptance evidence](testing.md)
- [AI use and genuine prompt excerpts](ai-usage.md)
- [Engineering challenges and lessons](challenges.md)
- [Public hosting runbook](../deploy/demo/README.md)
- [Private Admin runbook](../deploy/admin/README.md)
