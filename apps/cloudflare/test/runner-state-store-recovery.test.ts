import { describe, expect, it } from "vitest";

import {
  resolveActiveInvocationRecoveryDecision,
} from "../src/user-runner/runner-state-store.js";

describe("resolveActiveInvocationRecoveryDecision", () => {
  const baseInput = {
    heartbeatStaleMs: 5_000,
    nowMs: Date.parse("2026-04-27T00:00:10.000Z"),
    readyTimeoutMs: 5_000,
    timeoutMs: 60_000,
  };

  it.each([
    {
      expected: {
        kind: "live",
        nextRecoveryAt: "2026-04-27T00:00:13.000Z",
        reason: "starting",
      },
      input: {
        startedAt: "2026-04-27T00:00:08.000Z",
      },
      name: "keeps a startup without a heartbeat live before the ready timeout",
    },
    {
      expected: {
        kind: "recover",
        reason: "startup_timeout",
      },
      input: {
        startedAt: "2026-04-27T00:00:00.000Z",
      },
      name: "recovers a startup without a heartbeat after the ready timeout",
    },
    {
      expected: {
        kind: "live",
        nextRecoveryAt: "2026-04-27T00:00:13.000Z",
        reason: "heartbeating",
      },
      input: {
        lastHeartbeatAt: "2026-04-27T00:00:08.000Z",
        startedAt: "2026-04-27T00:00:00.000Z",
      },
      name: "keeps a recent heartbeat live",
    },
    {
      expected: {
        kind: "recover",
        reason: "heartbeat_stale",
      },
      input: {
        lastHeartbeatAt: "2026-04-27T00:00:04.000Z",
        startedAt: "2026-04-27T00:00:00.000Z",
      },
      name: "recovers a stale heartbeat",
    },
    {
      expected: {
        kind: "recover",
        reason: "hard_timeout",
      },
      input: {
        expiresAt: "2026-04-27T00:00:09.000Z",
        lastHeartbeatAt: "2026-04-27T00:00:08.000Z",
        startedAt: "2026-04-27T00:00:00.000Z",
      },
      name: "recovers hard timeout before the heartbeat deadline",
    },
    {
      expected: {
        kind: "recover",
        reason: "container_stopped",
      },
      input: {
        containerStopped: true,
        lastHeartbeatAt: "2026-04-27T00:00:08.000Z",
        startedAt: "2026-04-27T00:00:00.000Z",
      },
      name: "recovers container stopped immediately",
    },
    {
      expected: {
        kind: "live",
        nextRecoveryAt: "2026-04-27T00:00:13.000Z",
        reason: "heartbeating",
      },
      input: {
        activeWorkerVersionId: "worker-old",
        currentWorkerVersionId: "worker-new",
        lastHeartbeatAt: "2026-04-27T00:00:08.000Z",
        startedAt: "2026-04-27T00:00:00.000Z",
      },
      name: "does not let worker version mismatch bypass a recent heartbeat",
    },
    {
      expected: {
        kind: "recover",
        reason: "worker_version_mismatch",
      },
      input: {
        activeWorkerVersionId: "worker-old",
        currentWorkerVersionId: "worker-new",
        lastHeartbeatAt: "2026-04-27T00:00:04.000Z",
        startedAt: "2026-04-27T00:00:00.000Z",
      },
      name: "recovers worker version mismatch when no heartbeat is recent",
    },
  ])("$name", ({ expected, input }) => {
    expect(resolveActiveInvocationRecoveryDecision({
      ...baseInput,
      ...input,
    })).toEqual(expected);
  });
});
