import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assistantRuntimeMocks = vi.hoisted(() => ({
  runHostedAssistantRuntimeJobInProcess: vi.fn(),
  runHostedAssistantRuntimeJobIsolated: vi.fn(),
}));

vi.mock("@murphai/assistant-runtime", () => ({
  readHostedRunnerCommitTimeoutMs: (timeoutMs: number | null) => timeoutMs ?? 30_000,
  runHostedAssistantRuntimeJobInProcess: assistantRuntimeMocks.runHostedAssistantRuntimeJobInProcess,
  runHostedAssistantRuntimeJobIsolated: assistantRuntimeMocks.runHostedAssistantRuntimeJobIsolated,
}));

import {
  runHostedExecutionJob,
  setHostedExecutionRunModeForTests,
} from "../src/node-runner.ts";

describe("runHostedExecutionJob abort forwarding", () => {
  beforeEach(() => {
    setHostedExecutionRunModeForTests(null);
    assistantRuntimeMocks.runHostedAssistantRuntimeJobInProcess.mockReset();
    assistantRuntimeMocks.runHostedAssistantRuntimeJobIsolated.mockReset();
    assistantRuntimeMocks.runHostedAssistantRuntimeJobIsolated.mockResolvedValue({
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

    expect(assistantRuntimeMocks.runHostedAssistantRuntimeJobInProcess).not.toHaveBeenCalled();
    expect(assistantRuntimeMocks.runHostedAssistantRuntimeJobIsolated).toHaveBeenCalledTimes(1);
    const isolatedCall = assistantRuntimeMocks.runHostedAssistantRuntimeJobIsolated.mock.calls[0];
    expect(isolatedCall?.[1]).toEqual({
      signal: controller.signal,
    });
  });
});
