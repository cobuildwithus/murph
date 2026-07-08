#!/usr/bin/env bash
set -euo pipefail

default_advisory_budget_bytes=7200000000
vercel_standard_machine_bytes=8000000000
known_false_positive_floor_bytes=6000000000
machine_model_ceiling_bytes=7200000000
advisory_budget_bytes="${MURPH_HOSTED_WEB_BUILD_MEMORY_CAP_BYTES:-$default_advisory_budget_bytes}"
mode="${MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD_MODE:-observe}"

fail() {
  printf '[apps/web build memory guard] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: apps/web/scripts/build-memory-guard.sh -- <command> [args...]

Runs a hosted-web production build command inside a measured cgroup-v2 scope.
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

if [[ ! "$advisory_budget_bytes" =~ ^[0-9]+$ ]]; then
  fail "MURPH_HOSTED_WEB_BUILD_MEMORY_CAP_BYTES must be an integer byte count."
fi

if (( advisory_budget_bytes <= known_false_positive_floor_bytes || advisory_budget_bytes > machine_model_ceiling_bytes )); then
  fail "advisory memory budget ${advisory_budget_bytes} must model cgroup-accounted bytes for an 8 GB Vercel Standard build machine: greater than the known false-positive 6.0 GB cgroup floor (${known_false_positive_floor_bytes}) and no more than ${machine_model_ceiling_bytes} bytes so at least 0.8 GB remains reserved outside the build cgroup."
fi

if [[ "$mode" == "passthrough" ]]; then
  if [[ -n "${CI:-}" ]]; then
    fail "passthrough mode is disabled in CI; the memory guard must observe measured cgroup accounting there."
  fi

  printf '[apps/web build memory guard] local passthrough mode: running without measured cgroup accounting; command=%q' "${command_args[0]}" >&2
  for arg in "${command_args[@]:1}"; do
    printf ' %q' "$arg" >&2
  done
  printf '\n' >&2
  exec "${command_args[@]}"
fi

if [[ "$mode" != "observe" ]]; then
  fail "unsupported MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD_MODE=${mode}; expected observe or passthrough."
fi

cgroup_root=/sys/fs/cgroup
cgroup_controllers_file="$cgroup_root/cgroup.controllers"
cgroup_subtree_control_file="$cgroup_root/cgroup.subtree_control"
cgroup_dir=""
cgroup_created=0
sampler_pid=""
sampler_state_file=""

cleanup_sampler() {
  local status="$1"

  if [[ -n "${sampler_pid:-}" ]]; then
    kill "$sampler_pid" 2>/dev/null || true
    wait "$sampler_pid" 2>/dev/null || true
    sampler_pid=""
  fi

  if [[ -n "${sampler_state_file:-}" ]]; then
    rm -f "$sampler_state_file" 2>/dev/null || true
    rm -f "${sampler_state_file}.next" 2>/dev/null || true
  fi

  return "$status"
}

cleanup_cgroup() {
  local status="$1"
  local cleanup_output
  local cleanup_status
  local cleanup_attempt

  cleanup_sampler "$status" || true

  if [[ "$cgroup_created" != "1" || -z "$cgroup_dir" ]]; then
    return 0
  fi

  set +e
  for cleanup_attempt in 1 2 3 4 5; do
    cleanup_output="$(sudo -n rmdir "$cgroup_dir" 2>&1)"
    cleanup_status=$?
    if [[ "$cleanup_status" -eq 0 ]]; then
      return "$status"
    fi

    if [[ "$cleanup_attempt" -lt 5 ]]; then
      sleep 0.2
    fi
  done

  if [[ "$cleanup_status" -ne 0 ]]; then
    if [[ -n "$cleanup_output" ]]; then
      printf '[apps/web build memory guard] warning: could not remove %s; it may still contain descendant build processes: %s\n' "$cgroup_dir" "$cleanup_output" >&2
    else
      printf '[apps/web build memory guard] warning: could not remove %s; it may still contain descendant build processes.\n' "$cgroup_dir" >&2
    fi
  fi

  return "$status"
}

report_cgroup_memory() {
  local wrapped_status="$1"
  local sampled_max_anon_bytes="${2:-}"
  local peak_bytes
  local peak_gb
  local budget_gb
  local memory_events
  local memory_stat
  local oom_kill_count=""
  local sampled_max_anon_display="unavailable"
  local sampled_max_anon_gb="unavailable"

  if [[ ! -r "$memory_peak_file" ]]; then
    printf '[apps/web build memory guard] ERROR: cannot read %s; memory peak accounting is unavailable.\n' "$memory_peak_file" >&2
    return 1
  fi

  if ! peak_bytes="$(cat "$memory_peak_file")"; then
    printf '[apps/web build memory guard] ERROR: failed to read %s; memory peak accounting is unavailable.\n' "$memory_peak_file" >&2
    return 1
  fi
  if [[ ! "$peak_bytes" =~ ^[0-9]+$ ]]; then
    printf '[apps/web build memory guard] ERROR: %s did not contain an integer byte count; memory peak accounting is unavailable.\n' "$memory_peak_file" >&2
    return 1
  fi

  peak_gb="$(format_decimal_gb "$peak_bytes")"
  budget_gb="$(format_decimal_gb "$advisory_budget_bytes")"
  printf '[apps/web build memory guard] cgroup memory.peak=%s bytes (%s GB), advisory budget=%s bytes (%s GB)\n' \
    "$peak_bytes" \
    "$peak_gb" \
    "$advisory_budget_bytes" \
    "$budget_gb" >&2

  if [[ -r "$memory_events_file" ]]; then
    memory_events="$(tr "\n" " " < "$memory_events_file" | sed "s/[[:space:]]*$//")"
    oom_kill_count="$(awk '$1 == "oom_kill" { print $2 }' "$memory_events_file")"
    printf '[apps/web build memory guard] cgroup memory.events: %s\n' "$memory_events" >&2
  fi

  if [[ -r "$memory_stat_file" ]]; then
    memory_stat="$(awk '
      $1 == "anon" || $1 == "file" || $1 == "file_dirty" || $1 == "file_writeback" || $1 == "slab" || $1 == "kernel_stack" {
        value[$1] = $2
      }
      END {
        key_count = split("anon file file_dirty file_writeback slab kernel_stack", keys, " ")
        for (i = 1; i <= key_count; i++) {
          key = keys[i]
          if (key in value) {
            printf "%s%s=%s", seen ? " " : "", key, value[key]
            seen = 1
          }
        }
      }
    ' "$memory_stat_file")"
    if [[ -n "$memory_stat" ]]; then
      printf '[apps/web build memory guard] cgroup memory.stat: %s\n' "$memory_stat" >&2
    fi
  fi

  if [[ "$sampled_max_anon_bytes" =~ ^[0-9]+$ ]]; then
    sampled_max_anon_display="${sampled_max_anon_bytes} bytes"
    sampled_max_anon_gb="$(format_decimal_gb "$sampled_max_anon_bytes") GB"
  fi

  if (( peak_bytes > advisory_budget_bytes )) || [[ "$sampled_max_anon_bytes" =~ ^[0-9]+$ && "$sampled_max_anon_bytes" -gt "$advisory_budget_bytes" ]]; then
    printf '[apps/web build memory guard] WARNING: build memory WOULD EXCEED the 8GB Vercel Standard machine model.\n' >&2
    printf '[apps/web build memory guard] WARNING: anon max %s (%s) and memory.peak %s bytes (%s GB) vs advisory budget %s bytes (%s GB).\n' \
      "$sampled_max_anon_display" \
      "$sampled_max_anon_gb" \
      "$peak_bytes" \
      "$peak_gb" \
      "$advisory_budget_bytes" \
      "$budget_gb" >&2
    printf '[apps/web build memory guard] WARNING: enforcement is deferred pending cold-build memory optimization.\n' >&2
  fi

  if [[ "$wrapped_status" -ne 0 ]]; then
    if [[ "$oom_kill_count" =~ ^[0-9]+$ && "$oom_kill_count" -gt 0 ]]; then
      printf '[apps/web build memory guard] wrapped command exited with status %s; memory.events oom_kill=%s was observed in the accounting cgroup.\n' "$wrapped_status" "$oom_kill_count" >&2
    else
      printf '[apps/web build memory guard] wrapped command exited with status %s.\n' "$wrapped_status" >&2
    fi
  fi

  return 0
}

sample_cgroup_memory() {
  local state_file="$1"
  local current_file="$2"
  local stat_file="$3"
  local current
  local stat_values
  local stat_key
  local stat_value
  local sample_count=0
  local max_current=0
  local max_anon=0
  local max_file=0
  local max_file_dirty=0
  local max_file_writeback=0
  local max_shmem=0
  local max_slab=0
  local anon=0
  local file=0
  local file_dirty=0
  local file_writeback=0
  local shmem=0
  local slab=0

  set +e
  while [[ -r "$current_file" ]]; do
    if ! current="$(cat "$current_file" 2>/dev/null)"; then
      break
    fi
    if [[ ! "$current" =~ ^[0-9]+$ ]]; then
      break
    fi

    if [[ ! -r "$stat_file" ]]; then
      break
    fi
    if ! stat_values="$(awk '
      $1 == "anon" || $1 == "file" || $1 == "file_dirty" || $1 == "file_writeback" || $1 == "shmem" || $1 == "slab" {
        print $1 "=" $2
      }
    ' "$stat_file" 2>/dev/null)"; then
      break
    fi

    anon=0
    file=0
    file_dirty=0
    file_writeback=0
    shmem=0
    slab=0
    while IFS='=' read -r stat_key stat_value; do
      if [[ -z "$stat_key" || ! "$stat_value" =~ ^[0-9]+$ ]]; then
        continue
      fi
      case "$stat_key" in
        anon) anon="$stat_value" ;;
        file) file="$stat_value" ;;
        file_dirty) file_dirty="$stat_value" ;;
        file_writeback) file_writeback="$stat_value" ;;
        shmem) shmem="$stat_value" ;;
        slab) slab="$stat_value" ;;
      esac
    done <<<"$stat_values"

    (( current > max_current )) && max_current="$current"
    (( anon > max_anon )) && max_anon="$anon"
    (( file > max_file )) && max_file="$file"
    (( file_dirty > max_file_dirty )) && max_file_dirty="$file_dirty"
    (( file_writeback > max_file_writeback )) && max_file_writeback="$file_writeback"
    (( shmem > max_shmem )) && max_shmem="$shmem"
    (( slab > max_slab )) && max_slab="$slab"

    printf 'current=%s anon=%s file=%s file_dirty=%s file_writeback=%s shmem=%s slab=%s\n' \
      "$max_current" \
      "$max_anon" \
      "$max_file" \
      "$max_file_dirty" \
      "$max_file_writeback" \
      "$max_shmem" \
      "$max_slab" > "${state_file}.next" 2>/dev/null && mv "${state_file}.next" "$state_file" 2>/dev/null || true

    sample_count=$((sample_count + 1))
    if (( sample_count % 5 == 0 )); then
      printf '[apps/web build memory guard] sample: current=%s anon=%s file=%s file_dirty=%s file_writeback=%s shmem=%s slab=%s\n' \
        "$current" \
        "$anon" \
        "$file" \
        "$file_dirty" \
        "$file_writeback" \
        "$shmem" \
        "$slab" >&2
    fi

    sleep 3
  done
}

