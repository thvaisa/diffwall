#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  printf 'usage: %s IMAGE WORKSPACE [PORT]\n' "$0" >&2
  printf 'set CONTAINER_RUNTIME=apptainer or singularity to choose the runtime\n' >&2
  exit 2
fi

image=$1
workspace=$2
port=${3:-7777}
runtime=${CONTAINER_RUNTIME:-}

if [[ -z "$runtime" ]]; then
  if command -v apptainer >/dev/null 2>&1; then
    runtime=apptainer
  elif command -v singularity >/dev/null 2>&1; then
    runtime=singularity
  else
    printf 'neither apptainer nor singularity is installed\n' >&2
    exit 1
  fi
fi

if ! command -v "$runtime" >/dev/null 2>&1; then
  printf 'container runtime not found: %s\n' "$runtime" >&2
  exit 1
fi

workspace=$(realpath "$workspace")
if [[ ! -d "$workspace" ]]; then
  printf 'workspace is not a directory: %s\n' "$workspace" >&2
  exit 2
fi

exec "$runtime" run \
  --cleanenv \
  --containall \
  --bind "${workspace}:/workspace:ro" \
  "$image" \
  --port "$port"
