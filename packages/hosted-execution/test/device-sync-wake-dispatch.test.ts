import { describe, expect, it } from "vitest";

import { buildHostedExecutionDeviceSyncWakeDispatch } from "../src/builders.ts";
import { parseHostedExecutionDispatchRequest } from "../src/parsers.ts";

describe("device-sync wake dispatch", () => {
  it("round-trips device-sync wake metadata through hosted-execution", () => {
    const dispatch = buildHostedExecutionDeviceSyncWakeDispatch({
      connectionId: "conn_123",
      eventId: "evt_123",
      occurredAt: "2026-04-07T00:05:30.000Z",
      provider: "oura",
      reason: "connected",
      userId: "user_123",
    });

    const parsed = parseHostedExecutionDispatchRequest(dispatch);

    expect(parsed.event).toEqual({
      connectionId: "conn_123",
      kind: "device-sync.wake",
      provider: "oura",
      reason: "connected",
      userId: "user_123",
    });
  });
});
