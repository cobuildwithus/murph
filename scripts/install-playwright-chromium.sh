#!/usr/bin/env bash
# Installs the Chromium build the browser-driving CI lanes need.
#
# `playwright install --with-deps` shells out to `apt-get`, which can stall on an
# unresponsive Ubuntu mirror while producing no output and no error. On
# 2026-08-19 that consumed the entire 20-minute job budget of Web Viewport
# Overflow: apt went silent after fetching `noble-security InRelease` and the job
# ceiling cancelled the run before a single test executed, while the identical
# install finished in 45 seconds on the next attempt.
#
# Bounding each attempt turns that open-ended stall into a retry, so a bad mirror
# costs one attempt window instead of the whole lane.
set -euo pipefail

ATTEMPTS="${MURPH_PLAYWRIGHT_INSTALL_ATTEMPTS:-3}"
ATTEMPT_TIMEOUT_SECONDS="${MURPH_PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS:-240}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_root"

run_install() {
  # `timeout` is coreutils, so it is always present on the CI runners but not on
  # a stock macOS checkout. Locally there is no apt to stall on, so running
  # unbounded there is the honest fallback rather than a hard failure.
  if command -v timeout > /dev/null 2>&1; then
    timeout --kill-after=30s "$ATTEMPT_TIMEOUT_SECONDS" \
      pnpm --dir apps/web exec playwright install --with-deps chromium
    return
  fi

  pnpm --dir apps/web exec playwright install --with-deps chromium
}

for attempt in $(seq 1 "$ATTEMPTS"); do
  set +e
  run_install
  status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    exit 0
  fi

  if [[ "$status" -eq 124 ]]; then
    reason="stalled for ${ATTEMPT_TIMEOUT_SECONDS}s"
  else
    reason="failed with exit ${status}"
  fi

  if [[ "$attempt" -ge "$ATTEMPTS" ]]; then
    echo "Playwright Chromium install ${reason} on attempt ${attempt}/${ATTEMPTS}; giving up." >&2
    exit "$status"
  fi

  echo "Playwright Chromium install ${reason} on attempt ${attempt}/${ATTEMPTS}; retrying." >&2
  sleep $((attempt * 10))
done
