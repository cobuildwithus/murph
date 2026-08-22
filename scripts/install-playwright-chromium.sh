#!/usr/bin/env bash
# Installs the Chromium build used by browser-driving CI lanes.
#
# Playwright's `--with-deps` path owns `apt-get update` and `apt-get install`
# behind `sudo`. Configure retry and inactivity bounds at that native owner so
# one transient mirror stall can recover without restarting or supervising the
# privileged process tree. GitHub's step timeout remains the overall ceiling.
set -euo pipefail

readonly APT_POLICY_PATH="/etc/apt/apt.conf.d/99murph-playwright"
readonly APT_RETRIES=1
readonly APT_TIMEOUT_SECONDS=180

sudo tee "$APT_POLICY_PATH" > /dev/null <<EOF
Acquire::Retries "$APT_RETRIES";
Acquire::http::Timeout "$APT_TIMEOUT_SECONDS";
Acquire::https::Timeout "$APT_TIMEOUT_SECONDS";
EOF

# Fail before Playwright if the runner did not load the policy that its
# privileged apt subprocess will inherit.
apt_policy="$(apt-config dump)"
for expected in \
  "Acquire::Retries \"$APT_RETRIES\";" \
  "Acquire::http::Timeout \"$APT_TIMEOUT_SECONDS\";" \
  "Acquire::https::Timeout \"$APT_TIMEOUT_SECONDS\";"; do
  if ! grep -Fqx "$expected" <<< "$apt_policy"; then
    echo "Playwright apt policy was not loaded: $expected" >&2
    exit 1
  fi
done

exec pnpm --dir apps/web exec playwright install --with-deps chromium
