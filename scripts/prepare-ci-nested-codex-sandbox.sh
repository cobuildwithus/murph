#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI:-}" != "true" ]]; then
  echo "Nested Codex sandbox host preparation is CI-only." >&2
  exit 1
fi

if sysctl kernel.apparmor_restrict_unprivileged_userns >/dev/null 2>&1; then
  sudo sysctl --write kernel.apparmor_restrict_unprivileged_userns=0
  test "$(sysctl --values kernel.apparmor_restrict_unprivileged_userns)" = "0"
fi

docker_config_path="$(mktemp)"
apparmor_profile_path="$(mktemp)"
trap 'rm -f -- "${docker_config_path}" "${apparmor_profile_path}"' EXIT
if sudo test -f /etc/docker/daemon.json; then
  sudo jq '. + {"seccomp-profile": "unconfined"}' \
    /etc/docker/daemon.json > "${docker_config_path}"
else
  jq --null-input '{"seccomp-profile": "unconfined"}' > "${docker_config_path}"
fi

sudo dockerd --validate --config-file "${docker_config_path}"
sudo install -m 0644 "${docker_config_path}" /etc/docker/daemon.json
sudo systemctl restart docker

# Wrangler/Miniflare does not expose Docker per-container security options.
# Replace Docker's generated outer profile only on this disposable Ubuntu 24.04
# CI host; the Codex profile inside the runner remains the permission boundary.
printf '%s\n' \
  'abi <abi/4.0>,' \
  'profile docker-default flags=(unconfined) {' \
  '  userns,' \
  '}' > "${apparmor_profile_path}"
sudo apparmor_parser -Q "${apparmor_profile_path}"
sudo apparmor_parser -r "${apparmor_profile_path}"
sudo grep -Fx 'docker-default (unconfined)' \
  /sys/kernel/security/apparmor/profiles
