import { describe, expect, it } from "vitest";

import { TEST_HOSTED_SHARE_PACK } from "./test-fixtures.ts";
import {
  buildHostedExecutionRuntimeTimerWake,
} from "../src/builders.ts";
import {
  parseHostedExecutionEvent,
  parseHostedExecutionRunnerRequest,
  parseHostedExecutionRunnerResult,
  parseHostedExecutionSharePack,
  parseHostedExecutionTimelineEntries,
  parseHostedRuntimeEvent,
  parseHostedRunDrainResult,
  parseHostedRunNudgeResult,
  parseHostedExecutionUserStatus,
  parseHostedRunAcquireRequest,
  parseHostedRunFinalizeRequest,
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
    it("parses run-shaped runner requests with run context", () => {
      expect(parseHostedExecutionRunnerRequest({
        bundle: "bundle-ref-123",
        currentBundleRef: TEST_BUNDLE_REF,
        run: {
          attempt: 2,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_123",
          triggerKind: "runtime_timer",
          userId: "user_123",
        },
      })).toEqual({
        bundle: "bundle-ref-123",
        currentBundleRef: TEST_BUNDLE_REF,
        run: {
          attempt: 2,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_123",
          triggerKind: "runtime_timer",
          userId: "user_123",
        },
      });
    });

    it("parses internal runtime.timer wakes without widening the ingress contract", () => {
      expect(parseHostedRuntimeEvent({
        eventId: "hosted-run:run_123",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "user_123",
      })).toEqual(buildHostedExecutionRuntimeTimerWake({
        eventId: "hosted-run:run_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "user_123",
      }));
    });

    it("rejects the removed assistant cron runner-wake shape", () => {
      expect(() => parseHostedRuntimeEvent({
        eventId: "evt_removed_timer",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        userId: "user_123",
      })).toThrow(/wake kind/i);
    });

    it("parses hydrated share packs on run-drain events", () => {
      expect(parseHostedExecutionRunnerRequest({
        bundle: null,
        run: {
          attempt: 1,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [
            {
              seq: "24",
              sharePack: {
                ownerUserId: "owner_123",
                pack: TEST_HOSTED_SHARE_PACK,
                shareId: "share_123",
              },
              wake: {
                eventId: "evt_123",
                kind: "vault.share.accepted",
                occurredAt: "2026-04-08T00:00:00.000Z",
                share: {
                  ownerUserId: "owner_123",
                  shareId: "share_123",
                },
                userId: "user_123",
              },
              ingressEventId: "wake_24",
            },
          ],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_123",
          triggerKind: "external_ingress",
          userId: "user_123",
        },
      })).toEqual({
        bundle: null,
        run: {
          attempt: 1,
          runId: "run_123",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [
            {
              seq: "24",
              sharePack: {
                ownerUserId: "owner_123",
                pack: TEST_HOSTED_SHARE_PACK,
                shareId: "share_123",
              },
              wake: {
                eventId: "evt_123",
                kind: "vault.share.accepted",
                occurredAt: "2026-04-08T00:00:00.000Z",
                share: {
                  ownerUserId: "owner_123",
                  shareId: "share_123",
                },
                userId: "user_123",
              },
              ingressEventId: "wake_24",
            },
          ],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_123",
          triggerKind: "external_ingress",
          userId: "user_123",
        },
      });
    });

    it("accepts runtime-timer runner requests and parses nullable acquire fields", () => {
      expect(parseHostedExecutionRunnerRequest({
        bundle: null,
        run: {
          attempt: 1,
          runId: "run_999",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_999",
          triggerKind: "runtime_timer",
          userId: "user_123",
        },
      })).toEqual({
        bundle: null,
        run: {
          attempt: 1,
          runId: "run_999",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_999",
          triggerKind: "runtime_timer",
          userId: "user_123",
        },
      });

      expect(parseHostedRunAcquireRequest({
        executorKind: null,
        limit: null,
        now: null,
        triggerKind: null,
      })).toEqual({
        executorKind: null,
        limit: null,
        now: null,
        triggerKind: null,
      });
    });

    it("rejects legacy top-level wake and sharePack fields", () => {
      expect(() => parseHostedExecutionRunnerRequest({
        bundle: null,
        run: {
          attempt: 1,
          runId: "run_legacy_wake",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_legacy_wake",
          triggerKind: "runtime_timer",
          userId: "user_123",
        },
        wake: {
          eventId: "hosted-run:run_legacy_wake",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "user_123",
        },
      })).toThrow(/request\.wake is no longer supported/u);

      expect(() => parseHostedExecutionRunnerRequest({
        bundle: null,
        run: {
          attempt: 1,
          runId: "run_legacy_share_pack",
          startedAt: "2026-04-08T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_legacy_share_pack",
          triggerKind: "runtime_timer",
          userId: "user_123",
        },
        sharePack: {
          ownerUserId: "owner_123",
          pack: TEST_HOSTED_SHARE_PACK,
          shareId: "share_123",
        },
      })).toThrow(/request\.sharePack is no longer supported/u);
    });

    it("parses runner results", () => {
      expect(parseHostedExecutionRunnerResult({
        bundle: null,
        result: {
          adoptedCleanupTargets: [
            {
              channel: "email",
              eventId: "evt_late_email",
              rawMessageKey: "raw/message/key",
              userId: "user_123",
            },
          ],
          adoptedEventResults: [
            {
              ingressEventId: "wake_late",
              state: "completed",
            },
          ],
          eventsHandled: 3,
          nextWakeAt: "2026-04-08T01:00:00.000Z",
          redactedLogEntries: [
            {
              component: "runtime",
              eventId: "evt_notification",
              level: "warn",
              message: "Hosted assistant notification failed and was skipped so the hosted run can continue.",
              phase: "wake.running",
              redacted: {
                errorCode: "runtime_error",
                notificationRouteChannel: "linq",
              },
            },
          ],
          summary: "Processed queued work.",
        },
      })).toEqual({
        bundle: null,
        result: {
          adoptedCleanupTargets: [
            {
              channel: "email",
              eventId: "evt_late_email",
              rawMessageKey: "raw/message/key",
              userId: "user_123",
            },
          ],
          adoptedEventResults: [
            {
              ingressEventId: "wake_late",
              state: "completed",
            },
          ],
          eventsHandled: 3,
          nextWakeAt: "2026-04-08T01:00:00.000Z",
          redactedLogEntries: [
            {
              component: "runtime",
              eventId: "evt_notification",
              level: "warn",
              message: "Hosted assistant notification failed and was skipped so the hosted run can continue.",
              phase: "wake.running",
              redacted: {
                errorCode: "runtime_error",
                notificationRouteChannel: "linq",
              },
            },
          ],
          summary: "Processed queued work.",
        },
      });
    });

    it("parses hosted run finalize requests", () => {
      expect(parseHostedRunFinalizeRequest({
        finalSnapshotRef: TEST_BUNDLE_REF,
        nextRuntimeWakeAt: "2026-04-08T01:00:00.000Z",
        nextRuntimeWakeReason: "assistant.run",
        redactedSummary: {
          stage: "finalized",
        },
        runId: "run_123",
        runToken: "run_token_123",
      })).toEqual({
        finalSnapshotRef: TEST_BUNDLE_REF,
        nextRuntimeWakeAt: "2026-04-08T01:00:00.000Z",
        nextRuntimeWakeReason: "assistant.run",
        redactedSummary: {
          stage: "finalized",
        },
        runId: "run_123",
        runToken: "run_token_123",
      });
    });

    it("parses share packs for runner-owned hydration only", () => {
      expect(parseHostedExecutionSharePack(TEST_HOSTED_SHARE_PACK)).toEqual(TEST_HOSTED_SHARE_PACK);
    });
  });

  describe("status and timeline parsing", () => {
    it("parses hosted execution user status with run status and timeline", () => {
      const parsed = parseHostedExecutionUserStatus({
        bundleRef: TEST_BUNDLE_REF,
        inFlight: true,
        lastError: "Waiting for runner slot.",
        lastErrorAt: "2026-04-08T00:02:00.000Z",
        lastErrorCode: "runner_busy",
        lastEventId: "evt_123",
        lastRunAt: "2026-04-08T00:01:00.000Z",
        nextWakeAt: "2026-04-08T00:05:00.000Z",
        pendingIngressEventCount: 2,
        run: {
          attempt: 3,
          eventId: "evt_123",
          phase: "wake.running",
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
          phase: "wake.running",
          runId: "run_123",
        }],
        userId: "user_123",
      });

      expect(parsed.run?.phase).toBe("wake.running");
      expect(parsed.timeline?.[0]?.message).toBe("Runner resumed processing.");
    });

    it("parses minimal user status without optional fields", () => {
      expect(parseHostedExecutionUserStatus({
        bundleRef: null,
        inFlight: false,
        lastError: null,
        lastEventId: null,
        lastRunAt: null,
        nextWakeAt: null,
        pendingIngressEventCount: 0,
        userId: "user_123",
      })).toEqual({
        bundleRef: null,
        inFlight: false,
        lastError: null,
        lastEventId: null,
        lastRunAt: null,
        nextWakeAt: null,
        pendingIngressEventCount: 0,
        userId: "user_123",
      });
    });

    it("rejects removed legacy pending wake counts on user status", () => {
      expect(() =>
        parseHostedExecutionUserStatus({
          bundleRef: null,
          inFlight: false,
          lastError: null,
          lastEventId: null,
          lastRunAt: null,
          nextWakeAt: null,
          pendingWakeCount: 1,
          userId: "user_123",
        }),
      ).toThrow(/pendingIngressEventCount/u);
      expect(() =>
        parseHostedExecutionUserStatus({
          bundleRef: null,
          inFlight: false,
          lastError: null,
          lastEventId: null,
          lastRunAt: null,
          nextWakeAt: null,
          pendingIngressEventCount: 1,
          pendingWakeCount: 1,
          userId: "user_123",
        }),
      ).toThrow(/pendingWakeCount/u);
    });

    it("parses dedicated wake drain results", () => {
      expect(parseHostedRunDrainResult({
        committedSeq: "24",
        requestedTargetSeq: "25",
        targetReached: false,
      })).toEqual({
        committedSeq: "24",
        requestedTargetSeq: "25",
        targetReached: false,
      });
    });

    it("parses dedicated wake nudge results", () => {
      expect(parseHostedRunNudgeResult({
        accepted: true,
        alarmScheduled: false,
        alreadyRunning: true,
      })).toEqual({
        accepted: true,
        alarmScheduled: false,
        alreadyRunning: true,
      });
    });

    it("rejects invalid run phases, timeline levels, and wake lifecycle states", () => {
      expect(() =>
        parseHostedExecutionUserStatus({
          bundleRef: null,
          inFlight: true,
          lastError: null,
          lastEventId: null,
          lastRunAt: null,
          nextWakeAt: null,
          pendingIngressEventCount: 1,
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
          phase: "wake.running",
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
          phase: "wake.queued",
          runId: "run_123",
        }]),
      ).toThrow(/timeline entries\[0\]\.phase is invalid/i);
    });
  });

  describe("event variants", () => {
    it("parses member activation and device-sync event payloads", () => {
      const memberEvent = parseHostedExecutionEvent({
        kind: "member.activated",
        memberChannels: DEFAULT_MEMBER_CHANNELS,
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
              resourceId: "sleep",
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
      expect(deviceSyncEvent.kind).toBe("device-sync.wake");
    });

    it("rejects removed provider message event payloads", () => {
      expect(() => parseHostedExecutionEvent({
        kind: "linq.message.received",
        linqMessage: {
          chatId: "chat_123",
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_123",
          parts: [],
        },
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
          kind: "assistant.notification.requested",
          notification: {
            instructions: "Send the Murph signup welcome.",
            route: {
              actorId: null,
              channel: "sms",
              delivery: {
                kind: "thread",
                target: "thread_123",
              },
              identityId: "identity_123",
              threadId: "thread_123",
              threadIsDirect: true,
            },
          },
          userId: "user_123",
        }),
      ).toThrow(/channel is invalid/i);
    });
  });
});
