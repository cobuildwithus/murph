import { describe, expect, it } from "vitest";

import { TEST_HOSTED_SHARE_PACK } from "./test-fixtures.ts";
import {
  parseHostedExecutionEvent,
  parseHostedWakeExecutionResult,
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
const DEFAULT_MEMBER_CHANNELS = {
  email: false,
  linq: false,
  telegram: false,
} as const;

describe("hosted execution parsers coverage", () => {
  describe("runner request validation", () => {
    it("parses non-share runner requests with run context", () => {
      expect(parseHostedExecutionRunnerRequest({
        bundle: "bundle-ref-123",
        run: {
          attempt: 2,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
        wake: {
          eventId: "evt_123",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "manual",
          userId: "user_123",
        },
      })).toEqual({
        bundle: "bundle-ref-123",
        run: {
          attempt: 2,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
        wake: {
          eventId: "evt_123",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "manual",
          userId: "user_123",
        },
      });
    });

    it("rejects share packs on non-share wakes", () => {
      expect(() =>
        parseHostedExecutionRunnerRequest({
          bundle: null,
          sharePack: {
            ownerUserId: "user_123",
            pack: TEST_HOSTED_SHARE_PACK,
            shareId: "share_123",
          },
          wake: {
            eventId: "evt_123",
            kind: "assistant.cron.tick",
            occurredAt: "2026-04-08T00:00:00.000Z",
            reason: "alarm",
            userId: "user_123",
          },
        }),
      ).toThrow(/sharePack is only supported/i);
    });

    it("rejects mismatched share-pack owner and share ids", () => {
      const baseRequest = {
        bundle: null,
        sharePack: {
          ownerUserId: "owner_999",
          pack: TEST_HOSTED_SHARE_PACK,
          shareId: "share_123",
        },
        wake: {
          eventId: "evt_123",
          kind: "vault.share.accepted" as const,
          occurredAt: "2026-04-08T00:00:00.000Z",
          share: {
            ownerUserId: "owner_123",
            shareId: "share_123",
          },
          userId: "user_123",
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

    it("parses share packs for runner-owned hydration only", () => {
      expect(parseHostedExecutionSharePack(TEST_HOSTED_SHARE_PACK)).toEqual(TEST_HOSTED_SHARE_PACK);
    });
  });

  describe("status and timeline parsing", () => {
    it("parses dispatch results with run status and timeline", () => {
      const parsed = parseHostedWakeExecutionResult({
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

      expect(parsed.event.state).toBe("backpressured");
      expect(parsed.status.run?.phase).toBe("dispatch.running");
      expect(parsed.status.timeline?.[0]?.message).toBe("Runner resumed processing.");
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

    it("rejects invalid run phases, timeline levels, and dispatch lifecycle states", () => {
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
        parseHostedWakeExecutionResult({
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
      ).toThrow(/Unsupported hosted wake lifecycle state/i);
    });
  });

  describe("event variants", () => {
    it("parses member activation, cron, and device-sync event payloads", () => {
      const memberEvent = parseHostedExecutionEvent({
        firstContact: {
          channel: "telegram",
          identityId: "identity_123",
          threadId: "thread_123",
          threadIsDirect: true,
        },
        kind: "member.activated",
        memberChannels: DEFAULT_MEMBER_CHANNELS,
        userId: "user_123",
      });
      const cronEvent = parseHostedExecutionEvent({
        kind: "assistant.cron.tick",
        reason: "device-sync",
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
        userId: "user_123",
      });

      expect(memberEvent.kind).toBe("member.activated");
      expect(cronEvent).toEqual({
        kind: "assistant.cron.tick",
        reason: "device-sync",
        userId: "user_123",
      });
      expect(deviceSyncEvent.kind).toBe("device-sync.wake");
    });

    it("rejects removed provider message event payloads", () => {
      expect(() => parseHostedExecutionEvent({
        kind: "linq.message.received",
        linqEvent: {
          eventId: "linq_evt_123",
        },
        linqMessageId: null,
        phoneLookupKey: "phone_lookup_123",
        userId: "user_123",
      })).toThrow(/Unsupported hosted execution event kind/i);

      expect(() => parseHostedExecutionEvent({
        identityId: null,
        kind: "email.message.received",
        rawMessageKey: "raw_123",
        selfAddress: null,
        userId: "user_123",
      })).toThrow(/Unsupported hosted execution event kind/i);
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
          memberChannels: DEFAULT_MEMBER_CHANNELS,
          userId: "user_123",
        }),
      ).toThrow(/firstContact channel is invalid/i);
    });
  });
});
