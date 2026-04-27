import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedExecutionJobRunner,
} from "../src/node-runner.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

describe("runHostedExecutionJob abort forwarding", () => {
  const runHostedAssistantRuntimeJobIsolated = vi.fn();
  let runHostedExecutionJob = createHostedExecutionJobRunner();

  beforeEach(() => {
    runHostedAssistantRuntimeJobIsolated.mockReset();
    runHostedExecutionJob = createHostedExecutionJobRunner({
      runIsolated: runHostedAssistantRuntimeJobIsolated,
    });
    for (const [key, value] of Object.entries(createHostedExecutionTestEnv())) {
      if (typeof value === "string") {
        vi.stubEnv(key, value);
      }
    }
    runHostedAssistantRuntimeJobIsolated.mockResolvedValue({
      nextWakeAt: null,
      redactedStatus: {
        importedCount: 0,
      },
      status: "idle",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("forwards abort signals into isolated hosted runs", async () => {
    const controller = new AbortController();

    await runHostedExecutionJob({
      kind: "workspace-run",
      request: {
        attemptId: "attempt_abort_forwarding",
        leaseGeneration: "1",
        reason: "nudge",
        userId: "member_abort_forwarding",
        workspaceVersion: "0",
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
