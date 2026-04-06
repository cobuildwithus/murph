import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runHostedExecutionJob,
  setHostedExecutionIsolatedRunnerForTests,
  setHostedExecutionRunModeForTests,
} from "../src/node-runner.ts";

describe("runHostedExecutionJob abort forwarding", () => {
  const runHostedAssistantRuntimeJobIsolated = vi.fn();

  beforeEach(() => {
    setHostedExecutionRunModeForTests(null);
    setHostedExecutionIsolatedRunnerForTests(runHostedAssistantRuntimeJobIsolated);
    runHostedAssistantRuntimeJobIsolated.mockReset();
    runHostedAssistantRuntimeJobIsolated.mockResolvedValue({
      bundles: {
        agentState: null,
        vault: null,
      },
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "ok",
      },
    });
  });

  afterEach(() => {
    setHostedExecutionIsolatedRunnerForTests(null);
    setHostedExecutionRunModeForTests(null);
  });

  it("forwards abort signals into isolated hosted runs", async () => {
    const controller = new AbortController();

    await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_abort_forwarding",
        },
        eventId: "evt_abort_forwarding",
        occurredAt: "2026-03-29T10:45:00.000Z",
      },
    }, {
      signal: controller.signal,
    });

    expect(runHostedAssistantRuntimeJobIsolated).toHaveBeenCalledTimes(1);
    const isolatedCall = runHostedAssistantRuntimeJobIsolated.mock.calls[0];
    expect(isolatedCall?.[1]).toEqual({
      signal: controller.signal,
    });
  });
});
