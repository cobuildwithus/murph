import assert from "node:assert/strict";

import { test } from "vitest";

import { buildDeviceSyncCallbackErrorRedirectLocation } from "../src/callback-redirect.ts";

test("callback error redirects keep only safe machine-readable params", () => {
  const location = buildDeviceSyncCallbackErrorRedirectLocation({
    returnTo: "https://app.example.test/settings/devices?tab=wearables",
    provider: "demo",
    errorCode: "OAUTH_CALLBACK_REJECTED",
  });

  assert.ok(location);

  const destination = new URL(location);
  assert.equal(destination.origin, "https://app.example.test");
  assert.equal(destination.pathname, "/settings/devices");
  assert.equal(destination.searchParams.get("tab"), "wearables");
  assert.equal(destination.searchParams.get("deviceSyncStatus"), "error");
  assert.equal(destination.searchParams.get("deviceSyncProvider"), "demo");
  assert.equal(destination.searchParams.get("deviceSyncError"), "OAUTH_CALLBACK_REJECTED");
  assert.equal(destination.searchParams.get("deviceSyncErrorMessage"), null);
});

test("callback error redirects return null without a returnTo destination", () => {
  assert.equal(
    buildDeviceSyncCallbackErrorRedirectLocation({
      returnTo: null,
      provider: "demo",
      errorCode: "OAUTH_CALLBACK_REJECTED",
    }),
    null,
  );
});

test("callback error redirects fail closed for malformed or non-http destinations", () => {
  assert.equal(
    buildDeviceSyncCallbackErrorRedirectLocation({
      returnTo: "javascript:alert(1)",
      provider: "demo",
      errorCode: "OAUTH_CALLBACK_REJECTED",
    }),
    null,
  );

  assert.equal(
    buildDeviceSyncCallbackErrorRedirectLocation({
      returnTo: "https://app.example.test:bad/settings",
      provider: "demo",
      errorCode: "OAUTH_CALLBACK_REJECTED",
    }),
    null,
  );
});

test("callback error redirects scrub stale callback params from returnTo", () => {
  const location = buildDeviceSyncCallbackErrorRedirectLocation({
    returnTo:
      "https://app.example.test/settings/devices?tab=wearables&deviceSyncStatus=connected&deviceSyncProvider=demo&deviceSyncAccountId=acct_leak&deviceSyncError=OLD_ERROR&deviceSyncErrorMessage=leak",
    provider: "demo",
    errorCode: "OAUTH_CALLBACK_REJECTED",
  });

  assert.ok(location);
  const destination = new URL(location);
  assert.equal(destination.searchParams.get("deviceSyncStatus"), "error");
  assert.equal(destination.searchParams.get("deviceSyncProvider"), "demo");
  assert.equal(destination.searchParams.get("deviceSyncError"), "OAUTH_CALLBACK_REJECTED");
  assert.equal(destination.searchParams.get("deviceSyncAccountId"), null);
  assert.equal(destination.searchParams.get("deviceSyncErrorMessage"), null);
});
