import { describe, expect, it } from "vitest";

import {
  parseHostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
  type HostedLinqMessageReceivedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import type {
  HostedLinqFirstContactAdmissionDecision,
} from "@/src/lib/hosted-onboarding/linq-first-contact-admission";
import {
  isHostedLinqInstantStartEligible,
  isHostedLinqInstantStartEventCandidate,
  resolveHostedLinqInstantStartPhonePrefix,
} from "@/src/lib/hosted-onboarding/linq-instant-start";
import { createHostedLinqParticipantContact } from "@/src/lib/hosted-onboarding/linq-participant-contact";

describe("Linq instant start", () => {
  const modelAllow = {
    confidence: 0.99,
    kind: "allow",
    source: "model",
  } as const satisfies HostedLinqFirstContactAdmissionDecision;
  const phoneContact = createHostedLinqParticipantContact({
    kind: "phone",
    value: "+15551112222",
  });

  it("uses the longest configured E.164 phone prefix", () => {
    expect(resolveHostedLinqInstantStartPhonePrefix({
      phoneNumber: "+447700900123",
      prefixes: ["+4", "+44"],
    })).toBe("+44");
    expect(resolveHostedLinqInstantStartPhonePrefix({
      phoneNumber: "+447700900123",
      prefixes: ["+1"],
    })).toBeNull();
  });

  it("recognizes a structurally eligible event before member lookup", () => {
    expect(isHostedLinqInstantStartEventCandidate({
      event: buildMessageEvent(),
      phonePrefixes: ["+1"],
    })).toBe(true);
    expect(isHostedLinqInstantStartEventCandidate({
      event: buildMessageEvent({ service: "SMS" }),
      phonePrefixes: ["+1"],
    })).toBe(false);
  });

  it("admits only a model-approved direct iMessage from an allowed phone prefix", () => {
    expect(phoneContact).not.toBeNull();
    if (!phoneContact) {
      throw new Error("Expected a valid phone contact fixture.");
    }

    expect(isHostedLinqInstantStartEligible({
      admissionDecision: modelAllow,
      event: buildMessageEvent(),
      participantContact: phoneContact,
      phonePrefixes: ["+1"],
    })).toBe(true);
  });

  const ineligibleCases: ReadonlyArray<readonly [
    label: string,
    admissionDecision: HostedLinqFirstContactAdmissionDecision,
    event: HostedLinqMessageReceivedEvent,
    phonePrefixes: readonly string[],
  ]> = [
    [
      "deterministic fail-open",
      { ...modelAllow, source: "deterministic" },
      buildMessageEvent(),
      ["+1"],
    ],
    [
      "blocked decision",
      { ...modelAllow, kind: "block" },
      buildMessageEvent(),
      ["+1"],
    ],
    ["SMS", modelAllow, buildMessageEvent({ service: "SMS" }), ["+1"]],
    ["group chat", modelAllow, buildMessageEvent({ isGroup: true }), ["+1"]],
    ["own message", modelAllow, buildMessageEvent({ isFromMe: true }), ["+1"]],
    ["unsupported prefix", modelAllow, buildMessageEvent(), ["+44"]],
  ];

  it.each(ineligibleCases)(
    "rejects %s",
    (_label, admissionDecision, event, phonePrefixes) => {
      if (!phoneContact) {
        throw new Error("Expected a valid phone contact fixture.");
      }

      expect(isHostedLinqInstantStartEligible({
        admissionDecision,
        event,
        participantContact: phoneContact,
        phonePrefixes,
      })).toBe(false);
    },
  );

  it("rejects an email-handle participant", () => {
    const emailContact = createHostedLinqParticipantContact({
      kind: "email",
      value: "person@example.com",
    });
    if (!emailContact) {
      throw new Error("Expected a valid email contact fixture.");
    }

    expect(isHostedLinqInstantStartEligible({
      admissionDecision: modelAllow,
      event: buildMessageEvent({ sender: "person@example.com" }),
      participantContact: emailContact,
      phonePrefixes: ["+1"],
    })).toBe(false);
  });
});

function buildMessageEvent(input: {
  isFromMe?: boolean;
  isGroup?: boolean;
  sender?: string;
  service?: string;
} = {}): HostedLinqMessageReceivedEvent {
  const service = input.service ?? "iMessage";
  const sender = input.sender ?? "+15551112222";

  return requireHostedLinqMessageReceivedEvent(parseHostedLinqWebhookEvent(
    JSON.stringify({
      api_version: "v3",
      created_at: "2026-07-28T00:00:00.000Z",
      data: {
        chat: {
          id: "chat_instant_start",
          is_group: input.isGroup ?? false,
          owner_handle: {
            handle: "+15550000000",
            id: "owner_handle",
            is_me: true,
            service,
          },
        },
        direction: input.isFromMe ? "outbound" : "inbound",
        id: "message_instant_start",
        parts: [{ type: "text", value: "Hey Murph" }],
        sender_handle: {
          handle: sender,
          id: "sender_handle",
          is_me: input.isFromMe ?? false,
          service,
        },
        sent_at: "2026-07-28T00:00:00.000Z",
        service,
      },
      event_id: "event_instant_start",
      event_type: "message.received",
      webhook_version: "2026-02-03",
    }),
  ));
}
