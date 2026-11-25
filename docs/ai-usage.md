# AI use during development

Ghmaas Baladi Radio is a software implementation for the CDR Group assessment. The restaurant supplied its brand asset, and the operator defined the desired branch radio workflow and approved live operations.

## Tools used

| Tool | Recorded use |
| --- | --- |
| OpenAI Codex in the IDE | Inspected the existing project, implemented and revised React and Express code, added tests and runbooks, examined the installed AzuraCast integration, analyzed stream measurements, and prepared release checks and documentation. |
| OpenAI image generation via Codex | Generated an early broadcast studio backdrop during the frontend prototype. The release replaced that raster backdrop with an SVG composed of geometric shapes. |
| Kling AI | The operator supplied a Kling-generated MP4 for an intermediate dashboard design. The release excluded the clip and its source footage because redistribution terms were unverified. |

## Genuine prompt examples

These short excerpts are from the operator's original project briefs and Codex conversation records. Dates use Asia/Amman. The initial planning excerpt comes from the earliest available project brief on 22 November 2026.

| Stage and record | Prompt excerpt | How the work was checked |
| --- | --- | --- |
| Initial project planning, 22 November frontend brief | “The platform must eventually broadcast one centralized live radio stream to multiple restaurant branches.” | The design used one station and one MP3 mount. Two live browser sessions later played independently from that same stream. |
| Frontend development, 22 November frontend brief | “Do not scaffold a new app or replace the project blindly. Reuse and improve existing code where appropriate.” | Codex worked in the existing Vite project. Lint, public and private builds, and browser checks covered the released UI, including responsive artwork and reduced motion. |
| Streaming debugging, 25 November iPhone investigation | “Determine whether the source remains continuous while Funnel delivery becomes intermittent.” | Compared frame timing and connection continuity at the source, Icecast, Caddy, and the public Funnel, alongside the operator's phone observations. |
| WSL2 clock correction, 25 November source pacing investigation | “Measure audio samples produced per monotonic second.” | Counted decoded MP3 frames against `CLOCK_MONOTONIC_RAW` before and after a host timing intervention. [Measurements and follow-up](architecture.md#wsl2-audio-pacing) |
| Playlist assignment, 25 November read-only investigation | “Inspect playlist 2 membership, positions and weights.” | Checked fresh authenticated media and playlist reads and compared the entry IDs and weights with the baseline. An isolated backend test reproduced the tied-weight permutation. [False conflict investigation](challenges.md#playlist-verifier-false-http-409) |
| Security and release review, 25 November staging brief | “Inspect all staged filenames and file contents for embedded secrets or sensitive values.” | Used an explicit allowlist, scanned staged content, excluded private data and uncertain assets, and built the reviewed snapshot with its lockfiles. |

## Prompt structure and validation

The prompts typically gave Codex a role, the project and its verified state, a narrow change or investigation, operational constraints, and acceptance criteria. Live incidents started with observations and read-only checks. Later prompts authorized specific changes, such as an approved playlist append or a public static release, and specified the evidence required afterward.

The operator chose the demo hosting arrangement, supplied the branding and approved test media, enrolled the private Admin device, authorized live changes, and reported physical iPhone listening results. Codex assisted with code and diagnostics and ran automated checks. The fixture results come from test output, playlist findings from authenticated AzuraCast reads and history, and stream pacing from captured MP3 frames. The two physical iPhone Wi-Fi listening runs are operator-reported. [Testing and acceptance evidence](testing.md) · [Engineering challenges](challenges.md)
