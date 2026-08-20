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
# Bounding each attempt turns that open-ended stall into a retry. The attempt is
# a process tree (pnpm -> Playwright -> the OS dependency installer), so the
# deadline signals the whole process group and this script refuses to start the
# next attempt until that group is gone: a surviving installer would still hold
# the package-manager lock the retry needs.
#
# Worst case is deliberately below the calling step's `timeout-minutes: 14`
# (840s), so the script always reports its own terminal status instead of being
# cancelled mid-report:
#   2 attempts x (300s deadline + 30s TERM grace + 5s KILL poll)
#     + 15s backoff = 685s.
# `install-playwright-chromium.test.ts` pins that arithmetic against every
# workflow that calls this script.
set -euo pipefail

ATTEMPTS="${MURPH_PLAYWRIGHT_INSTALL_ATTEMPTS:-2}"
ATTEMPT_TIMEOUT_SECONDS="${MURPH_PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS:-300}"
KILL_GRACE_SECONDS="${MURPH_PLAYWRIGHT_INSTALL_KILL_GRACE_SECONDS:-30}"
KILL_POLL_SECONDS="${MURPH_PLAYWRIGHT_INSTALL_KILL_POLL_SECONDS:-5}"
RETRY_BACKOFF_SECONDS="${MURPH_PLAYWRIGHT_INSTALL_BACKOFF_SECONDS:-15}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_root"

timeout_marker=""
active_install_group=""
active_watchdog_group=""

# Sends a signal to a whole process group and reports whether anything is left.
signal_group() {
  local signal="$1" group_pid="$2"
  # `set -m` makes the background install the leader of a new process group.
  # The negative id is therefore the exact owned tree, not an ambient process
  # matched by name or a sibling job on the runner.
  kill "-${signal}" -- "-${group_pid}" 2> /dev/null || true
}

group_alive() {
  kill -0 -- "-${1}" 2> /dev/null
}

stop_watchdog() {
  local watchdog_pid="$1" waited=0

  signal_group TERM "$watchdog_pid"
  wait "$watchdog_pid" 2> /dev/null || true
  while group_alive "$watchdog_pid"; do
    if ((waited >= KILL_POLL_SECONDS)); then
      signal_group KILL "$watchdog_pid"
      return
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

# Nothing an attempt started may outlive it. TERM first, then escalate, then
# report honestly rather than looping forever on an unkillable process.
reap_group() {
  local group_pid="$1" waited=0

  signal_group TERM "$group_pid"
  while group_alive "$group_pid"; do
    if ((waited >= KILL_GRACE_SECONDS)); then
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  if ! group_alive "$group_pid"; then
    return 0
  fi

  signal_group KILL "$group_pid"
  waited=0
  while group_alive "$group_pid"; do
    if ((waited >= KILL_POLL_SECONDS)); then
      echo "Playwright Chromium install left a process group that survived SIGKILL; not starting another attempt." >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM

  if [[ -n "$active_watchdog_group" ]]; then
    stop_watchdog "$active_watchdog_group"
  fi
  if [[ -n "$active_install_group" ]] && group_alive "$active_install_group"; then
    reap_group "$active_install_group" || true
  fi
  [[ -n "$timeout_marker" ]] && rm -f "$timeout_marker"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

run_attempt() {
  local group_pid watchdog_pid status

  timeout_marker="$(mktemp)"
  rm -f "$timeout_marker"

  # Job control puts the install in its own process group, so the deadline can
  # reach every descendant instead of only the pnpm leader. This needs no
  # coreutils `timeout` or `setsid`, which keeps the CI and local paths identical.
  set -m
  pnpm --dir apps/web exec playwright install --with-deps chromium &
  group_pid=$!
  active_install_group="$group_pid"

  (
    sleep "$ATTEMPT_TIMEOUT_SECONDS"
    touch "$timeout_marker"
    signal_group TERM "$group_pid"
    sleep "$KILL_GRACE_SECONDS"
    signal_group KILL "$group_pid"
  ) &
  watchdog_pid=$!
  active_watchdog_group="$watchdog_pid"
  set +m

  # `|| status=$?` keeps errexit intact: toggling `set -e` inside a function
  # would change it for the caller too, which silently exits the retry loop.
  status=0
  wait "$group_pid" || status=$?

  stop_watchdog "$watchdog_pid"
  active_watchdog_group=""

  if ! reap_group "$group_pid"; then
    return 125
  fi
  active_install_group=""

  if [[ -f "$timeout_marker" ]]; then
    rm -f "$timeout_marker"
    return 124
  fi

  return "$status"
}

for attempt in $(seq 1 "$ATTEMPTS"); do
  status=0
  run_attempt || status=$?

  if [[ "$status" -eq 0 ]]; then
    exit 0
  fi

  if [[ "$status" -eq 124 ]]; then
    reason="stalled for ${ATTEMPT_TIMEOUT_SECONDS}s"
  elif [[ "$status" -eq 125 ]]; then
    reason="could not be terminated cleanly"
  else
    reason="failed with exit ${status}"
  fi

  if [[ "$attempt" -ge "$ATTEMPTS" || "$status" -eq 125 ]]; then
    echo "Playwright Chromium install ${reason} on attempt ${attempt}/${ATTEMPTS}; giving up." >&2
    exit "$status"
  fi

  echo "Playwright Chromium install ${reason} on attempt ${attempt}/${ATTEMPTS}; retrying." >&2
  sleep "$RETRY_BACKOFF_SECONDS"
done
