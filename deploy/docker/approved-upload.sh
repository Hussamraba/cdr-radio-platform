#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

if [[ $# != 2 || ( $1 != preflight && $1 != window ) || ! -f $2 ]]; then
  echo 'Usage: bash deploy/docker/approved-upload.sh {preflight|window} /absolute/path/to/music.mp3' >&2
  exit 2
fi
mode=$1
file=$2
verify=(docker compose exec -T backend node --env-file=/run/secrets/ghmaas_operator dist/verify.js)

check_backend_mode() {
  docker compose exec -T backend node --env-file=/run/secrets/ghmaas_operator --input-type=module -e '
    import { loadConfig } from "./dist/config.js";
    const [mode, digest, deadline] = process.argv.slice(1);
    const config = loadConfig(process.env);
    const window = config.uploadWindow;
    const correctMode = mode === "window"
      ? config.allowWrites && window?.sha256 === digest && window.expiresAt === Number(deadline) && window.expiresAt > Date.now()
      : !config.allowWrites && !window;
    const health = await fetch(new URL("/healthz", config.origin), { signal: AbortSignal.timeout(5000) });
    if (!correctMode || health.status !== 204) {
      console.error("Could not verify the private backend in " + mode + " mode.");
      process.exitCode = 1;
    }' "$@" < /dev/null
}

if [[ $mode == window ]]; then
  if ! { exec {terminal}<>/dev/tty; } 2>/dev/null; then
    echo 'Open the approved window from an interactive operator terminal.' >&2
    exit 1
  fi
  exec 9<backend/.env
  flock -n 9 || { echo 'Another approved upload window is in progress.' >&2; exit 1; }
  docker compose config --format json | node -e '
    const environment = JSON.parse(require("node:fs").readFileSync(0)).services.backend.environment;
    if (environment.ADMIN_MANAGEMENT_MODE !== "read-only" || environment.ADMIN_ALLOW_WRITES !== "false" || environment.ADMIN_APPROVED_UPLOAD_SHA256 || environment.ADMIN_WRITE_WINDOW_EXPIRES_AT) {
      console.error("Start with the saved Compose backend configuration in read-only mode.");
      process.exitCode = 1;
    }'
  check_backend_mode read-only
fi

evidence=$(mktemp -d "${TMPDIR:-/tmp}/ghmaas-upload.XXXXXXXX")
before=$evidence/before.json
filename=$(basename -- "$file")
size=$(stat -Lc %s -- "$file")
"${verify[@]}" --upload "$filename" "$size" < "$file" > "$before"
cat -- "$before"
printf 'Private evidence directory %s\n' "$evidence"
[[ $mode == window ]] || exit 0

digest=$(node -pe 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).upload.sha256' "$before")
printf '\nConfirm ownership or licensing and authorization for one upload and one addition to playlist 2.\n'
printf 'Type APPROVE %s ADD TO 2 to open the 20-minute window.\n' "$digest"
printf 'Approval > ' >&"$terminal"
IFS= read -r -u "$terminal" approval || { echo 'Approval input closed.' >&2; exit 1; }
[[ $approval == "APPROVE $digest ADD TO 2" ]] || { echo 'Approval did not match.' >&2; exit 1; }

"${verify[@]}" --snapshot < /dev/null > "$evidence/at-approval.json"
node -e '
  const read = path => JSON.parse(require("node:fs").readFileSync(path));
  const [before, current] = process.argv.slice(1).map(read);
  if (JSON.stringify(before.entries) !== JSON.stringify(current.entries)) {
    console.error("The rotation changed during approval. Run a fresh preflight.");
    process.exitCode = 1;
  }' "$before" "$evidence/at-approval.json"

activate=(docker compose up -d --no-deps --no-build --wait --wait-timeout 60 backend)
active=false
close_window() {
  {
    GHMAAS_ADMIN_MANAGEMENT_MODE=read-only GHMAAS_ADMIN_ALLOW_WRITES=false GHMAAS_APPROVED_UPLOAD_SHA256= GHMAAS_WRITE_WINDOW_EXPIRES_AT= "${activate[@]}" < /dev/null &&
      check_backend_mode read-only
  } >> "$evidence/cleanup.log" 2>&1 || return 1
  active=false
  echo 'WINDOW CLOSED. The private backend is healthy and verified read-only.' || :
}
warn_recovery() {
  cat > "$evidence/recovery.txt" <<'RECOVERY'
SECURITY WARNING: COULD NOT VERIFY READ-ONLY RESTORATION.
The backend still enforces the configured write deadline. After pending requests settle, run from the project directory:

GHMAAS_ADMIN_MANAGEMENT_MODE=read-only GHMAAS_ADMIN_ALLOW_WRITES=false GHMAAS_APPROVED_UPLOAD_SHA256= GHMAAS_WRITE_WINDOW_EXPIRES_AT= \
  docker compose up -d --no-deps --no-build --wait --wait-timeout 60 backend
docker compose exec -T backend node --env-file=/run/secrets/ghmaas_operator --input-type=module -e 'import {loadConfig} from "./dist/config.js"; const c=loadConfig(process.env); const r=await fetch(new URL("/healthz",c.origin),{signal:AbortSignal.timeout(5000)}); if(c.allowWrites||c.uploadWindow||r.status!==204)throw Error("Read-only state not verified"); console.log("Private backend healthy and read-only")'
RECOVERY
  cat -- "$evidence/recovery.txt" >&2 || :
  printf 'Cleanup details are in %s\n' "$evidence/cleanup.log" >&2 || :
}
cleanup() {
  local status=$?
  trap - EXIT
  trap '' HUP INT TERM PIPE
  if $active && ! close_window; then
    warn_recovery
    status=1
  fi
  exit "$status"
}
wait_for_close() {
  local remaining status line
  local expired=false
  local -a timeout=()
  while true; do
    if ! $expired; then
      remaining=$(( (deadline + 999) / 1000 - EPOCHSECONDS ))
      if (( remaining > 0 )); then
        timeout=(-t "$remaining")
      else
        expired=true
        timeout=()
        echo 'Write deadline reached. The server rejects new writes. Let any in-flight request finish, then type CLOSE.'
      fi
    fi
    printf 'Type CLOSE to finish > ' >&"$terminal"
    if IFS= read -r -u "$terminal" "${timeout[@]}" line; then
      if [[ $line == CLOSE ]]; then return 0; fi
      echo 'Input ignored. Type CLOSE on its own line when the upload and assignment have finished.'
    else
      status=$?
      if (( status > 128 && ${#timeout[@]} > 0 )); then continue; fi
      echo 'Terminal input closed. Restoring read-only mode.' >&2
      return 1
    fi
  done
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 141' PIPE

deadline=$(node -p 'Date.now() + 20 * 60_000')
active=true
GHMAAS_ADMIN_MANAGEMENT_MODE=read-only GHMAAS_ADMIN_ALLOW_WRITES=true GHMAAS_APPROVED_UPLOAD_SHA256="$digest" GHMAAS_WRITE_WINDOW_EXPIRES_AT="$deadline" "${activate[@]}" < /dev/null
check_backend_mode window "$digest" "$deadline"
printf '\nUPLOAD WINDOW ACTIVE\n\nApproved filename:\n%s\n\nApproved SHA-256:\n%s\n\n' "$filename" "$digest"
printf 'Allowed action:\nUpload exactly once and add to playlist 2.\n\n'
printf 'Sign in again on iPhone and open Upload Music.\nLeave this terminal running.\n'
printf 'Do not enter CLOSE until the iPhone upload and playlist assignment are complete.\n\n'
wait_for_close
close_window

after=$evidence/after.json
"${verify[@]}" --snapshot < /dev/null > "$after"
media=$evidence/media.json
docker compose exec -T backend node --env-file=/run/secrets/ghmaas_operator --input-type=module -e '
  import { createAzura } from "./dist/azuracast.js";
  import { loadConfig, station } from "./dist/config.js";
  const digest = process.argv[1];
  const config = loadConfig(process.env);
  const { total, rows } = await createAzura(config).listMedia(digest, 1);
  if (total === 0) console.log("null");
  else {
    if (total !== 1) throw Error("Could not uniquely identify the approved upload in the catalog.");
    const [track] = rows;
    const url = new URL("/api/station/" + station.id + "/file/" + track.id, config.azuraOrigin);
    const response = await fetch(url, { headers: { "x-api-key": config.apiKey }, redirect: "error", signal: AbortSignal.timeout(config.upstreamMs) });
    if (!response.ok) throw Error("Could not read the approved media record.");
    const record = await response.json();
    if (record.id !== track.id || !record.path?.split("/").at(-1)?.startsWith("cdr-" + digest + "-")) {
      throw Error("The stored media path did not match the approved SHA-256.");
    }
    console.log(JSON.stringify({ id: track.id, assigned: track.playlists.some(item => item.id === station.playlist.id) }));
  }' "$digest" < /dev/null > "$media"
node -e '
  const read = path => JSON.parse(require("node:fs").readFileSync(path));
  const [before, after, media] = process.argv.slice(1).map(read);
  const identity = ({ id, entryId }) => [id, entryId];
  const expected = before.entries.map(identity);
  const existingOrder = JSON.stringify(expected) === JSON.stringify(after.entries.slice(0, expected.length).map(identity));
  const added = after.entries.slice(expected.length);
  const assigned = media?.assigned && added.length === 1 && added[0].id === media.id;
  console.log(media ? "File upload: Verified AzuraCast media ID " + media.id + " by its approved SHA-256 path." : "File upload: Approved media record not found in AzuraCast.");
  if (!existingOrder || added.length > 1 || Boolean(added.length) !== Boolean(assigned) || Boolean(media?.assigned) !== Boolean(assigned)) {
    console.error("Unexpected rotation change. Review the private snapshots before taking any further action.");
    process.exitCode = 1;
  } else if (assigned) {
    console.log("Playlist 2 assignment: Verified one appended entry for the approved file. Existing entries retain their order.");
  } else {
    console.log("Playlist 2 assignment: The rotation has no new entry.");
  }
  console.log("On-air playback of the approved file: NOT TESTED by this command.");' "$before" "$after" "$media"
node deploy/docker/smoke-test.mjs
