#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  printf 'usage: %s IMAGE WORKSPACE [PORT]\n' "$0" >&2
  exit 2
fi

image=$1
workspace=$2
port=${3:-7777}

workspace=$(realpath "$workspace")
if [[ ! -d "$workspace" ]]; then
  printf 'workspace is not a directory: %s\n' "$workspace" >&2
  exit 2
fi

exec apptainer run \
  --cleanenv \
  --containall \
  --bind "${workspace}:/workspace:ro" \
  "$image" \
  --port "$port"
