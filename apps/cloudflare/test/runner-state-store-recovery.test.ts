import { describe, expect, it } from "vitest";

import {
  resolveActiveInvocationRecoveryDecision,
} from "../src/user-runner/runner-state-store.js";

describe("resolveActiveInvocationRecoveryDecision", () => {
  it("is inert after active-invocation recovery moved to write-fence expiry", () => {
    expect(resolveActiveInvocationRecoveryDecision({
      activeWorkerVersionId: "worker-old",
      containerStopped: true,
      currentWorkerVersionId: "worker-new",
      expiresAt: "2030-04-27T00:00:09.000Z",
      heartbeatStaleMs: 5_000,
      lastHeartbeatAt: "2030-04-27T00:00:04.000Z",
      nowMs: Date.parse("2030-04-27T00:00:10.000Z"),
      readyTimeoutMs: 5_000,
      startedAt: "2030-04-27T00:00:00.000Z",
      timeoutMs: 60_000,
    })).toEqual({ action: "none" });
  });
});
