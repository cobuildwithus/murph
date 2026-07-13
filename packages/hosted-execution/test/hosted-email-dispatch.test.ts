import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionEmailConversationMessageWake,
} from "../src/builders.ts";
import { resolveHostedEmailSelfAddresses } from "../src/hosted-email.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";

describe("hosted email wake", () => {
  it("round-trips optional email audience metadata through the wake codec", () => {
    const wake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "evt_123",
      identityId: "assistant@example.com",
      occurredAt: "2026-04-03T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "assistant+route@example.com",
      threadIsDirect: false,
      userId: "user_123",
    });

    const parsed = parseHostedExecutionWake(wake);

    expect(parsed.kind).toBe("conversation.message");
    if (parsed.kind !== "conversation.message" || parsed.message.channel !== "email") {
      throw new Error("Expected an email conversation.message wake.");
    }

    expect(parsed.message).toMatchObject({
      identityId: "assistant@example.com",
      rawMessageKey: "raw_123",
      selfAddress: "assistant+route@example.com",
      threadIsDirect: false,
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
