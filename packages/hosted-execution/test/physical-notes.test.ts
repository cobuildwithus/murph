import { describe, expect, it } from "vitest";

import {
  hostedPhysicalNoteSendRequestSchema,
  hostedPhysicalNoteSendResponseSchema,
  normalizeHostedPhysicalNoteRecipient,
  stableHostedPhysicalNoteRecipientJson,
} from "../src/physical-notes.ts";

describe("hosted physical-note contracts", () => {
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

  it("accepts the terminal prior accepted-note outcome", () => {
    const response = {
      complimentary: true,
      costUsdMicros: "250000",
      physicalNoteId: "hpn_prior",
      status: "accepted",
    } as const;

    expect(hostedPhysicalNoteSendResponseSchema.parse(response)).toEqual(
      response,
    );
    expect(hostedPhysicalNoteSendResponseSchema.parse({
      ...response,
      priorAcceptedPhysicalNote: {
        physicalNoteId: "hpn_prior",
      },
    })).toMatchObject({
      priorAcceptedPhysicalNote: {
        physicalNoteId: "hpn_prior",
      },
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
