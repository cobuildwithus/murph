import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordHostedRuntimeOwnerCompletion } from "../src/runtime-owner-completion.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: vi.fn() }));
vi.mock("../src/web-control-plane.ts", () => ({ fetchHostedExecutionWebControlPlaneResponse: vi.fn() }));
const input = { source: createHostedExecutionTestEnv(), userId: "synthetic-member", attemptId: "attempt-a", generation: "1", result: {} };

describe("native completion publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "updated", owner: null });
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockResolvedValue(Response.json({ ok: true }));
  });

  it("publishes idle ownership before notifying the scheduler when the native invocation settled", async () => {
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockImplementation(async () => {
      expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([call]) => call.command.operation)).toEqual(["retire", "release_completed"]);
      return Response.json({ ok: true });
    });
    expect(await recordHostedRuntimeOwnerCompletion({ ...input, settledRunnerContainerName: "synthetic-target" })).toBe(true);
  });

  it("retains authority for a completion callback that cannot prove native settlement", async () => {
    expect(await recordHostedRuntimeOwnerCompletion(input)).toBe(true);
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([call]) => call.command.operation)).toEqual(["retire"]);
  });

  it("does not claim release or notify after an unknown release acknowledgment", async () => {
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce({ cutover: "postgres", status: "updated", owner: null })
      .mockRejectedValueOnce(new Error("synthetic response loss"));
    await expect(recordHostedRuntimeOwnerCompletion({ ...input, settledRunnerContainerName: "synthetic-target" })).rejects.toThrow("response loss");
    expect(fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
  });
});
