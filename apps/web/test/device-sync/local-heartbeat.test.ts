import { describe, expect, it } from "vitest";

import {
  buildHostedLocalHeartbeatRuntimeLocalStateUpdate,
  parseHostedLocalHeartbeatPatch,
} from "@/src/lib/device-sync/local-heartbeat";

describe("hosted local heartbeat seam", () => {
  it("rejects empty heartbeat payloads", () => {
    expect(() => parseHostedLocalHeartbeatPatch({})).toThrowError(/must include at least one supported field/u);
  });

  it("rejects server-owned fields", () => {
    expect(() =>
      parseHostedLocalHeartbeatPatch({
        nextReconcileAt: "2026-04-12T00:20:00.000Z",
      }),
    ).toThrowError(/server-owned fields: nextReconcileAt/u);
  });

  it("sanitizes error fields and keeps the runtime update shape canonical", () => {
    const patch = parseHostedLocalHeartbeatPatch({
      lastErrorCode: "Authorization: Bearer abc123",
      lastErrorMessage: "refresh_token=xyz789",
      lastSyncErrorAt: "2026-04-12T10:20:00+10:00",
    });

    expect(patch).toEqual({
      lastErrorCode: "Authorization: [redacted]",
      lastErrorMessage: "refresh_token=[redacted]",
      lastSyncErrorAt: "2026-04-12T00:20:00.000Z",
    });

    expect(
      buildHostedLocalHeartbeatRuntimeLocalStateUpdate(
        {
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-04-12T00:00:00.000Z",
        },
        patch,
      ),
    ).toEqual({
      lastErrorCode: "Authorization: [redacted]",
      lastErrorMessage: "refresh_token=[redacted]",
      lastSyncErrorAt: "2026-04-12T00:20:00.000Z",
    });
  });

  it("blocks backward heartbeat transitions before calling hosted runtime", () => {
    expect(() =>
      buildHostedLocalHeartbeatRuntimeLocalStateUpdate(
        {
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-04-12T00:10:00.000Z",
        },
        {
          lastSyncErrorAt: "2026-04-12T00:05:00.000Z",
        },
      ),
    ).toThrowError(/may not be earlier than lastSyncStartedAt/u);
  });
});
