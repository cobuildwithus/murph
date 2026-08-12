import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("stale launch-document versions do not stop historically authorized device access", () => {
  const nonblockingDevicePaths = [
    "src/lib/device-sync/hosted-connect-start.ts",
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

  // The companion admission and sign-in-token routes delegate admission —
  // including the historical launch-consent assert — to the shared companion
  // member-access owner, so the tripwire holds on each delegation and the
  // owner.
  const companionAdmissionPaths = [
    "app/api/device-sync/companion/admission/route.ts",
    "app/api/device-sync/companion/sign-in-token/route.ts",
  ];
  for (const relativePath of companionAdmissionPaths) {
    const source = readSource(relativePath);
    assert.doesNotMatch(
      source,
      /assertHostedLaunchRequiredConsentGranted/u,
      `${relativePath} must remain available when launch-document acceptance is stale`,
    );
    assert.match(
      source,
      /requireHostedCompanionMemberIdFromRequest/u,
      `${relativePath} must admit members through the companion member-access owner`,
    );
  }
  const companionAccessSource = readSource(
    "src/lib/hosted-onboarding/companion-member-access.ts",
  );
  assert.doesNotMatch(
    companionAccessSource,
    /assertHostedLaunchRequiredConsentGranted/u,
    "companion member access must remain available when launch-document acceptance is stale",
  );
  assert.match(
    companionAccessSource,
    /assertHostedHistoricalLaunchConsentGranted/u,
    "companion member access must retain historical launch authorization",
  );

  const connectStartSource = readSource("src/lib/device-sync/hosted-connect-start.ts");
  assert.match(connectStartSource, /requireActiveHostedAppSessionFromRequest/u);
  assert.match(connectStartSource, /assertHostedOnboardingMutationOrigin/u);
  assert.match(connectStartSource, /assertHostedWhoopConnectCapacityAvailable/u);
});

test("stale launch-document versions do not stop chat-adjacent companion actions", () => {
  // These surfaces have no consent UI of their own, so they accept historical
  // launch grants; members with no grant at all still fail closed.
  const nonblockingCompanionPaths = [
    "src/lib/device-sync/meal-photo-capture.ts",
    "app/api/device-sync/companion/imessage-mini-app/proof-action/route.ts",
  ];

  for (const relativePath of nonblockingCompanionPaths) {
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

  // Reaction joins relax to the historical assert while web joins keep the
  // current-version gate; both live in group-store, so assert the branch.
  const groupStoreSource = readSource("src/lib/hosted-groups/group-store.ts");
  assert.match(
    groupStoreSource,
    /joinOrigin === "group_chat_reaction"[\s\S]{0,200}assertHostedHistoricalLaunchConsentGranted/u,
    "reaction joins must accept historical launch consent",
  );
  assert.match(
    groupStoreSource,
    /\} else \{\s*await assertHostedLaunchRequiredConsentGranted\(\{ memberId: input\.memberId/u,
    "web joins must keep requiring current launch consent",
  );
});

test("Strava and modern Dexcom stay disabled as provider product gates", () => {
  const targetSource = readSource(
    "../../packages/device-syncd/src/config/connect-targets.ts",
  );

  assert.match(
    targetSource,
    /DISABLED_DEVICE_CONNECT_SOURCE_IDS = new Set\(\["strava", "dexcom"\]\)/u,
  );
  assert.match(
    targetSource,
    /!DISABLED_DEVICE_CONNECT_SOURCE_IDS\.has\(normalized\)/u,
  );
});
