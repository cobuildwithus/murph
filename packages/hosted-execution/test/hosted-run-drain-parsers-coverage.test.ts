import { describe, expect, it } from "vitest";

import { buildHostedExecutionAssistantCronTickWake } from "../src/builders.ts";
import { HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA } from "../src/contracts.ts";
import {
  parseHostedExecutionRunnerRequest,
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
        events: [
          {
            seq: "24",
            sharePack: null,
            wake: buildHostedExecutionAssistantCronTickWake({
              eventId: "evt_123",
              occurredAt: "2026-04-08T00:00:00.000Z",
              reason: "manual",
              userId: "user_123",
            }),
            wakeId: "wake_24",
          },
        ],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        resumeFinalize: true,
        runId: "run_123",
        triggerKind: "runtime_timer",
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
      runDrain: {
        acquiredAt: "2026-04-08T00:00:00.000Z",
        events: [
          {
            seq: "24",
            sharePack: null,
            wake: buildHostedExecutionAssistantCronTickWake({
              eventId: "evt_123",
              occurredAt: "2026-04-08T00:00:00.000Z",
              reason: "manual",
              userId: "user_123",
            }),
            wakeId: "wake_24",
          },
        ],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        resumeFinalize: true,
        runId: "run_123",
        triggerKind: "runtime_timer",
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

  it("parses hosted run requests that include commit failure fields", () => {
    expect(parseHostedRunCommitRequest({
      expectedCursorVersion: "4",
      failureClass: "timeout",
      failureCode: "request_timeout",
      finalizeRequired: null,
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
      finalizeRequired: null,
      nextRuntimeWakeAt: null,
      nextRuntimeWakeReason: null,
      outputCommittedSeq: "25",
      preparedSnapshotRef: TEST_SNAPSHOT_REF,
      redactedSummary: null,
      runId: "run-1",
      runToken: "run_token_123",
    });
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
          payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
          seq: "12",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member-1",
        },
      ],
      pendingWakeCount: 0,
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
          payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
          seq: "12",
          updatedAt: "2026-04-17T00:00:00.000Z",
          userId: "member-1",
        },
      ],
      pendingWakeCount: 0,
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
      pendingWakeCount: 0,
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
      pendingWakeCount: 0,
      run: null,
      runs: [],
    });
  });
});
