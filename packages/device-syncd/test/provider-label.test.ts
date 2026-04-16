import assert from "node:assert/strict";

import { test } from "vitest";

import { formatDeviceSyncProviderLabel } from "../src/provider-label.ts";

test("formatDeviceSyncProviderLabel prefers the registered descriptor display name", () => {
  assert.equal(formatDeviceSyncProviderLabel("whoop"), "WHOOP");
});

test("formatDeviceSyncProviderLabel title-cases unknown provider identifiers", () => {
  assert.equal(
    formatDeviceSyncProviderLabel("  custom_provider-name  "),
    "Custom Provider Name",
  );
});
