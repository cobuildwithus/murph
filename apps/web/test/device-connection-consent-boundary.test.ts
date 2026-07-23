import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("stale launch-document versions do not stop historically authorized device access", () => {
  const nonblockingDevicePaths = [
    "src/lib/device-sync/hosted-connect-start.ts",
    "app/api/device-sync/companion/sign-in-token/route.ts",
    "app/api/device-sync/companion/status/route.ts",
    "app/api/device-sync/companion/health-metadata/route.ts",
    "app/api/device-sync/companion/hrv-rmssd/route.ts",
  ];

  for (const relativePath of nonblockingDevicePaths) {
    assert.doesNotMatch(
      readSource(relativePath),
      /assertHostedLaunchRequiredConsentGranted/u,
      `${relativePath} must remain available when launch-document acceptance is stale`,
    );
    assert.match(
      readSource(relativePath),
      /assertHostedHistoricalLaunchConsentGranted/u,
      `${relativePath} must retain historical launch authorization`,
    );
  }

  const connectStartSource = readSource("src/lib/device-sync/hosted-connect-start.ts");
  assert.match(connectStartSource, /requireActiveHostedAppSessionFromRequest/u);
  assert.match(connectStartSource, /assertHostedOnboardingMutationOrigin/u);
  assert.match(connectStartSource, /assertHostedWhoopConnectCapacityAvailable/u);
});

test("Strava stays disabled as a separate provider product gate", () => {
  const targetSource = readSource(
    "../../packages/device-syncd/src/config/connect-targets.ts",
  );

  assert.match(
    targetSource,
    /DISABLED_DEVICE_CONNECT_SOURCE_IDS = new Set\(\["strava"\]\)/u,
  );
  assert.match(
    targetSource,
    /!DISABLED_DEVICE_CONNECT_SOURCE_IDS\.has\(normalized\)/u,
  );
});
