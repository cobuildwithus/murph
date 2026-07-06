#!/usr/bin/env bash
set -euo pipefail

default_memory_cap_bytes=6000000000
calibrated_passing_peak_bytes=5340000000
calibrated_failing_peak_bytes=6180000000
memory_cap_bytes="${MURPH_HOSTED_WEB_BUILD_MEMORY_CAP_BYTES:-$default_memory_cap_bytes}"
mode="${MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD_MODE:-enforce}"

fail() {
  printf '[apps/web build memory guard] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: apps/web/scripts/build-memory-guard.sh -- <command> [args...]

Runs a hosted-web production build command under a cgroup-v2 hard memory cap.
Set MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD_MODE=passthrough only for local
non-CI wrapper validation on hosts without Linux cgroups.
EOF
  exit 2
}

format_decimal_gb() {
  awk -v bytes="$1" 'BEGIN { printf "%.2f", bytes / 1000000000 }'
}

if [[ "${1:-}" != "--" ]]; then
  usage
fi
shift

if [[ "$#" -eq 0 ]]; then
  usage
fi

command_args=("$@")

if [[ ! "$memory_cap_bytes" =~ ^[0-9]+$ ]]; then
  fail "MURPH_HOSTED_WEB_BUILD_MEMORY_CAP_BYTES must be an integer byte count."
fi

if (( memory_cap_bytes <= calibrated_passing_peak_bytes || memory_cap_bytes >= calibrated_failing_peak_bytes )); then
  fail "memory cap ${memory_cap_bytes} must stay between the calibrated passing peak (${calibrated_passing_peak_bytes}) and failing peak (${calibrated_failing_peak_bytes})."
fi

if [[ "$mode" == "passthrough" ]]; then
  if [[ -n "${CI:-}" ]]; then
    fail "passthrough mode is disabled in CI; the memory guard must enforce the cgroup cap there."
  fi

  printf '[apps/web build memory guard] local passthrough mode: running without cgroup cap; command=%q' "${command_args[0]}" >&2
  for arg in "${command_args[@]:1}"; do
    printf ' %q' "$arg" >&2
  done
  printf '\n' >&2
  exec "${command_args[@]}"
fi

if [[ "$mode" != "enforce" ]]; then
  fail "unsupported MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD_MODE=${mode}; expected enforce or passthrough."
fi

cgroup_root=/sys/fs/cgroup
cgroup_controllers_file="$cgroup_root/cgroup.controllers"
cgroup_subtree_control_file="$cgroup_root/cgroup.subtree_control"
cgroup_dir=""
cgroup_created=0

cleanup_cgroup() {
  local status="$1"
  local cleanup_output
  local cleanup_status

  if [[ "$cgroup_created" != "1" || -z "$cgroup_dir" ]]; then
    return 0
  fi

  set +e
  cleanup_output="$(sudo -n rmdir "$cgroup_dir" 2>&1)"
  cleanup_status=$?

  if [[ "$cleanup_status" -ne 0 ]]; then
    if [[ -n "$cleanup_output" ]]; then
      printf '[apps/web build memory guard] warning: could not remove %s; it may still contain descendant build processes: %s\n' "$cgroup_dir" "$cleanup_output" >&2
    else
      printf '[apps/web build memory guard] warning: could not remove %s; it may still contain descendant build processes.\n' "$cgroup_dir" >&2
    fi
  fi

  return "$status"
}

write_cgroup_file() {
  local value="$1"
  local file_path="$2"
  local label="$3"

  if ! printf '%s\n' "$value" | sudo -n tee "$file_path" >/dev/null; then
    fail "could not write ${label} at ${file_path}; cannot enforce the hosted-web build memory cap."
  fi
}

