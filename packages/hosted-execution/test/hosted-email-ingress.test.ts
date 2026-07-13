import { describe, expect, it } from "vitest";
import { HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH } from "@murphai/runtime-state";

import { parseHostedEmailIngressWakeAppendRequest } from "../src/email-ingress.ts";

describe("hosted email ingress contract", () => {
  it("parses hosted email ingress wake append requests", () => {
    expect(parseHostedEmailIngressWakeAppendRequest({
      attachmentSummaries: [
        {
          contentType: "application/pdf",
          fileName: "labs.pdf",
          sizeBytes: 321,
        },
      ],
      cc: ["helper@example.test"],
      eventId: "evt_email",
      from: "Sender <sender@example.test>",
      identityId: "assistant@example.com",
      messageId: "<message-123@example.test>",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "reply@example.com",
      subject: "Hosted email",
      textPreview: "Please look at this update.",
      threadKey: "<thread-root@example.test>",
      threadTarget: "hostedmail:opaque-thread-target",
      to: ["reply@example.com"],
    })).toEqual({
      attachmentSummaries: [
        {
          contentType: "application/pdf",
          fileName: "labs.pdf",
          sizeBytes: 321,
        },
      ],
      cc: ["helper@example.test"],
      eventId: "evt_email",
      from: "Sender <sender@example.test>",
      identityId: "assistant@example.com",
      messageId: "<message-123@example.test>",
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "reply@example.com",
      subject: "Hosted email",
      textPreview: "Please look at this update.",
      threadKey: "<thread-root@example.test>",
      threadTarget: "hostedmail:opaque-thread-target",
      to: ["reply@example.com"],
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

  it("accepts the hosted email self address bound produced by the Cloudflare ingress worker", () => {
    expect(parseHostedEmailIngressWakeAppendRequest({
      eventId: "evt_email",
      identityId: null,
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "x".repeat(320),
    }).selfAddress).toBe("x".repeat(320));
  });

  it("rejects email prompt projection fields outside ingress bounds", () => {
    const base = {
      eventId: "evt_email",
      identityId: null,
      occurredAt: "2026-04-17T00:00:00.000Z",
      rawMessageKey: "raw_123",
    };

    expect(() => parseHostedEmailIngressWakeAppendRequest({
      ...base,
      to: Array.from({ length: 9 }, (_, index) => `person-${index}@example.test`),
    })).toThrow(/to must include at most 8 items/u);
    expect(() => parseHostedEmailIngressWakeAppendRequest({
      ...base,
      subject: "x".repeat(241),
    })).toThrow(/subject must be at most 240 characters/u);
    expect(() => parseHostedEmailIngressWakeAppendRequest({
      ...base,
      textPreview: "x".repeat(4_001),
    })).toThrow(/textPreview must be at most 4000 characters/u);
    expect(() => parseHostedEmailIngressWakeAppendRequest({
      ...base,
      attachmentSummaries: Array.from({ length: 13 }, () => ({
        contentType: "application/pdf",
        fileName: "labs.pdf",
        sizeBytes: 321,
      })),
    })).toThrow(/attachmentSummaries must include at most 12 items/u);
    expect(() => parseHostedEmailIngressWakeAppendRequest({
      ...base,
      messageId: "x".repeat(513),
    })).toThrow(/messageId must be at most 512 characters/u);
    expect(() => parseHostedEmailIngressWakeAppendRequest({
      ...base,
      selfAddress: "x".repeat(321),
    })).toThrow(/selfAddress must be at most 320 characters/u);
    expect(() => parseHostedEmailIngressWakeAppendRequest({
      ...base,
      threadKey: "x".repeat(513),
    })).toThrow(/threadKey must be at most 512 characters/u);
    expect(() => parseHostedEmailIngressWakeAppendRequest({
      ...base,
      threadTarget: "x".repeat(HOSTED_EMAIL_THREAD_TARGET_MAX_LENGTH + 1),
    })).toThrow(/threadTarget must be at most 8192 characters/u);
    expect(parseHostedEmailIngressWakeAppendRequest({
      ...base,
      threadTarget: `hostedmail:${"x".repeat(3_000)}`,
    }).threadTarget).toBe(`hostedmail:${"x".repeat(3_000)}`);
  });
});
