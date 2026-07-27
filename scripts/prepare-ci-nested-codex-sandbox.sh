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
trap 'rm -f -- "${docker_config_path}"' EXIT
if sudo test -f /etc/docker/daemon.json; then
  sudo jq '. + {"seccomp-profile": "unconfined"}' \
    /etc/docker/daemon.json > "${docker_config_path}"
else
  jq --null-input '{"seccomp-profile": "unconfined"}' > "${docker_config_path}"
fi

sudo dockerd --validate --config-file "${docker_config_path}"
sudo install -m 0644 "${docker_config_path}" /etc/docker/daemon.json
sudo systemctl restart docker
