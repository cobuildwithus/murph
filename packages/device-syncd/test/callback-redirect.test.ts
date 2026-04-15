import { describe, expect, it } from "vitest";

import {
  DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS,
  buildDeviceSyncCallbackErrorRedirectLocation,
  buildDeviceSyncCallbackSuccessRedirectLocation,
} from "../src/callback-redirect.ts";

describe("device sync callback redirect helpers", () => {
  it("clears stale callback params across hosted and local surfaces", () => {
    const location = buildDeviceSyncCallbackSuccessRedirectLocation({
      returnTo:
        "https://murph.test/settings?keep=1&deviceSyncStatus=stale&deviceSyncProvider=old&deviceSyncConnectionId=conn_legacy&deviceSyncAccountId=acct_legacy&deviceSyncError=OLD&deviceSyncErrorMessage=legacy",
      provider: "oura",
    });

    expect(location).toBeTruthy();

    const redirected = new URL(location!);
    expect(redirected.searchParams.get("keep")).toBe("1");
    expect(redirected.searchParams.get("deviceSyncStatus")).toBe("connected");
    expect(redirected.searchParams.get("deviceSyncProvider")).toBe("oura");

    for (const key of DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS) {
      if (key === "deviceSyncStatus" || key === "deviceSyncProvider") {
        continue;
      }

      expect(redirected.searchParams.has(key)).toBe(false);
    }
  });

  it("builds error redirects without leaking stale success ids", () => {
    const location = buildDeviceSyncCallbackErrorRedirectLocation({
      returnTo: "https://murph.test/settings?deviceSyncConnectionId=conn_live&deviceSyncAccountId=acct_live",
      provider: "whoop",
      errorCode: "OAUTH_CALLBACK_REJECTED",
    });

    expect(location).toBeTruthy();

    const redirected = new URL(location!);
    expect(redirected.searchParams.get("deviceSyncStatus")).toBe("error");
    expect(redirected.searchParams.get("deviceSyncProvider")).toBe("whoop");
    expect(redirected.searchParams.get("deviceSyncError")).toBe("OAUTH_CALLBACK_REJECTED");
    expect(redirected.searchParams.has("deviceSyncConnectionId")).toBe(false);
    expect(redirected.searchParams.has("deviceSyncAccountId")).toBe(false);
  });

  it("rejects malformed and non-http callback destinations", () => {
    expect(
      buildDeviceSyncCallbackSuccessRedirectLocation({
        returnTo: "javascript:alert(1)",
        provider: "oura",
      }),
    ).toBeNull();
    expect(
      buildDeviceSyncCallbackSuccessRedirectLocation({
        returnTo: "not a url",
        provider: "oura",
      }),
    ).toBeNull();
  });
});