report_cgroup_memory() {
  local wrapped_status="$1"
  local peak_bytes
  local peak_gb
  local cap_gb
  local memory_events
  local oom_kill_count=""

  if [[ ! -r "$memory_peak_file" ]]; then
    printf '[apps/web build memory guard] ERROR: cannot read %s; memory peak accounting is unavailable.\n' "$memory_peak_file" >&2
    return 1
  fi

  if ! peak_bytes="$(cat "$memory_peak_file")"; then
    printf '[apps/web build memory guard] ERROR: failed to read %s; memory peak accounting is unavailable.\n' "$memory_peak_file" >&2
    return 1
  fi

  peak_gb="$(format_decimal_gb "$peak_bytes")"
  cap_gb="$(format_decimal_gb "$memory_cap_bytes")"
  printf '[apps/web build memory guard] cgroup memory.peak=%s bytes (%s GB), cap=%s bytes (%s GB)\n' \
    "$peak_bytes" \
    "$peak_gb" \
    "$memory_cap_bytes" \
    "$cap_gb" >&2

  if [[ -r "$memory_events_file" ]]; then
    memory_events="$(tr "\n" " " < "$memory_events_file" | sed "s/[[:space:]]*$//")"
    oom_kill_count="$(awk '$1 == "oom_kill" { print $2 }' "$memory_events_file")"
    printf '[apps/web build memory guard] cgroup memory.events: %s\n' "$memory_events" >&2
  fi

  if [[ -n "$oom_kill_count" && "$oom_kill_count" -gt 0 ]]; then
    printf '[apps/web build memory guard] cgroup cap breach: memory.events oom_kill=%s; failing the guard regardless of build exit status.\n' "$oom_kill_count" >&2
    return 1
  fi

  if [[ "$wrapped_status" -ne 0 ]]; then
    if [[ -n "$oom_kill_count" ]]; then
      printf '[apps/web build memory guard] wrapped command exited with status %s; exit 137 usually means the cgroup cap OOM-killed the build (memory.events oom_kill=%s).\n' "$wrapped_status" "$oom_kill_count" >&2
    else
      printf '[apps/web build memory guard] wrapped command exited with status %s; exit 137 usually means the cgroup cap OOM-killed the build.\n' "$wrapped_status" >&2
    fi
  fi

  return 0
}

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "enforce mode requires Linux cgroup v2. Use passthrough mode only for local non-CI wrapper validation."
fi

if [[ ! -f "$cgroup_controllers_file" ]]; then
  fail "cgroup v2 is not mounted at /sys/fs/cgroup; cannot enforce the hosted-web build memory cap."
fi

if ! grep -qw memory "$cgroup_subtree_control_file"; then
  fail "the root cgroup subtree_control does not enable the memory controller; cannot create a root-level capped child cgroup."
fi

command -v sudo >/dev/null 2>&1 || fail "sudo is required to configure the capped cgroup."

if ! sudo -n true >/dev/null 2>&1; then
  fail "passwordless sudo is required to configure the capped cgroup."
fi

printf '[apps/web build memory guard] enforcing cgroup cap %s bytes (%s GB); calibrated pass=%s GB, fail=%s GB\n' \
  "$memory_cap_bytes" \
  "$(format_decimal_gb "$memory_cap_bytes")" \
  "$(format_decimal_gb "$calibrated_passing_peak_bytes")" \
  "$(format_decimal_gb "$calibrated_failing_peak_bytes")" >&2

cgroup_dir="$cgroup_root/murph-web-build-$$"
memory_peak_file="$cgroup_dir/memory.peak"
memory_events_file="$cgroup_dir/memory.events"
trap 'status=$?; cleanup_cgroup "$status"; exit "$status"' EXIT

if ! sudo -n mkdir "$cgroup_dir"; then
  fail "could not create cgroup ${cgroup_dir}; a prior run may still be present or sudo lacks permission."
fi
cgroup_created=1

write_cgroup_file "$memory_cap_bytes" "$cgroup_dir/memory.max" "memory.max"
write_cgroup_file 0 "$cgroup_dir/memory.swap.max" "memory.swap.max"
write_cgroup_file 1 "$cgroup_dir/memory.oom.group" "memory.oom.group"

if [[ ! -r "$memory_peak_file" ]]; then
  fail "cannot read ${memory_peak_file}; memory peak accounting is unavailable."
fi

status=0
(
  # In bash, $$ remains the top-level shell PID inside this subshell. BASHPID is
  # the process that will exec the build, so migrating it caps the build tree.
  if ! printf '%s\n' "$BASHPID" | sudo -n tee "$cgroup_dir/cgroup.procs" >/dev/null; then
    printf '[apps/web build memory guard] ERROR: could not move the build process into %s.\n' "$cgroup_dir" >&2
    exit 1
  fi

  exec "${command_args[@]}"
) || status=$?

report_failed=0
report_cgroup_memory "$status" || report_failed=1
if [[ "$report_failed" -ne 0 && "$status" -eq 0 ]]; then
  status=1
fi

exit "$status"
