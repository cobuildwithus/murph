#!/usr/bin/env bash
# Installs the Chromium build used by browser-driving CI lanes.
#
# Download independently of APT and prove the existing runtime first. Missing
# native libraries still use Playwright's dependency installer, with retry and
# inactivity bounds at APT's own boundary and the existing CI step ceiling.
set -euo pipefail

probe_browser_runtime() {
  xvfb-run --auto-servernum pnpm --dir apps/web exec node --input-type=module -e '
    import { chromium } from "@playwright/test";
    for (const headless of [true, false]) {
      const browser = await chromium.launch({ headless });
      await browser.close();
    }
  '
}

pnpm --dir apps/web exec playwright install chromium
if probe_browser_runtime; then
  exit 0
fi

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

pnpm --dir apps/web exec playwright install-deps chromium
probe_browser_runtime
