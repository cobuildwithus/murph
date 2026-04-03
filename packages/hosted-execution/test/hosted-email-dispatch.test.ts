import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionEmailMessageReceivedDispatch,
} from "../src/builders.ts";
import { resolveHostedEmailSelfAddresses } from "../src/hosted-email.ts";
import { parseHostedExecutionDispatchRequest } from "../src/parsers.ts";

describe("hosted email dispatch", () => {
  it("round-trips the optional selfAddress through the dispatch codec", () => {
    const dispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "evt_123",
      identityId: "assistant@example.com",
      occurredAt: "2026-04-03T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "assistant+route@example.com",
      userId: "user_123",
    });

    const parsed = parseHostedExecutionDispatchRequest(dispatch);

    expect(parsed.event.kind).toBe("email.message.received");
    expect(parsed.event).toMatchObject({
      identityId: "assistant@example.com",
      rawMessageKey: "raw_123",
      selfAddress: "assistant+route@example.com",
      userId: "user_123",
    });
  });

  it("treats the routed alias as a self address alongside the fixed sender identity", () => {
    expect(resolveHostedEmailSelfAddresses({
      extra: ["Assistant+Route@Example.com", "assistant@example.com"],
      senderIdentity: "Assistant@Example.com",
    })).toEqual([
      "assistant@example.com",
      "assistant+route@example.com",
    ]);
  });
});
