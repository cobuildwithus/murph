import assert from "node:assert/strict";

import { test } from "vitest";

import { buildCallbackErrorRedirectLocation } from "../src/http.ts";

test("callback error redirects keep only safe machine-readable params", () => {
  const location = buildCallbackErrorRedirectLocation({
    returnTo: "https://app.healthybob.test/settings/devices?tab=wearables",
    provider: "demo",
    errorCode: "OAUTH_CALLBACK_REJECTED",
  });

  assert.ok(location);

  const destination = new URL(location);
  assert.equal(destination.origin, "https://app.healthybob.test");
  assert.equal(destination.pathname, "/settings/devices");
  assert.equal(destination.searchParams.get("tab"), "wearables");
  assert.equal(destination.searchParams.get("deviceSyncStatus"), "error");
  assert.equal(destination.searchParams.get("deviceSyncProvider"), "demo");
  assert.equal(destination.searchParams.get("deviceSyncError"), "OAUTH_CALLBACK_REJECTED");
  assert.equal(destination.searchParams.get("deviceSyncErrorMessage"), null);
});

test("callback error redirects return null without a returnTo destination", () => {
  assert.equal(
    buildCallbackErrorRedirectLocation({
      returnTo: null,
      provider: "demo",
      errorCode: "OAUTH_CALLBACK_REJECTED",
    }),
    null,
  );
});
