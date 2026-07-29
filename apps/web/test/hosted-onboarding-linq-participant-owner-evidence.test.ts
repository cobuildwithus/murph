import { describe, expect, it } from "vitest";

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  parseHostedLinqProviderEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-events";

const CHAT_ID = "chat_existing_friends";
const LINE_PHONE = "+15550000000";
const ACTOR_PHONE = "+15551234567";

describe("participant-added owner evidence", () => {
  it("extracts explicit adder evidence only when the added participant is Murph", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildParticipantAddedEvent({
        addedByHandle: buildHandle(ACTOR_PHONE, false),
        participant: buildHandle(LINE_PHONE, true),
      }),
    });

    expect(parsed).toMatchObject({
      eventType: "participant.added",
      linqChatId: CHAT_ID,
      participantAddedOwnerEvidence: {
        addedByHandle: ACTOR_PHONE,
        linePhoneNumber: LINE_PHONE,
      },
    });

    const persistedProjection = JSON.stringify({
      extractionJson: parsed?.extractionJson,
      payloadSanitizedJson: parsed?.payloadSanitizedJson,
      payloadShapeJson: parsed?.payloadShapeJson,
    });
    expect(persistedProjection).not.toContain(ACTOR_PHONE);
    expect(persistedProjection).not.toContain(LINE_PHONE);
  });

  it("keeps the documented actor-less payload non-authoritative", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildParticipantAddedEvent({
        participant: buildHandle(LINE_PHONE, true),
      }),
    });

    expect(parsed?.participantAddedOwnerEvidence).toBeNull();
    expect(parsed?.extractionJson).toMatchObject({
      ownerActorEvidencePresent: false,
    });
  });

  it("rejects actor evidence when another human was added", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildParticipantAddedEvent({
        addedByHandle: buildHandle(ACTOR_PHONE, false),
        participant: buildHandle("+15557654321", false),
      }),
    });

    expect(parsed?.participantAddedOwnerEvidence).toBeNull();
  });

  it("rejects Murph itself as the alleged adder", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildParticipantAddedEvent({
        addedByHandle: buildHandle(LINE_PHONE, true),
        participant: buildHandle(LINE_PHONE, true),
      }),
    });

    expect(parsed?.participantAddedOwnerEvidence).toBeNull();
  });
});

function buildParticipantAddedEvent(input: {
  addedByHandle?: Record<string, unknown>;
  participant: Record<string, unknown>;
}): HostedLinqWebhookEvent {
  return {
    api_version: "v3",
    created_at: "2026-07-29T05:00:00.000Z",
    data: {
      added_at: "2026-07-29T05:00:00.000Z",
      ...(input.addedByHandle
        ? { added_by_handle: input.addedByHandle }
        : {}),
      chat_id: CHAT_ID,
      participant: input.participant,
    },
    event_id: "evt_murph_added",
    event_type: "participant.added",
    trace_id: "trace_murph_added",
    webhook_version: "2026-02-03",
  } as HostedLinqWebhookEvent;
}

function buildHandle(handle: string, isMe: boolean): Record<string, unknown> {
  return {
    handle,
    is_me: isMe,
    service: "iMessage",
    status: "active",
  };
}