report_sampled_maxima() {
  local state_file="$1"
  local sampled_maxima
  sampled_max_anon_bytes=""

  if [[ -n "$state_file" && -r "$state_file" ]]; then
    sampled_maxima="$(cat "$state_file" 2>/dev/null || true)"
    if [[ -n "$sampled_maxima" ]]; then
      printf '[apps/web build memory guard] sampled maxima: %s\n' "$sampled_maxima" >&2
      sampled_max_anon_bytes="$(awk '
        {
          for (i = 1; i <= NF; i++) {
            split($i, kv, "=")
            if (kv[1] == "anon") {
              print kv[2]
              exit
            }
          }
        }
      ' <<<"$sampled_maxima")"
    fi
  fi
}

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "observe mode requires Linux cgroup v2. Use passthrough mode only for local non-CI wrapper validation."
fi

if [[ ! -f "$cgroup_controllers_file" ]]; then
  fail "cgroup v2 is not mounted at /sys/fs/cgroup; cannot observe hosted-web build memory."
fi

if ! grep -qw memory "$cgroup_subtree_control_file"; then
  fail "the root cgroup subtree_control does not enable the memory controller; cannot create a root-level measured child cgroup."
fi

command -v sudo >/dev/null 2>&1 || fail "sudo is required to configure the measured cgroup."

