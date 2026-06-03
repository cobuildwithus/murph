import { describe, expect, it } from "vitest";

import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  shouldNudgeHostedLocalLinqWaitForStatus,
} from "./hosted-local-linq-support.js";

describe("hosted local Linq wait nudge policy", () => {
  it("does not nudge active, errored, or caught-up runner status", () => {
    const now = Date.now();

    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: now - 20_000,
      now,
      status: createStatus({ inFlight: true, lag: "1" }),
    })).toBe(false);
    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: now - 20_000,
      now,
      status: createStatus({ lag: "1", lastErrorCode: "runtime_error" }),
    })).toBe(false);
    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: now - 20_000,
      now,
      status: createStatus({ lag: "0" }),
    })).toBe(false);
    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: now - 20_000,
      now,
      pendingDeliveryFirstObservedAt: now - 20_000,
      status: createStatus({ inFlight: true, lag: "0", pendingDeliveryEffects: 1 }),
    })).toBe(false);
  });

  it("nudges only after mailbox lag has remained recoverable", () => {
    const now = Date.now();

    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: now - 14_999,
      now,
      status: createStatus({ lag: "1" }),
    })).toBe(false);
    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: now - 15_000,
      now,
      status: createStatus({ lag: "1" }),
    })).toBe(true);
  });

  it("nudges after pending delivery effects have remained recoverable", () => {
    const now = Date.now();

    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: null,
      now,
      pendingDeliveryFirstObservedAt: now - 1_999,
      status: createStatus({ lag: "0", pendingDeliveryEffects: 1 }),
    })).toBe(false);
    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: null,
      now,
      pendingDeliveryFirstObservedAt: now - 2_000,
      status: createStatus({ lag: "0", pendingDeliveryEffects: 1 }),
    })).toBe(true);
  });

  it("preserves stale mailbox lag nudges while pending delivery is fresh", () => {
    const now = Date.now();

    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: now - 15_000,
      now,
      pendingDeliveryFirstObservedAt: now - 1,
      status: createStatus({ lag: "1", pendingDeliveryEffects: 1 }),
    })).toBe(true);
  });
});

function createStatus(input: {
  inFlight?: boolean;
  lag: string;
  lastErrorCode?: string | null;
  pendingDeliveryEffects?: number | string;
}): HostedRunnerStatusResponse {
  return {
    inFlight: input.inFlight ?? false,
    lastErrorCode: input.lastErrorCode ?? null,
    mailboxLag: [
      {
        importedSeq: "0",
        lag: input.lag,
        lane: "conversation",
        maxSeq: input.lag === "0" ? "0" : "1",
      },
    ],
    userId: "member_local_linq_wait_policy",
    workspace: input.pendingDeliveryEffects === undefined
      ? null
      : {
          browserVaultReplicaRef: null,
          checkpointedAt: "2026-05-08T00:00:04.000Z",
          createdAt: "2026-05-08T00:00:00.000Z",
          nextWakeAt: null,
          nextWakeReason: null,
          redactedStatus: {
            hostedOutboxPendingDeliveryEffects: input.pendingDeliveryEffects,
          },
          snapshotRef: null,
          updatedAt: "2026-05-08T00:00:04.000Z",
          userId: "member_local_linq_wait_policy",
          version: "1",
        },
  };
}
