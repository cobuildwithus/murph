import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  checkpoint: vi.fn(),
  requireOwner: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ $transaction: mocks.transaction }),
}));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({
  requireHostedRuntimeCallbackTx: mocks.requireOwner,
}));
vi.mock("@/src/lib/hosted-workspace/store", () => ({
  checkpointHostedWorkspaceTx: mocks.checkpoint,
}));

import { checkpointHostedRuntimeWorkspace } from "@/src/lib/hosted-workspace/runtime-publication";
import { recordPrismaOperationTiming } from "@/src/lib/prisma-operation-timing";

describe("slow workspace checkpoint diagnostics", () => {
  const input = {
    userId: "member_synthetic_checkpoint",
    runtimeAuthority: null,
    expectedVersion: "0",
    reason: "canonical_runtime_commit" as const,
    snapshotRef: null,
  };
  const result = { status: "conflict", workspace: null };
  let now = 0;

  beforeEach(() => {
    vi.resetAllMocks();
    now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.requireOwner.mockResolvedValue(null);
    mocks.checkpoint.mockResolvedValue(result);
    mocks.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) => {
      now += 200;
      const value = await callback({});
      now += 100;
      return value;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("separates acquisition, database operations, callback, and commit without logging inputs", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.checkpoint.mockImplementation(async () => {
      now += 1_500;
      recordPrismaOperationTiming("HostedWorkspace.updateMany", 1_450);
      return result;
    });

    await expect(checkpointHostedRuntimeWorkspace(input)).resolves.toBe(result);
    expect(log).toHaveBeenCalledExactlyOnceWith("Hosted workspace slow checkpoint database timing.", {
      completed: true,
      totalMs: 1_800,
      transactionAcquireMs: 200,
      transactionCallbackMs: 1_500,
      transactionFinishMs: 100,
      dbOperationCount: 1,
      dbTotalMs: 1_450,
      "db00.HostedWorkspace.updateMany": 1_450,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(input.userId);
  });

  it("leaves fast checkpoints quiet", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(checkpointHostedRuntimeWorkspace(input)).resolves.toBe(result);
    expect(log).not.toHaveBeenCalled();
  });

  it("preserves a failed checkpoint even if diagnostic output fails", async () => {
    const failure = new Error("Synthetic checkpoint failure");
    const log = vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("Synthetic logging failure");
    });
    mocks.checkpoint.mockImplementation(async () => {
      now += 1_500;
      throw failure;
    });
    await expect(checkpointHostedRuntimeWorkspace(input)).rejects.toBe(failure);
    expect(log).toHaveBeenCalledWith("Hosted workspace slow checkpoint database timing.", expect.objectContaining({
      completed: false,
      totalMs: 1_700,
      transactionAcquireMs: 200,
      transactionCallbackMs: 1_500,
      transactionFinishMs: 0,
    }));
  });
});