if ! sudo -n true >/dev/null 2>&1; then
  fail "passwordless sudo is required to configure the measured cgroup."
fi

memory_reserve_bytes=$((vercel_standard_machine_bytes - advisory_budget_bytes))
printf '[apps/web build memory guard] observing cgroup memory with advisory machine-model budget %s bytes (%s GB) for Vercel Standard machine=%s bytes (%s GB), modeled reserve outside build cgroup=%s bytes (%s GB); allowed advisory range: >%s bytes and <=%s bytes\n' \
  "$advisory_budget_bytes" \
  "$(format_decimal_gb "$advisory_budget_bytes")" \
  "$vercel_standard_machine_bytes" \
  "$(format_decimal_gb "$vercel_standard_machine_bytes")" \
  "$memory_reserve_bytes" \
  "$(format_decimal_gb "$memory_reserve_bytes")" \
  "$known_false_positive_floor_bytes" \
  "$machine_model_ceiling_bytes" >&2

cgroup_dir="$cgroup_root/murph-web-build-$$"
memory_current_file="$cgroup_dir/memory.current"
memory_peak_file="$cgroup_dir/memory.peak"
memory_events_file="$cgroup_dir/memory.events"
memory_stat_file="$cgroup_dir/memory.stat"
trap 'status=$?; cleanup_cgroup "$status"; exit "$status"' EXIT

