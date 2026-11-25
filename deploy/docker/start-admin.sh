#!/bin/sh
set -eu

operator_file=/run/secrets/ghmaas_operator
if [ ! -r "$operator_file" ] || [ "$(stat -c '%a:%u' "$operator_file")" != "600:$(id -u)" ]; then
  echo 'Admin needs a mode-600 backend/.env owned by the runtime UID. See deploy/docker/README.md.' >&2
  exit 1
fi

exec node --env-file="$operator_file" "$@"
