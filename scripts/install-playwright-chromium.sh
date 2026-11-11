#!/usr/bin/env bash
# Installs the Chromium build used by browser-driving CI lanes.
#
# Playwright's `--with-deps` path owns `apt-get update` and `apt-get install`
# behind `sudo`. Configure retry and inactivity bounds at that native owner so
# one transient mirror stall can recover without restarting or supervising the
# privileged process tree. GitHub's step timeout remains the overall ceiling.
set -euo pipefail

# Playwright downloads its own Chromium. Remove the runner's unused Chrome apt
# source before installing the required Ubuntu libraries and fonts.
sudo rm -f /etc/apt/sources.list.d/google-chrome.sources

# Load after the GitHub runner image's zz-retries defaults.
readonly APT_POLICY_PATH="/etc/apt/apt.conf.d/zzzz-murph-playwright"
readonly APT_RETRIES=1
readonly APT_TIMEOUT_SECONDS=180

sudo tee "$APT_POLICY_PATH" > /dev/null <<EOF
Acquire::Retries "$APT_RETRIES";
Acquire::http::Timeout "$APT_TIMEOUT_SECONDS";
Acquire::https::Timeout "$APT_TIMEOUT_SECONDS";
EOF

if pnpm --dir apps/web exec playwright install --with-deps chromium; then
  exit 0
fi

# An unavailable Ubuntu mirror need not block runners that already have the
# browser libraries. Prove both browser modes before accepting that fallback;
# the callers still run their normal rendering and hydration checks afterward.
echo "Dependency installation failed; checking the installed browser runtime." >&2
pnpm --dir apps/web exec playwright install chromium
exec xvfb-run --auto-servernum pnpm --dir apps/web exec node --input-type=module -e '
  import { chromium } from "@playwright/test";
  for (const headless of [true, false]) {
    const browser = await chromium.launch({ headless });
    await browser.close();
  }
'
