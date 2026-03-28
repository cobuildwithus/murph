import { describe, expect, it } from "vitest";

import {
  HOSTED_EXECUTION_EVENT_KINDS,
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionDeviceSyncWakeDispatch,
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionVaultShareAcceptedDispatch,
  parseHostedExecutionEvent,
  type HostedExecutionDispatchRequest,
  type HostedExecutionEventKind,
} from "@murph/hosted-execution";

import { buildHostedExecutionDispatchRef } from "@/src/lib/hosted-execution/outbox-payload";

describe("hosted execution contract parity", () => {
  it("keeps builder, parser, and outbox dispatch refs aligned for every event kind", () => {
    const dispatchBuilders: Record<HostedExecutionEventKind, () => HostedExecutionDispatchRequest> = {
      "assistant.cron.tick": () => buildHostedExecutionAssistantCronTickDispatch({
        eventId: "evt_cron",
        occurredAt: "2026-03-26T12:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      }),
      "device-sync.wake": () => buildHostedExecutionDeviceSyncWakeDispatch({
        eventId: "evt_device_sync",
        occurredAt: "2026-03-26T12:01:00.000Z",
        reason: "connected",
        userId: "member_123",
      }),
      "email.message.received": () => buildHostedExecutionEmailMessageReceivedDispatch({
        envelopeFrom: "alice@example.test",
        envelopeTo: "assistant@example.test",
        eventId: "evt_email",
        identityId: "assistant@example.test",
        occurredAt: "2026-03-26T12:02:00.000Z",
        rawMessageKey: "raw_email_123",
        threadTarget: null,
        userId: "member_123",
      }),
      "linq.message.received": () => buildHostedExecutionLinqMessageReceivedDispatch({
        eventId: "evt_linq",
        linqEvent: {
          data: {
            from: "+15551234567",
          },
          event_id: "evt_linq",
          event_type: "message.received",
        },
        normalizedPhoneNumber: "+15551234567",
        occurredAt: "2026-03-26T12:03:00.000Z",
        userId: "member_123",
      }),
      "member.activated": () => buildHostedExecutionMemberActivatedDispatch({
        eventId: "evt_member",
        memberId: "member_123",
        occurredAt: "2026-03-26T12:04:00.000Z",
      }),
      "vault.share.accepted": () => buildHostedExecutionVaultShareAcceptedDispatch({
        eventId: "evt_share",
        memberId: "member_123",
        occurredAt: "2026-03-26T12:05:00.000Z",
        share: {
          shareCode: "share_code_123",
          shareId: "share_123",
        },
      }),
    };

    expect(Object.keys(dispatchBuilders).sort()).toEqual([...HOSTED_EXECUTION_EVENT_KINDS].sort());

    for (const kind of HOSTED_EXECUTION_EVENT_KINDS) {
      const dispatch = dispatchBuilders[kind]();
      const dispatchRef = buildHostedExecutionDispatchRef(dispatch);

      expect(dispatch.event.kind).toBe(kind);
      expect(parseHostedExecutionEvent(dispatch.event)).toEqual(dispatch.event);
      expect(dispatchRef.eventKind).toBe(kind);
      expect(dispatchRef.eventId).toBe(dispatch.eventId);
      expect(dispatchRef.occurredAt).toBe(dispatch.occurredAt);
      expect(dispatchRef.userId).toBe(dispatch.event.userId);
    }
  });
});