if ! sudo -n mkdir "$cgroup_dir"; then
  fail "could not create cgroup ${cgroup_dir}; a prior run may still be present or sudo lacks permission."
fi
cgroup_created=1

if [[ ! -r "$memory_peak_file" ]]; then
  fail "cannot read ${memory_peak_file}; memory peak accounting is unavailable."
fi

if sampler_state_file="$(mktemp "${TMPDIR:-/tmp}/murph-web-build-memory-samples.XXXXXX" 2>/dev/null)"; then
  sample_cgroup_memory "$sampler_state_file" "$memory_current_file" "$memory_stat_file" &
  sampler_pid=$!
else
  printf '[apps/web build memory guard] warning: sampler disabled: could not create state file\n' >&2
  sampler_state_file=""
fi

status=0
(
  # In bash, $$ remains the top-level shell PID inside this subshell, and BASHPID
  # is the live process that will exec the build. Capture it before invoking a
  # helper: BASHPID is dynamic, so a pipeline producer or redirection helper can
  # otherwise expand to its own short-lived PID.
  build_pid=$BASHPID
  if ! sudo -n tee "$cgroup_dir/cgroup.procs" >/dev/null <<<"$build_pid"; then
    printf '[apps/web build memory guard] ERROR: could not move the build process into %s.\n' "$cgroup_dir" >&2
    exit 1
  fi

  exec "${command_args[@]}"
) || status=$?

if [[ -n "${sampler_pid:-}" ]]; then
  kill "$sampler_pid" 2>/dev/null || true
  wait "$sampler_pid" 2>/dev/null || true
  sampler_pid=""
fi

report_failed=0
sampled_max_anon_bytes=""
if [[ -n "$sampler_state_file" ]]; then
  report_sampled_maxima "$sampler_state_file"
fi
report_cgroup_memory "$status" "$sampled_max_anon_bytes" || report_failed=1
if [[ "$report_failed" -ne 0 && "$status" -eq 0 ]]; then
  status=1
fi

exit "$status"
