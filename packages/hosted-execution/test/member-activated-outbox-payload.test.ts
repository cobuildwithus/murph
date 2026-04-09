import { describe, expect, it } from "vitest";

import { buildHostedExecutionMemberActivatedDispatch } from "../src/builders.js";
import { buildHostedExecutionOutboxPayload } from "../src/outbox-payload.js";

describe("member.activated outbox payload", () => {
  it("keeps the stored inline payload self-contained when first contact is omitted", () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "member.activated:stripe:member_123:evt_123",
      memberId: "member_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });

    expect(dispatch.event.kind).toBe("member.activated");
    expect("firstContact" in dispatch.event).toBe(false);

    const payload = buildHostedExecutionOutboxPayload(dispatch, { storage: "auto" });

    expect(payload.storage).toBe("inline");
    if (payload.storage !== "inline") {
      throw new Error("Expected member activation dispatch to use inline storage.");
    }

    expect(payload.dispatch).toEqual(dispatch);
    expect(payload).not.toHaveProperty("dispatchRef");
    expect(payload).not.toHaveProperty("stagedPayloadId");
  });
});
