import { describe, expect, it } from "vitest";

import {
  HOSTED_EXECUTION_EVENT_KINDS,
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionDeviceSyncWakeDispatch,
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionMemberChannelsUpdatedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  buildHostedExecutionVaultShareAcceptedDispatch,
  parseHostedExecutionEvent,
  type HostedExecutionDispatchRequest,
  type HostedExecutionEventKind,
} from "@murphai/hosted-execution";

import {
  buildHostedExecutionDispatchRef,
  readHostedExecutionDispatchRef,
  serializeHostedExecutionDispatchPayload,
} from "@/src/lib/hosted-execution/dispatch-payload";

describe("hosted execution contract parity", () => {
  it("keeps builder, parser, and app-local dispatch serialization aligned for every event kind", () => {
    const dispatchBuilders: Record<HostedExecutionEventKind, () => HostedExecutionDispatchRequest> = {
      "assistant.cron.tick": () => buildHostedExecutionAssistantCronTickDispatch({
        eventId: "evt_cron",
        occurredAt: "2026-03-26T12:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      }),
      "device-sync.wake": () => buildHostedExecutionDeviceSyncWakeDispatch({
        connectionId: "dsc_123",
        eventId: "evt_device_sync",
        hint: {
          jobs: [
            {
              dedupeKey: "job_123",
              kind: "reconcile",
              payload: {
                resourceType: "sleep",
              },
              priority: 90,
            },
          ],
          occurredAt: "2026-03-26T12:00:30.000Z",
          traceId: "trace_123",
        },
        occurredAt: "2026-03-26T12:01:00.000Z",
        provider: "oura",
        reason: "connected",
        userId: "member_123",
      }),
      "email.message.received": () => buildHostedExecutionEmailMessageReceivedDispatch({
        eventId: "evt_email",
        identityId: "assistant@example.test",
        occurredAt: "2026-03-26T12:02:00.000Z",
        rawMessageKey: "raw_email_123",
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
        occurredAt: "2026-03-26T12:03:00.000Z",
        phoneLookupKey: "hbidx:phone:v1:test",
        userId: "member_123",
      }),
      "member.activated": () => buildHostedExecutionMemberActivatedDispatch({
        eventId: "evt_member",
        memberId: "member_123",
        memberChannels: {
          email: false,
          linq: true,
          telegram: false,
        },
        occurredAt: "2026-03-26T12:04:00.000Z",
      }),
      "member.channels.updated": () => buildHostedExecutionMemberChannelsUpdatedDispatch({
        eventId: "evt_member_channels",
        memberChannels: {
          email: true,
          linq: true,
          telegram: false,
        },
        memberId: "member_123",
        occurredAt: "2026-03-26T12:04:15.000Z",
      }),
      "telegram.message.received": () => buildHostedExecutionTelegramMessageReceivedDispatch({
        eventId: "evt_telegram",
        occurredAt: "2026-03-26T12:04:30.000Z",
        telegramMessage: {
          messageId: "1",
          schema: "murph.hosted-telegram-message.v1",
          text: "hello",
          threadId: "123",
        },
        userId: "member_123",
      }),
      "vault.share.accepted": () => buildHostedExecutionVaultShareAcceptedDispatch({
        eventId: "evt_share",
        memberId: "member_123",
        occurredAt: "2026-03-26T12:05:00.000Z",
        share: {
          ownerUserId: "member_sender",
          shareId: "share_123",
        },
      }),
    };

    expect(Object.keys(dispatchBuilders).sort()).toEqual([...HOSTED_EXECUTION_EVENT_KINDS].sort());

    for (const kind of HOSTED_EXECUTION_EVENT_KINDS) {
      const dispatch = dispatchBuilders[kind]();
      const dispatchRef = buildHostedExecutionDispatchRef(dispatch);
      const payload = serializeHostedExecutionDispatchPayload(dispatch);
      const parsedDispatchRef = readHostedExecutionDispatchRef(payload);

      expect(dispatch.event.kind).toBe(kind);
      expect(parseHostedExecutionEvent(dispatch.event)).toEqual(dispatch.event);
      expect(payload.storage).toBe("inline");
      expect(dispatchRef.eventKind).toBe(kind);
      expect(dispatchRef.eventId).toBe(dispatch.eventId);
      expect(dispatchRef.occurredAt).toBe(dispatch.occurredAt);
      expect(dispatchRef.userId).toBe(dispatch.event.userId);
      expect(parsedDispatchRef).toEqual(dispatchRef);
    }
  });
});
