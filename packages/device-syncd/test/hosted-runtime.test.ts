import { describe, expect, it } from "vitest";

import { parseHostedExecutionDeviceSyncRuntimeApplyRequest } from "../src/hosted-runtime.ts";

describe("parseHostedExecutionDeviceSyncRuntimeApplyRequest", () => {
  it("accepts string error fields while keeping timestamp fields strict", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: "Refresh token expired",
            lastSyncErrorAt: "2026-04-07T00:00:00.000Z",
          },
        },
      ],
      userId: "user_123",
    });

    expect(parsed).toEqual({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: "Refresh token expired",
            lastSyncErrorAt: "2026-04-07T00:00:00.000Z",
          },
        },
      ],
      userId: "user_123",
    });
  });

  it("sanitizes connection metadata updates before they reach durable runtime state", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connection: {
            metadata: {
              "__proto__": "blocked",
              accountTier: "pro",
              attempts: 2,
              nested: {
                secret: "discarded",
              },
              nullValue: null,
              verbose: "x".repeat(257),
            },
          },
          connectionId: "conn_123",
        },
      ],
      userId: "user_123",
    });

    expect(parsed.updates[0]?.connection?.metadata).toEqual({
      accountTier: "pro",
      attempts: 2,
      nullValue: null,
    });
  });
});
