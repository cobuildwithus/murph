import assert from "node:assert/strict";

import { test } from "vitest";

import {
  formatDeviceSyncAccountLabel,
  formatDeviceSyncProviderLabel,
  resolveJunctionConnectSourceLabel,
} from "../src/provider-label.ts";

test("formatDeviceSyncProviderLabel prefers the configured source label", () => {
  assert.equal(formatDeviceSyncProviderLabel("whoop"), "WHOOP");
});

test("formatDeviceSyncProviderLabel uses shared Junction source labels", () => {
  assert.equal(formatDeviceSyncProviderLabel("map_my_fitness"), "MapMyFitness");
  assert.equal(formatDeviceSyncProviderLabel("accuchek_ble"), "Accu-Chek");
  assert.equal(formatDeviceSyncProviderLabel("dexcom_v3"), "Dexcom");
  assert.equal(formatDeviceSyncProviderLabel("google_health"), "Fitbit");
  assert.equal(formatDeviceSyncProviderLabel("fitbit"), "Fitbit");
});

test("resolveJunctionConnectSourceLabel exposes only catalog-backed labels", () => {
  assert.equal(resolveJunctionConnectSourceLabel("accuchek_ble"), "Accu-Chek");
  assert.equal(resolveJunctionConnectSourceLabel("unknown_provider"), null);
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
