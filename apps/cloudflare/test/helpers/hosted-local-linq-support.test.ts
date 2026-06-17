import { describe, expect, it } from "vitest";

import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  shouldExpireHostedLocalLinqWaitInFlightForStatus,
  shouldNudgeHostedLocalLinqWaitForStatus,
  shouldRunHostedLocalLinqWaitAlarmInvocationForStatus,
} from "./hosted-local-linq-support.js";

describe("hosted local Linq wait recovery policy", () => {
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
      status: createStatus({ inFlight: true, lag: "0", pendingDeliveryEffects: 1 }),
    })).toBe(false);
    expect(shouldRunHostedLocalLinqWaitAlarmInvocationForStatus({
      now,
      pendingDeliveryFirstObservedAt: now - 20_000,
      status: createStatus({
        inFlight: true,
        lag: "0",
        nextWakeAt: new Date(now - 1).toISOString(),
        pendingDeliveryEffects: 1,
      }),
    })).toBe(false);
    expect(shouldExpireHostedLocalLinqWaitInFlightForStatus({
      now,
      status: createStatus({
        inFlight: false,
        lag: "0",
        lastInvocationAt: new Date(now - 30_000).toISOString(),
      }),
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

  it("runs an alarm invocation after pending delivery effects have remained recoverable and due", () => {
    const now = Date.now();

    expect(shouldRunHostedLocalLinqWaitAlarmInvocationForStatus({
      now,
      pendingDeliveryFirstObservedAt: now - 1_999,
      status: createStatus({
        lag: "0",
        nextWakeAt: new Date(now - 1).toISOString(),
        pendingDeliveryEffects: 1,
      }),
    })).toBe(false);
    expect(shouldRunHostedLocalLinqWaitAlarmInvocationForStatus({
      now,
      pendingDeliveryFirstObservedAt: now - 2_000,
      status: createStatus({
        lag: "0",
        nextWakeAt: new Date(now + 1).toISOString(),
        pendingDeliveryEffects: 1,
      }),
    })).toBe(false);
    expect(shouldRunHostedLocalLinqWaitAlarmInvocationForStatus({
      now,
      pendingDeliveryFirstObservedAt: now - 2_000,
      status: createStatus({
        lag: "0",
        nextWakeAt: new Date(now).toISOString(),
        pendingDeliveryEffects: 1,
      }),
    })).toBe(true);
    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: null,
      now,
      status: createStatus({ lag: "0", pendingDeliveryEffects: 1 }),
    })).toBe(false);
  });

  it("preserves stale mailbox lag nudges while pending delivery recovery is fresh", () => {
    const now = Date.now();

    expect(shouldNudgeHostedLocalLinqWaitForStatus({
      mailboxLagFirstObservedAt: now - 15_000,
      now,
      status: createStatus({ lag: "1", pendingDeliveryEffects: 1 }),
    })).toBe(true);
    expect(shouldRunHostedLocalLinqWaitAlarmInvocationForStatus({
      now,
      pendingDeliveryFirstObservedAt: now - 1,
      status: createStatus({
        lag: "1",
        nextWakeAt: new Date(now - 1).toISOString(),
        pendingDeliveryEffects: 1,
      }),
    })).toBe(false);
  });

  it("expires stale in-flight status only when activity is old enough", () => {
    const now = Date.parse("2026-05-08T00:00:30.000Z");

    expect(shouldExpireHostedLocalLinqWaitInFlightForStatus({
      now,
      status: createStatus({
        inFlight: true,
        lag: "0",
        lastInvocationAt: "2026-05-08T00:00:00.001Z",
      }),
    })).toBe(false);
    expect(shouldExpireHostedLocalLinqWaitInFlightForStatus({
      now,
      status: createStatus({
        inFlight: true,
        lag: "0",
        lastErrorCode: "runtime_error",
        lastInvocationAt: "2026-05-08T00:00:00.000Z",
      }),
    })).toBe(true);
    expect(shouldExpireHostedLocalLinqWaitInFlightForStatus({
      now,
      status: createStatus({
        inFlight: true,
        lag: "0",
        lastInvocationAt: "2026-05-08T00:00:00.000Z",
      }),
    })).toBe(true);
    expect(shouldExpireHostedLocalLinqWaitInFlightForStatus({
      now,
      status: createStatus({
        heartbeatAt: "2026-05-08T00:00:29.000Z",
        inFlight: true,
        lag: "0",
        lastInvocationAt: "2026-05-08T00:00:00.000Z",
      }),
    })).toBe(false);
  });
});

function createStatus(input: {
  heartbeatAt?: string | null;
  inFlight?: boolean;
  lag: string;
  lastInvocationAt?: string | null;
  lastErrorCode?: string | null;
  nextWakeAt?: string | null;
  pendingDeliveryEffects?: number | string;
}): HostedRunnerStatusResponse {
  return {
    ...(input.heartbeatAt === undefined ? {} : { heartbeatAt: input.heartbeatAt }),
    inFlight: input.inFlight ?? false,
    ...(input.lastInvocationAt === undefined ? {} : { lastInvocationAt: input.lastInvocationAt }),
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
          nextWakeAt: input.nextWakeAt ?? null,
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
