import { describe, expect, it } from "vitest";

import { TEST_HOSTED_SHARE_PACK } from "./test-fixtures.ts";
import {
  parseHostedExecutionDispatchRequest,
  parseHostedExecutionDispatchResult,
  parseHostedExecutionEvent,
  parseHostedExecutionOutboxPayload,
  parseHostedExecutionRunnerRequest,
  parseHostedExecutionRunnerResult,
  parseHostedExecutionSharePack,
  parseHostedExecutionTimelineEntries,
  parseHostedExecutionUserStatus,
} from "../src/parsers.ts";

const TEST_BUNDLE_REF = {
  hash: "hash_123",
  key: "bundle/vault-123",
  size: 128,
  updatedAt: "2026-04-08T00:00:00.000Z",
} as const;

describe("hosted execution parsers coverage", () => {
  describe("runner request validation", () => {
    it("parses non-share runner requests with run context", () => {
      expect(parseHostedExecutionRunnerRequest({
        bundle: "bundle-ref-123",
        dispatch: {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "user_123",
          },
          eventId: "evt_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        run: {
          attempt: 2,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
      })).toEqual({
        bundle: "bundle-ref-123",
        dispatch: {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "user_123",
          },
          eventId: "evt_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        run: {
          attempt: 2,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
      });
    });

    it("rejects share packs on non-share events", () => {
      expect(() =>
        parseHostedExecutionRunnerRequest({
          bundle: null,
          dispatch: {
            event: {
              kind: "assistant.cron.tick",
              reason: "alarm",
              userId: "user_123",
            },
            eventId: "evt_123",
            occurredAt: "2026-04-08T00:00:00.000Z",
          },
          sharePack: {
            ownerUserId: "user_123",
            pack: TEST_HOSTED_SHARE_PACK,
            shareId: "share_123",
          },
        }),
      ).toThrow(/sharePack is only supported/i);
    });

    it("rejects mismatched share-pack owner and share ids", () => {
      const baseRequest = {
        bundle: null,
        dispatch: {
          event: {
            kind: "vault.share.accepted" as const,
            share: {
              ownerUserId: "owner_123",
              shareId: "share_123",
            },
            userId: "user_123",
          },
          eventId: "evt_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        sharePack: {
          ownerUserId: "owner_999",
          pack: TEST_HOSTED_SHARE_PACK,
          shareId: "share_123",
        },
      };

      expect(() => parseHostedExecutionRunnerRequest(baseRequest)).toThrow(
        /ownerUserId must match/i,
      );

      expect(() =>
        parseHostedExecutionRunnerRequest({
          ...baseRequest,
          sharePack: {
            ...baseRequest.sharePack,
            ownerUserId: "owner_123",
            shareId: "share_999",
          },
        }),
      ).toThrow(/shareId must match/i);
    });

    it("parses runner results", () => {
      expect(parseHostedExecutionRunnerResult({
        bundle: null,
        result: {
          eventsHandled: 3,
          nextWakeAt: "2026-04-08T01:00:00.000Z",
          summary: "Processed queued work.",
        },
      })).toEqual({
        bundle: null,
        result: {
          eventsHandled: 3,
          nextWakeAt: "2026-04-08T01:00:00.000Z",
          summary: "Processed queued work.",
        },
      });
    });

    it("parses inline outbox payloads and share packs", () => {
      expect(parseHostedExecutionOutboxPayload({
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "user_123",
          },
          eventId: "evt_member",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        storage: "inline",
      })).toEqual({
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "user_123",
          },
          eventId: "evt_member",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        storage: "inline",
      });

      expect(parseHostedExecutionSharePack(TEST_HOSTED_SHARE_PACK)).toEqual(TEST_HOSTED_SHARE_PACK);
    });
  });

  describe("status and timeline parsing", () => {
    it("parses dispatch results with run status and timeline", () => {
      const parsed = parseHostedExecutionDispatchResult({
        event: {
          eventId: "evt_123",
          lastError: null,
          state: "backpressured",
          userId: "user_123",
        },
        status: {
          backpressuredEventIds: ["evt_123"],
          bundleRef: TEST_BUNDLE_REF,
          inFlight: true,
          lastError: "Waiting for runner slot.",
          lastErrorAt: "2026-04-08T00:02:00.000Z",
          lastErrorCode: "runner_busy",
          lastEventId: "evt_123",
          lastRunAt: "2026-04-08T00:01:00.000Z",
          nextWakeAt: "2026-04-08T00:05:00.000Z",
          pendingEventCount: 2,
          poisonedEventIds: ["evt_poisoned"],
          retryingEventId: "evt_retry",
          run: {
            attempt: 3,
            eventId: "evt_123",
            phase: "dispatch.running",
            runId: "run_123",
            startedAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:02:00.000Z",
          },
          timeline: [{
            at: "2026-04-08T00:01:30.000Z",
            attempt: 3,
            component: "runner",
            errorCode: null,
            eventId: "evt_123",
            level: "info",
            message: "Runner resumed processing.",
            phase: "dispatch.running",
            runId: "run_123",
          }],
          userId: "user_123",
        },
      });

      expect(parsed).toEqual({
        event: {
          eventId: "evt_123",
          lastError: null,
          state: "backpressured",
          userId: "user_123",
        },
        status: {
          backpressuredEventIds: ["evt_123"],
          bundleRef: TEST_BUNDLE_REF,
          inFlight: true,
          lastError: "Waiting for runner slot.",
          lastErrorAt: "2026-04-08T00:02:00.000Z",
          lastErrorCode: "runner_busy",
          lastEventId: "evt_123",
          lastRunAt: "2026-04-08T00:01:00.000Z",
          nextWakeAt: "2026-04-08T00:05:00.000Z",
          pendingEventCount: 2,
          poisonedEventIds: ["evt_poisoned"],
          retryingEventId: "evt_retry",
          run: {
            attempt: 3,
            eventId: "evt_123",
            phase: "dispatch.running",
            runId: "run_123",
            startedAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:02:00.000Z",
          },
          timeline: [{
            at: "2026-04-08T00:01:30.000Z",
            attempt: 3,
            component: "runner",
            errorCode: null,
            eventId: "evt_123",
            level: "info",
            message: "Runner resumed processing.",
            phase: "dispatch.running",
            runId: "run_123",
          }],
          userId: "user_123",
        },
      });
    });

    it("parses minimal user status without optional fields", () => {
      expect(parseHostedExecutionUserStatus({
        bundleRef: null,
        inFlight: false,
        lastError: null,
        lastEventId: null,
        lastRunAt: null,
        nextWakeAt: null,
        pendingEventCount: 0,
        poisonedEventIds: [],
        retryingEventId: null,
        userId: "user_123",
      })).toEqual({
        bundleRef: null,
        inFlight: false,
        lastError: null,
        lastEventId: null,
        lastRunAt: null,
        nextWakeAt: null,
        pendingEventCount: 0,
        poisonedEventIds: [],
        retryingEventId: null,
        userId: "user_123",
      });
    });

    it("rejects invalid run phases, timeline levels, and dispatch states", () => {
      expect(() =>
        parseHostedExecutionUserStatus({
          bundleRef: null,
          inFlight: true,
          lastError: null,
          lastEventId: null,
          lastRunAt: null,
          nextWakeAt: null,
          pendingEventCount: 1,
          poisonedEventIds: [],
          retryingEventId: null,
          run: {
            attempt: 1,
            eventId: "evt_123",
            phase: "queued",
            runId: "run_123",
            startedAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:01.000Z",
          },
          userId: "user_123",
        }),
      ).toThrow(/run status phase is invalid/i);

      expect(() =>
        parseHostedExecutionTimelineEntries([{
          at: "2026-04-08T00:01:30.000Z",
          attempt: 1,
          component: "runner",
          eventId: "evt_123",
          level: "debug",
          message: "bad level",
          phase: "dispatch.running",
          runId: "run_123",
        }]),
      ).toThrow(/timeline entries\[0\]\.level is invalid/i);

      expect(() =>
        parseHostedExecutionTimelineEntries([{
          at: "2026-04-08T00:01:30.000Z",
          attempt: 1,
          component: "runner",
          eventId: "evt_123",
          level: "info",
          message: "bad phase",
          phase: "running",
          runId: "run_123",
        }]),
      ).toThrow(/timeline entries\[0\]\.phase is invalid/i);

      expect(() =>
        parseHostedExecutionDispatchResult({
          event: {
            eventId: "evt_123",
            lastError: null,
            state: "unknown",
            userId: "user_123",
          },
          status: {
            bundleRef: null,
            inFlight: false,
            lastError: null,
            lastEventId: null,
            lastRunAt: null,
            nextWakeAt: null,
            pendingEventCount: 0,
            poisonedEventIds: [],
            retryingEventId: null,
            userId: "user_123",
          },
        }),
      ).toThrow(/Unsupported hosted execution event dispatch state/i);
    });
  });

  describe("event variants", () => {
    it("parses member activation, linq, cron, gateway, and device-sync dispatch payloads", () => {
      const memberDispatch = parseHostedExecutionDispatchRequest({
        event: {
          firstContact: {
            channel: "telegram",
            identityId: "identity_123",
            threadId: "thread_123",
            threadIsDirect: true,
          },
          kind: "member.activated",
          userId: "user_123",
        },
        eventId: "evt_member",
        occurredAt: "2026-04-08T00:00:00.000Z",
      });
      const linqEvent = parseHostedExecutionEvent({
        kind: "linq.message.received",
        linqEvent: {
          eventId: "linq_evt_123",
        },
        linqMessageId: null,
        phoneLookupKey: "phone_lookup_123",
        userId: "user_123",
      });
      const cronEvent = parseHostedExecutionEvent({
        kind: "assistant.cron.tick",
        reason: "device-sync",
        userId: "user_123",
      });
      const gatewayEvent = parseHostedExecutionEvent({
        clientRequestId: null,
        kind: "gateway.message.send",
        replyToMessageId: "msg_123",
        sessionKey: "session_123",
        text: "Hello from hosted execution",
        userId: "user_123",
      });
      const deviceSyncEvent = parseHostedExecutionEvent({
        connectionId: "conn_123",
        hint: {
          eventType: "webhook",
          jobs: [{
            availableAt: "2026-04-08T00:03:00.000Z",
            dedupeKey: null,
            kind: "provider.fetch",
            maxAttempts: 5,
            payload: {
              resource: "sleep",
            },
            priority: 4,
          }],
          nextReconcileAt: "2026-04-08T01:00:00.000Z",
          occurredAt: "2026-04-08T00:02:00.000Z",
          reason: "provider webhook",
          resourceCategory: "daily",
          revokeWarning: {
            code: "oauth_expiring",
            message: "Reconnect soon.",
          },
          scopes: ["daily", "sleep"],
          traceId: "trace_123",
        },
        kind: "device-sync.wake",
        provider: "oura",
        reason: "webhook_hint",
        runtimeSnapshot: null,
        userId: "user_123",
      });

      expect(memberDispatch.event).toEqual({
        firstContact: {
          channel: "telegram",
          identityId: "identity_123",
          threadId: "thread_123",
          threadIsDirect: true,
        },
        kind: "member.activated",
        userId: "user_123",
      });
      expect(linqEvent).toEqual({
        kind: "linq.message.received",
        linqEvent: {
          eventId: "linq_evt_123",
        },
        linqMessageId: null,
        phoneLookupKey: "phone_lookup_123",
        userId: "user_123",
      });
      expect(cronEvent).toEqual({
        kind: "assistant.cron.tick",
        reason: "device-sync",
        userId: "user_123",
      });
      expect(gatewayEvent).toEqual({
        clientRequestId: null,
        kind: "gateway.message.send",
        replyToMessageId: "msg_123",
        sessionKey: "session_123",
        text: "Hello from hosted execution",
        userId: "user_123",
      });
      expect(deviceSyncEvent).toEqual({
        connectionId: "conn_123",
        hint: {
          eventType: "webhook",
          jobs: [{
            availableAt: "2026-04-08T00:03:00.000Z",
            dedupeKey: null,
            kind: "provider.fetch",
            maxAttempts: 5,
            payload: {
              resource: "sleep",
            },
            priority: 4,
          }],
          nextReconcileAt: "2026-04-08T01:00:00.000Z",
          occurredAt: "2026-04-08T00:02:00.000Z",
          reason: "provider webhook",
          resourceCategory: "daily",
          revokeWarning: {
            code: "oauth_expiring",
            message: "Reconnect soon.",
          },
          scopes: ["daily", "sleep"],
          traceId: "trace_123",
        },
        kind: "device-sync.wake",
        provider: "oura",
        reason: "webhook_hint",
        runtimeSnapshot: null,
        userId: "user_123",
      });
    });

    it("parses null device-sync hint and revoke warning values", () => {
      expect(parseHostedExecutionEvent({
        hint: null,
        kind: "device-sync.wake",
        reason: "connected",
        runtimeSnapshot: null,
        userId: "user_123",
      })).toEqual({
        hint: null,
        kind: "device-sync.wake",
        reason: "connected",
        runtimeSnapshot: null,
        userId: "user_123",
      });

      expect(parseHostedExecutionEvent({
        hint: {
          revokeWarning: null,
        },
        kind: "device-sync.wake",
        reason: "disconnected",
        userId: "user_123",
      })).toEqual({
        hint: {
          revokeWarning: null,
        },
        kind: "device-sync.wake",
        reason: "disconnected",
        userId: "user_123",
      });
    });

    it("rejects invalid event-level values", () => {
      expect(() =>
        parseHostedExecutionEvent({
          kind: "unsupported.event",
          userId: "user_123",
        }),
      ).toThrow(/Unsupported hosted execution event kind/i);

      expect(() =>
        parseHostedExecutionEvent({
          firstContact: {
            channel: "sms",
            identityId: "identity_123",
            threadId: "thread_123",
            threadIsDirect: true,
          },
          kind: "member.activated",
          userId: "user_123",
        }),
      ).toThrow(/firstContact channel is invalid/i);

      expect(() =>
        parseHostedExecutionEvent({
          kind: "assistant.cron.tick",
          reason: "scheduled",
          userId: "user_123",
        }),
      ).toThrow(/Unsupported hosted execution assistant\.cron\.tick reason/i);

      expect(() =>
        parseHostedExecutionEvent({
          kind: "device-sync.wake",
          reason: "manual",
          userId: "user_123",
        }),
      ).toThrow(/Unsupported hosted execution device-sync\.wake reason/i);

      expect(() => parseHostedExecutionDispatchRequest(null)).toThrow(/must be an object/i);

      expect(() =>
        parseHostedExecutionEvent({
          hint: {
            jobs: [{
              kind: "provider.fetch",
              payload: null,
            }],
          },
          kind: "device-sync.wake",
          reason: "connected",
          userId: "user_123",
        }),
      ).toThrow(/jobs\[0\]\.payload must be an object/i);

      expect(() =>
        parseHostedExecutionEvent({
          hint: {
            jobs: [{
              kind: "provider.fetch",
              maxAttempts: "5",
            }],
          },
          kind: "device-sync.wake",
          reason: "connected",
          userId: "user_123",
        }),
      ).toThrow(/jobs\[0\]\.maxAttempts must be a finite number/i);
    });
  });

  describe("telegram payload parsing", () => {
    it("parses telegram payloads with attachments and nullable fields", () => {
      expect(parseHostedExecutionEvent({
        kind: "telegram.message.received",
        telegramMessage: {
          attachments: [{
            fileId: "file_123",
            fileName: null,
            fileSize: null,
            fileUniqueId: "unique_123",
            height: null,
            kind: "photo",
            mimeType: "image/jpeg",
            width: null,
          }],
          mediaGroupId: null,
          messageId: "message_123",
          schema: "murph.hosted-telegram-message.v1",
          text: "",
          threadId: "thread_123",
        },
        userId: "user_123",
      })).toEqual({
        kind: "telegram.message.received",
        telegramMessage: {
          attachments: [{
            fileId: "file_123",
            fileName: null,
            fileSize: null,
            fileUniqueId: "unique_123",
            height: null,
            kind: "photo",
            mimeType: "image/jpeg",
            width: null,
          }],
          mediaGroupId: null,
          messageId: "message_123",
          schema: "murph.hosted-telegram-message.v1",
          text: "",
          threadId: "thread_123",
        },
        userId: "user_123",
      });
    });

    it("rejects unsupported telegram schemas and attachment kinds", () => {
      expect(() =>
        parseHostedExecutionEvent({
          kind: "telegram.message.received",
          telegramMessage: {
            messageId: "message_123",
            schema: "murph.hosted-telegram-message.v2",
            threadId: "thread_123",
          },
          userId: "user_123",
        }),
      ).toThrow(/telegramMessage\.schema is unsupported/i);

      expect(() =>
        parseHostedExecutionEvent({
          kind: "telegram.message.received",
          telegramMessage: {
            attachments: [{
              fileId: "file_123",
              kind: "gif",
            }],
            messageId: "message_123",
            schema: "murph.hosted-telegram-message.v1",
            threadId: "thread_123",
          },
          userId: "user_123",
        }),
      ).toThrow(/supported hosted Telegram attachment kind/i);

      expect(() =>
        parseHostedExecutionEvent({
          kind: "telegram.message.received",
          telegramMessage: {
            messageId: "message_123",
            schema: "murph.hosted-telegram-message.v1",
            text: 42,
            threadId: "thread_123",
          },
          userId: "user_123",
        }),
      ).toThrow(/telegramMessage\.text must be a string or null/i);

      expect(() =>
        parseHostedExecutionEvent({
          kind: "telegram.message.received",
          telegramMessage: {
            attachments: "not-an-array",
            messageId: "message_123",
            schema: "murph.hosted-telegram-message.v1",
            threadId: "thread_123",
          },
          userId: "user_123",
        }),
      ).toThrow(/telegramMessage\.attachments must be an array/i);
    });
  });
});
