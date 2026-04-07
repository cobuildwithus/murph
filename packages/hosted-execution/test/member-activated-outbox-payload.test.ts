import { describe, expect, it } from "vitest";

import { buildHostedExecutionMemberActivatedDispatch } from "../src/builders";
import { buildHostedExecutionOutboxPayload } from "../src/outbox-payload";

describe("member.activated outbox payload", () => {
  it("keeps the stored reference minimal when first contact is omitted", () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "member.activated:stripe:member_123:evt_123",
      memberId: "member_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });

    expect(dispatch.event.kind).toBe("member.activated");
    expect("firstContact" in dispatch.event).toBe(false);

    const payload = buildHostedExecutionOutboxPayload(dispatch, {
      payloadRef: {
        key: "transient/dispatch-payloads/member_123/member.activated.json",
      },
      storage: "auto",
    });

    expect(payload.storage).toBe("reference");
    if (payload.storage !== "reference") {
      throw new Error("Expected member activation dispatch to use reference storage.");
    }

    expect(payload.dispatchRef).toEqual({
      eventId: dispatch.eventId,
      eventKind: "member.activated",
      occurredAt: dispatch.occurredAt,
      userId: dispatch.event.userId,
    });
    expect(payload.payloadRef).toEqual({
      key: "transient/dispatch-payloads/member_123/member.activated.json",
    });
    expect(payload).not.toHaveProperty("dispatch");
  });
});
