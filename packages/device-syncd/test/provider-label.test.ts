import assert from "node:assert/strict";

import { test } from "vitest";

import {
  formatDeviceSyncAccountLabel,
  formatDeviceSyncProviderLabel,
} from "../src/provider-label.ts";

test("formatDeviceSyncProviderLabel prefers the configured source label", () => {
  assert.equal(formatDeviceSyncProviderLabel("whoop"), "WHOOP");
});

test("formatDeviceSyncProviderLabel uses shared Junction source labels", () => {
  assert.equal(formatDeviceSyncProviderLabel("map_my_fitness"), "MapMyFitness");
  assert.equal(formatDeviceSyncProviderLabel("accuchek_ble"), "Accu-Chek");
  assert.equal(formatDeviceSyncProviderLabel("dexcom_v3"), "Dexcom");
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
