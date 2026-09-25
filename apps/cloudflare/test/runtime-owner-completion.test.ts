import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordHostedRuntimeOwnerCompletion } from "../src/runtime-owner-completion.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: vi.fn() }));
const input = { source: createHostedExecutionTestEnv(), userId: "synthetic-member", attemptId: "attempt-a", generation: "1", result: {} };

describe("native completion publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "updated", owner: null });
  });

  it("publishes settled completion and its scheduling hint in one request", async () => {
    expect(await recordHostedRuntimeOwnerCompletion({ ...input, settledRunnerContainerName: "synthetic-target",
      result: { immediateRecheckRequested: true } })).toBe(true);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledExactlyOnceWith({ source: input.source, userId: input.userId,
      command: { operation: "complete", attemptId: "attempt-a", generation: "1",
        settledRunnerContainerName: "synthetic-target", immediateRecheckRequested: true } });
  });

  it("cannot claim native settlement from an early runtime callback", async () => {
    expect(await recordHostedRuntimeOwnerCompletion(input)).toBe(true);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledExactlyOnceWith({ source: input.source, userId: input.userId,
      command: { operation: "complete", attemptId: "attempt-a", generation: "1",
        settledRunnerContainerName: null, immediateRecheckRequested: false } });
  });

  it("preserves an unknown acknowledgment for native receipt recovery", async () => {
    vi.mocked(commandHostedRuntimeOwner).mockRejectedValueOnce(new Error("synthetic response loss"));
    await expect(recordHostedRuntimeOwnerCompletion({ ...input, settledRunnerContainerName: "synthetic-target" })).rejects.toThrow("response loss");
    expect(commandHostedRuntimeOwner).toHaveBeenCalledOnce();
  });

  it("does not claim completion for a stale attempt", async () => {
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "stale", owner: null });
    expect(await recordHostedRuntimeOwnerCompletion(input)).toBe(false);
  });
});
