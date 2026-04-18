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
    vi.unstubAllEnvs();
  });

  it("forwards abort signals into isolated hosted runs", async () => {
    const controller = new AbortController();

    await runHostedExecutionJob({
      request: {
        bundle: null,
        dispatch: {
          event: {
            kind: "member.activated",
            memberChannels: {
              email: false,
              linq: false,
              telegram: false,
            },
            userId: "member_abort_forwarding",
          },
          eventId: "evt_abort_forwarding",
          occurredAt: "2026-03-29T10:45:00.000Z",
        },
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
