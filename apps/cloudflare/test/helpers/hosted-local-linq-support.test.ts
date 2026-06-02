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
});

function createStatus(input: {
  inFlight?: boolean;
  lag: string;
  lastErrorCode?: string | null;
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
    workspace: null,
  };
}
