import { describe, expect, it } from "vitest";

import { buildHostedExecutionDeviceSyncWake } from "../src/builders.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";

describe("device-sync wake", () => {
  it("round-trips device-sync wake metadata through hosted-execution", () => {
    const wake = buildHostedExecutionDeviceSyncWake({
      connectionId: "conn_123",
      eventId: "evt_123",
      expectedConnectedAt: "2026-04-07T00:00:00.000Z",
      occurredAt: "2026-04-07T00:05:30.000Z",
      provider: "oura",
      reason: "connected",
      userId: "user_123",
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
  });
});
