import { describe, expect, it } from "vitest";

import {
  hostedPhysicalNoteRecoveryResponseSchema,
  hostedPhysicalNoteSendRequestSchema,
  hostedPhysicalNoteSendResponseSchema,
  normalizeHostedPhysicalNoteRecipient,
  stableHostedPhysicalNoteRecipientJson,
} from "../src/physical-notes.ts";

describe("hosted physical-note contracts", () => {
  it("requires a bounded settled-usage fact on recovery results", () => {
    expect(hostedPhysicalNoteRecoveryResponseSchema.parse({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: "250000",
      status: "accepted",
    })).toEqual({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: "250000",
      status: "accepted",
    });
    expect(hostedPhysicalNoteRecoveryResponseSchema.parse({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: null,
      status: "accepted",
    })).toMatchObject({ settledUsageCostUsdMicros: null });
    expect(() => hostedPhysicalNoteRecoveryResponseSchema.parse({
      remainingUnresolved: false,
      retryAfter: null,
      status: "clear",
    })).toThrow();
    expect(() => hostedPhysicalNoteRecoveryResponseSchema.parse({
      remainingUnresolved: false,
      retryAfter: null,
      settledUsageCostUsdMicros: "250000",
      status: "clear",
    })).toThrow();
  });

  it("normalizes one bounded US recipient", () => {
    const recipient = normalizeHostedPhysicalNoteRecipient({
      addressLine1: " 123 Main St ",
      city: " Atlanta ",
      name: " Sam ",
      postalCode: "30308",
      state: "ga",
    });

    expect(recipient).toEqual({
      addressLine1: "123 Main St",
      city: "Atlanta",
      name: "Sam",
      postalCode: "30308",
      state: "GA",
    });
    expect(stableHostedPhysicalNoteRecipientJson(recipient)).toBe(
      '{"addressLine1":"123 Main St","addressLine2":null,"city":"Atlanta","name":"Sam","postalCode":"30308","state":"GA"}',
    );
  });

  it("accepts only the bounded provider request shape", () => {
    expect(hostedPhysicalNoteSendRequestSchema.parse({
      artwork: {
        expiresAt: "2026-07-31T00:00:00.000Z",
        sha256: "a".repeat(64),
        url: "https://media.example.test/private-image",
      },
      originAssistantInputId: `ain_${"b".repeat(32)}`,
      recipient: {
        addressLine1: "123 Main St",
        city: "Atlanta",
        name: "Sam",
        postalCode: "30308",
        state: "GA",
      },
      requestKey: "physical_note_123",
    })).toMatchObject({
      recipient: { state: "GA" },
    });
  });

  it("rejects recipient fields that Lob cannot accept", () => {
    const baseRequest = {
      artwork: {
        expiresAt: "2026-07-31T00:00:00.000Z",
        sha256: "a".repeat(64),
        url: "https://media.example.test/private-image",
      },
      originAssistantInputId: `ain_${"b".repeat(32)}`,
      recipient: {
        addressLine1: "123 Main St",
        city: "Atlanta",
        name: "Sam",
        postalCode: "30308",
        state: "GA",
      },
      requestKey: "physical_note_123",
    };

    expect(() => hostedPhysicalNoteSendRequestSchema.parse({
      ...baseRequest,
      recipient: {
        ...baseRequest.recipient,
        name: "x".repeat(41),
      },
    })).toThrow();
    expect(() => hostedPhysicalNoteSendRequestSchema.parse({
      ...baseRequest,
      recipient: {
        ...baseRequest.recipient,
        addressLine1: "x".repeat(65),
      },
    })).toThrow();
    expect(() => hostedPhysicalNoteSendRequestSchema.parse({
      ...baseRequest,
      recipient: {
        ...baseRequest.recipient,
        addressLine2: "x".repeat(65),
      },
    })).toThrow();
  });

  it("requires a temporary HTTPS artwork capability", () => {
    expect(() => hostedPhysicalNoteSendRequestSchema.parse({
      artwork: {
        expiresAt: "2026-07-31T00:00:00.000Z",
        sha256: "a".repeat(64),
        url: "http://media.example.test/private-image",
      },
      originAssistantInputId: `ain_${"b".repeat(32)}`,
      recipient: {
        addressLine1: "123 Main St",
        city: "Atlanta",
        name: "Sam",
        postalCode: "30308",
        state: "GA",
      },
      requestKey: "physical_note_123",
    })).toThrow();
  });

  it("accepts only safe optional physical-note failure reasons", () => {
    const baseResponse = {
      complimentary: false,
      costUsdMicros: "250000",
      physicalNoteId: "hpn_failed",
      status: "failed" as const,
    };

    expect(hostedPhysicalNoteSendResponseSchema.parse({
      ...baseResponse,
      failureReason: "recipient_address",
    })).toMatchObject({ failureReason: "recipient_address" });
    expect(hostedPhysicalNoteSendResponseSchema.parse({
      ...baseResponse,
      failureReason: "prior_note_unresolved",
    })).toMatchObject({ failureReason: "prior_note_unresolved" });
    expect(hostedPhysicalNoteSendResponseSchema.parse({
      ...baseResponse,
      failureReason: "prior_note_accepted",
    })).toMatchObject({ failureReason: "prior_note_accepted" });
    expect(hostedPhysicalNoteSendResponseSchema.parse({
      ...baseResponse,
      failureReason: "prior_note_accepted",
      status: "accepted",
    })).toMatchObject({
      failureReason: "prior_note_accepted",
      status: "accepted",
    });
    expect(hostedPhysicalNoteSendResponseSchema.parse(baseResponse))
      .toEqual(baseResponse);
    expect(() => hostedPhysicalNoteSendResponseSchema.parse({
      ...baseResponse,
      failureReason: "provider message",
    })).toThrow();
  });

  it("rejects international and open-ended request fields", () => {
    expect(() => hostedPhysicalNoteSendRequestSchema.parse({
      artwork: {
        expiresAt: "2026-07-31T00:00:00.000Z",
        sha256: "a".repeat(64),
        url: "https://media.example.test/private-image",
      },
      originAssistantInputId: `ain_${"b".repeat(32)}`,
      recipient: {
        addressLine1: "1 King St",
        city: "Toronto",
        country: "CA",
        name: "Sam",
        postalCode: "M5H 1A1",
        state: "ON",
      },
      requestKey: "physical_note_123",
    })).toThrow();
  });
});
