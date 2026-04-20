import assert from "node:assert/strict";

import { test } from "vitest";

import {
  formatDeviceSyncAccountLabel,
  formatDeviceSyncProviderLabel,
} from "../src/provider-label.ts";

test("formatDeviceSyncProviderLabel prefers the registered descriptor display name", () => {
  assert.equal(formatDeviceSyncProviderLabel("whoop"), "WHOOP");
});

test("formatDeviceSyncProviderLabel title-cases unknown provider identifiers", () => {
  assert.equal(
    formatDeviceSyncProviderLabel("  custom_provider-name  "),
    "Custom Provider Name",
  );
});

test("formatDeviceSyncAccountLabel keeps account labels provider-scoped and opaque", () => {
  assert.equal(formatDeviceSyncAccountLabel("whoop", "whoop-user-1"), "WHOOP whoop-user-1");
  assert.equal(formatDeviceSyncAccountLabel("custom_provider", "acct-123"), "Custom Provider acct-123");
});
