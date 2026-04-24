import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionRuntimeTimerWake,
} from "../src/builders.ts";
import { HOSTED_INGRESS_PAYLOAD_SCHEMA } from "../src/contracts.ts";
import {
  parseHostedExecutionRunnerRequest,
  parseHostedRuntimeEvent,
  parseHostedRunAcquireResponse,
  parseHostedRunCommitRequest,
  parseHostedRunStatusResponse,
} from "../src/parsers.ts";

const TEST_SNAPSHOT_REF = {
  hash: "hash-1",
  key: "bundles/vault/hash-1.bundle.json",
  size: 128,
  updatedAt: "2026-04-17T00:00:01.000Z",
} as const;

describe("hosted run drain parser coverage", () => {
  it("parses runner requests with run-drain payloads", () => {
    expect(parseHostedExecutionRunnerRequest({
      bundle: "bundle-ref-123",
      run: {
        attempt: 2,
        runId: "run_123",
        startedAt: "2026-04-08T00:00:01.000Z",
      },
      runDrain: {
        acquiredAt: "2026-04-08T00:00:00.000Z",
        committedResult: {
          bundle: "committed-bundle-ref-123",
          result: {
            adoptedCleanupTargets: [
              {
                channel: "email",
                eventId: "evt_late_email",
                rawMessageKey: "raw/message/key",
                userId: "user_123",
              },
              {
                channel: "linq",
                messageId: "linq_message_123",
              },
              {
                channel: "telegram",
                messageId: "telegram_message_123",
                target: "telegram_thread_123",
              },
            ],
            adoptedEventResults: [
              {
                ingressEventId: "wake_late",
                state: "completed",
              },
            ],
            eventsHandled: 3,
            nextWakeAt: "2026-04-08T00:05:00.000Z",
            redactedDetails: {
              lane: "maintenance",
            },
            redactedLogEntries: [
              {
                component: "runtime",
                eventId: "evt_123",
                level: "info",
                message: "prepared",
                phase: "commit.recorded",
                redacted: {
                  provider: "device-sync",
                },
              },
            ],
            summary: "Prepared run drain.",
          },
        },
        events: [
          {
            seq: "24",
            sharePack: null,
            wake: buildHostedExecutionDeviceSyncWake({
              eventId: "evt_123",
              occurredAt: "2026-04-08T00:00:00.000Z",
              reason: "connected",
              userId: "user_123",
            }),
            ingressEventId: "wake_24",
          },
        ],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        resumeFinalize: true,
        runId: "run_123",
        triggerKind: "runtime_timer",
        userId: "user_123",
      },
    })).toEqual({
      bundle: "bundle-ref-123",
      run: {
        attempt: 2,
        runId: "run_123",
        startedAt: "2026-04-08T00:00:01.000Z",
      },
      runDrain: {
        acquiredAt: "2026-04-08T00:00:00.000Z",
        committedResult: {
          bundle: "committed-bundle-ref-123",
          result: {
            adoptedCleanupTargets: [
              {
                channel: "email",
                eventId: "evt_late_email",
                rawMessageKey: "raw/message/key",
                userId: "user_123",
              },
              {
                channel: "linq",
                messageId: "linq_message_123",
              },
              {
                channel: "telegram",
                messageId: "telegram_message_123",
                target: "telegram_thread_123",
              },
            ],
            adoptedEventResults: [
              {
                ingressEventId: "wake_late",
                state: "completed",
              },
            ],
            eventsHandled: 3,
            nextWakeAt: "2026-04-08T00:05:00.000Z",
            redactedDetails: {
              lane: "maintenance",
            },
            redactedLogEntries: [
              {
                component: "runtime",
                eventId: "evt_123",
                level: "info",
                message: "prepared",
                phase: "commit.recorded",
                redacted: {
                  provider: "device-sync",
                },
              },
            ],
            summary: "Prepared run drain.",
          },
        },
        events: [
          {
            seq: "24",
            sharePack: null,
            wake: buildHostedExecutionDeviceSyncWake({
              eventId: "evt_123",
              occurredAt: "2026-04-08T00:00:00.000Z",
              reason: "connected",
              userId: "user_123",
            }),
            ingressEventId: "wake_24",
          },
        ],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        resumeFinalize: true,
        runId: "run_123",
        triggerKind: "runtime_timer",
        userId: "user_123",
      },
    });
  });

  it("parses internal runtime.timer wakes without treating them as hosted ingress wakes", () => {
    expect(parseHostedRuntimeEvent({
      eventId: "hosted-run:run_456",
      kind: "runtime.timer",
      occurredAt: "2026-04-08T00:00:00.000Z",
      triggerKind: "runtime_timer",
      userId: "user_123",
    })).toEqual(buildHostedExecutionRuntimeTimerWake({
      eventId: "hosted-run:run_456",
      occurredAt: "2026-04-08T00:00:00.000Z",
      triggerKind: "runtime_timer",
      userId: "user_123",
    }));
  });

  it("rejects legacy top-level runner wake fields", () => {
    expect(() => parseHostedExecutionRunnerRequest({
      bundle: "bundle-ref-123",
      run: {
        attempt: 2,
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
  });

  it("parses hosted run requests that include commit failure fields", () => {
    expect(parseHostedRunCommitRequest({
      expectedCursorVersion: "4",
      failureClass: "timeout",
      failureCode: "request_timeout",
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      nextRuntimeWakeReason: null,
      outputCommittedSeq: "25",
      preparedSnapshotRef: TEST_SNAPSHOT_REF,
      redactedSummary: null,
      runId: "run-1",
      runToken: "run_token_123",
    })).toEqual({
      expectedCursorVersion: "4",
      failureClass: "timeout",
      failureCode: "request_timeout",
      finalizeRequired: false,
      nextRuntimeWakeAt: null,
      nextRuntimeWakeReason: null,
      outputCommittedSeq: "25",
      preparedSnapshotRef: TEST_SNAPSHOT_REF,
      redactedSummary: null,
      runId: "run-1",
      runToken: "run_token_123",
    });
  });

  it("requires finalizeRequired on hosted run commit requests", () => {
    expect(() => parseHostedRunCommitRequest({
      expectedCursorVersion: "4",
      outputCommittedSeq: "25",
      runId: "run-1",
      runToken: "run_token_123",
    })).toThrow(/finalizeRequired/u);
  });

  it("accepts run status responses with optional logs and runs", () => {
    expect(parseHostedRunAcquireResponse({
      acquired: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
        nextRuntimeWakeReason: "assistant.run",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      events: [
        {
          behavior: "ordered",
          createdAt: "2026-04-17T00:00:00.000Z",
          id: "wake-1",
          kind: "member.channels.updated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadBytes: 64,
          payloadCiphertext: "ciphertext:wake-1",
          payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
          seq: "12",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member-1",
        },
      ],
      pendingIngressEventCount: 0,
      resumeFinalize: true,
      run: null,
    })).toEqual({
      acquired: true,
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextRuntimeWakeAt: "2026-04-17T02:00:00.000Z",
        nextRuntimeWakeReason: "assistant.run",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      events: [
        {
          behavior: "ordered",
          createdAt: "2026-04-17T00:00:00.000Z",
          id: "wake-1",
          kind: "member.channels.updated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payloadBytes: 64,
          payloadCiphertext: "ciphertext:wake-1",
          payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
          seq: "12",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member-1",
        },
      ],
      pendingIngressEventCount: 0,
      resumeFinalize: true,
      run: null,
    });

    expect(parseHostedRunStatusResponse({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      logs: [{
        at: "2026-04-17T00:00:00.000Z",
        component: "runtime",
        createdAt: "2026-04-17T00:00:00.000Z",
        id: "log-1",
        level: "info",
        message: "Run status checked.",
        phase: "wake.running",
        runId: "run-1",
        userId: "member-1",
      }],
      pendingIngressEventCount: 0,
      run: null,
      runs: [],
    })).toEqual({
      cursor: {
        committedSeq: "24",
        createdAt: "2026-04-17T00:00:00.000Z",
        nextSeq: "25",
        snapshotRef: TEST_SNAPSHOT_REF,
        updatedAt: "2026-04-17T00:00:01.000Z",
        userId: "member-1",
        version: "4",
      },
      logs: [{
        at: "2026-04-17T00:00:00.000Z",
        component: "runtime",
        createdAt: "2026-04-17T00:00:00.000Z",
        id: "log-1",
        level: "info",
        message: "Run status checked.",
        phase: "wake.running",
        runId: "run-1",
        userId: "member-1",
      }],
      pendingIngressEventCount: 0,
      run: null,
      runs: [],
    });
  });
});
