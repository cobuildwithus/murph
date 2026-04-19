import { describe, expect, it } from "vitest";

import { parseHostedEmailIngressWakeAppendRequest } from "../src/email-ingress.ts";

describe("hosted email ingress contract", () => {
  it("parses hosted email ingress wake append requests", () => {
    expect(parseHostedEmailIngressWakeAppendRequest({
      eventId: "evt_email",
      identityId: "assistant@example.com",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "reply@example.com",
    })).toEqual({
      eventId: "evt_email",
      identityId: "assistant@example.com",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "reply@example.com",
    });
  });

  it("omits selfAddress when the ingress request does not provide one", () => {
    expect(parseHostedEmailIngressWakeAppendRequest({
      eventId: "evt_email",
      identityId: null,
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
    })).toEqual({
      eventId: "evt_email",
      identityId: null,
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
    });
  });
});
