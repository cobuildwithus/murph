import assert from "node:assert/strict";
import { test } from "vitest";

import * as rootExports from "../src/index.ts";
import * as publicIngressExports from "../src/public-ingress.ts";

test("device-sync root export stays daemon-oriented", () => {
  assert.equal(typeof rootExports.createDeviceSyncService, "function");
  assert.equal("createDeviceSyncPublicIngress" in rootExports, false);
  assert.equal("toIsoTimestamp" in rootExports, false);
});

test("public-ingress export omits generic timestamp helpers", () => {
  assert.equal(typeof publicIngressExports.createDeviceSyncPublicIngress, "function");
  assert.equal(typeof publicIngressExports.sanitizeStoredDeviceSyncMetadata, "function");
  assert.equal("toIsoTimestamp" in publicIngressExports, false);
});
