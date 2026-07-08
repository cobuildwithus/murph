import assert from "node:assert/strict";

import { test } from "vitest";

import {
  formatHostedDeviceSyncSourceLabel,
  resolveHostedDeviceSyncBrowserProviderLabel,
} from "@/src/lib/device-sync/provider-label";

test("hosted device sync labels Apple Health upstream source slugs", () => {
  assert.equal(formatHostedDeviceSyncSourceLabel("apple_health_kit"), "Apple Health");
  assert.equal(formatHostedDeviceSyncSourceLabel("apple_health"), "Apple Health");
  assert.equal(formatHostedDeviceSyncSourceLabel("apple-healthkit"), "Apple Health");
});

test("hosted device sync browser label uses Apple Health when it is the only source", () => {
  assert.equal(
    resolveHostedDeviceSyncBrowserProviderLabel({
      provider: "junction",
      upstreamSources: [
        {
          sourceProviderSlug: "apple_health_kit",
          status: "connected",
        },
      ],
    }),
    "Apple Health",
  );
});
