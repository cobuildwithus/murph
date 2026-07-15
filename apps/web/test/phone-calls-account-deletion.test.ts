import { describe, expect, it, vi } from "vitest";

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  assertHostedPhoneCallsReadyForAccountDeletionTx,
  HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE,
  HOSTED_PHONE_CALL_ACCOUNT_DELETION_TIMEOUT_MS,
  deleteHostedPhoneCallsForAccountDeletion,
} from "@/src/lib/phone-calls/account-deletion";

describe("hosted phone-call account deletion", () => {
  it("does nothing when no phone-call provider data exists", async () => {
    const store = createStore([]);
    const deleteProviderCall = vi.fn();

    await deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        deleteProviderCall,
      },
    });

    expect(deleteProviderCall).not.toHaveBeenCalled();
    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it("deletes known calls before reporting an unresolved reservation", async () => {
    const store = createStore([{
      id: "hpc_0",
      providerCallId: "retell_0",
    }, {
      id: "hpc_1",
      providerCallId: null,
    }]);
    const deleteProviderCall = vi.fn();

    await expect(deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        deleteProviderCall,
      },
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
      retryable: true,
    });
    expect(deleteProviderCall).toHaveBeenCalledWith("retell_0", {
      signal: expect.any(AbortSignal),
    });
    expect(store.updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: expect.any(Date),
        providerCallId: null,
        status: "ended",
      },
      where: {
        id: "hpc_0",
        providerCallId: "retell_0",
      },
    });
  });

  it("deletes provider calls before clearing their local retry ownership", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: "retell_1",
    }]);
    const deleteProviderCall = vi.fn().mockResolvedValue(undefined);

    await deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        deleteProviderCall,
      },
    });

    expect(deleteProviderCall).toHaveBeenCalledWith("retell_1", {
      signal: expect.any(AbortSignal),
    });
    expect(store.updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: expect.any(Date),
        providerCallId: null,
        status: "ended",
      },
      where: {
        id: "hpc_1",
        providerCallId: "retell_1",
      },
    });
    expect(deleteProviderCall.mock.invocationCallOrder[0]).toBeLessThan(
      store.updateMany.mock.invocationCallOrder[0]!,
    );
  });

  it("deletes terminal provider calls without rewriting their terminal state", async () => {
    const store = createStore([{
      id: "hpc_terminal",
      providerCallId: "retell_terminal",
      status: "completed",
    }]);
    const deleteProviderCall = vi.fn().mockResolvedValue(undefined);

    await deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        deleteProviderCall,
        resolveProviderCall: vi.fn(),
      },
    });

    expect(deleteProviderCall).toHaveBeenCalledWith("retell_terminal", {
      signal: expect.any(AbortSignal),
    });
    expect(store.updateMany).toHaveBeenCalledWith({
      data: { providerCallId: null },
      where: {
        id: "hpc_terminal",
        providerCallId: "retell_terminal",
      },
    });
    expect(store.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        memberId: { in: ["member_1"] },
        provider: "retell",
        OR: [
          { providerCallId: { not: null } },
          { status: { in: ["starting", "calling"] } },
        ],
      },
    }));
  });

  it("fails retryably and leaves local authority intact when provider cleanup fails", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: "retell_1",
    }]);
    const providerError = new Error("provider unavailable");

    await expect(deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        deleteProviderCall: vi.fn().mockRejectedValue(providerError),
      },
    })).rejects.toSatisfy((error: unknown) =>
      error instanceof HostedOnboardingError
      && error.code === "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED"
      && error.cause === providerError
      && error.retryable,
    );
    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it("keeps failed cleanup status after deleting the provider call", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: "retell_1",
      status: "failed",
    }]);
    const deleteProviderCall = vi.fn().mockResolvedValue(undefined);

    await deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        deleteProviderCall,
      },
    });

    expect(deleteProviderCall).toHaveBeenCalledWith("retell_1", {
      signal: expect.any(AbortSignal),
    });
    expect(store.updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: expect.any(Date),
        providerCallId: null,
        status: "failed",
      },
      where: {
        id: "hpc_1",
        providerCallId: "retell_1",
      },
    });
  });

  it("fails a stale unbound reservation after Retell proves no matching call", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(0),
    }]);
    const resolveProviderCall = vi.fn().mockResolvedValue({ state: "not_found" });

    await deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall,
        deleteProviderCall: vi.fn(),
      },
    });

    expect(resolveProviderCall).toHaveBeenCalledWith("hpc_1", {
      signal: expect.any(AbortSignal),
    });
    expect(store.updateMany).toHaveBeenCalledWith({
      data: { status: "failed" },
      where: {
        analyzedAt: null,
        endedAt: null,
        id: "hpc_1",
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    });
  });

  it("deletes a stale provider call recovered by metadata before account deletion", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(0),
    }]);
    const resolveProviderCall = vi.fn().mockResolvedValue({
      providerCallId: "retell_recovered",
      state: "found",
    });
    const deleteProviderCall = vi.fn().mockResolvedValue(undefined);

    await deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall,
        deleteProviderCall,
      },
    });

    expect(resolveProviderCall).toHaveBeenCalledWith("hpc_1", {
      signal: expect.any(AbortSignal),
    });
    expect(deleteProviderCall).toHaveBeenCalledWith("retell_recovered", {
      signal: expect.any(AbortSignal),
    });
    expect(store.updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        providerCallId: "retell_recovered",
        status: "calling",
      },
      where: {
        analyzedAt: null,
        endedAt: null,
        id: "hpc_1",
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    });
    expect(store.updateMany).toHaveBeenNthCalledWith(2, {
      data: {
        endedAt: expect.any(Date),
        providerCallId: null,
        status: "ended",
      },
      where: {
        id: "hpc_1",
        providerCallId: "retell_recovered",
      },
    });
  });

  it("does not delete a recovered call when provider-id binding throws", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(0),
    }]);
    const databaseError = new Error("database unavailable");
    store.updateMany.mockRejectedValueOnce(databaseError);
    const deleteProviderCall = vi.fn();

    await expect(deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn().mockResolvedValue({
          providerCallId: "retell_recovered",
          state: "found",
        }),
        deleteProviderCall,
      },
    })).rejects.toSatisfy((error: unknown) =>
      error instanceof HostedOnboardingError
      && error.cause === databaseError,
    );
    expect(deleteProviderCall).not.toHaveBeenCalled();
  });

  it("deletes after a zero-row bind only when the same provider id is already durable", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(0),
    }]);
    store.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    store.findUnique.mockResolvedValueOnce({
      analyzedAt: null,
      endedAt: null,
      id: "hpc_1",
      provider: "retell",
      providerCallId: "retell_recovered",
      status: "calling",
      updatedAt: new Date(),
    });
    const deleteProviderCall = vi.fn().mockResolvedValue(undefined);

    await deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn().mockResolvedValue({
          providerCallId: "retell_recovered",
          state: "found",
        }),
        deleteProviderCall,
      },
    });

    expect(deleteProviderCall).toHaveBeenCalledOnce();
    expect(store.updateMany).toHaveBeenNthCalledWith(2, {
      data: {
        endedAt: expect.any(Date),
        providerCallId: null,
        status: "ended",
      },
      where: {
        id: "hpc_1",
        providerCallId: "retell_recovered",
      },
    });
  });

  it("does not delete stale recovered authority after an incompatible bind race", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(0),
    }]);
    store.updateMany.mockResolvedValueOnce({ count: 0 });
    store.findUnique.mockResolvedValueOnce({
      analyzedAt: null,
      endedAt: null,
      id: "hpc_1",
      provider: "retell",
      providerCallId: "retell_other",
      status: "calling",
      updatedAt: new Date(),
    });
    const deleteProviderCall = vi.fn();

    await expect(deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn().mockResolvedValue({
          providerCallId: "retell_recovered",
          state: "found",
        }),
        deleteProviderCall,
      },
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
      retryable: true,
    });
    expect(deleteProviderCall).not.toHaveBeenCalled();
  });

  it("keeps recovered provider identity durable when terminal persistence fails", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: null,
      status: "starting",
      updatedAt: new Date(0),
    }]);
    const databaseError = new Error("terminal persistence unavailable");
    store.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(databaseError);
    const deleteProviderCall = vi.fn().mockResolvedValue(undefined);

    await expect(deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn().mockResolvedValue({
          providerCallId: "retell_recovered",
          state: "found",
        }),
        deleteProviderCall,
      },
    })).rejects.toSatisfy((error: unknown) =>
      error instanceof HostedOnboardingError
      && error.cause === databaseError,
    );

    expect(store.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ providerCallId: "retell_recovered" }),
    }));
    expect(deleteProviderCall).toHaveBeenCalledWith("retell_recovered", {
      signal: expect.any(AbortSignal),
    });
  });

  it("deletes only one deterministic batch before asking the deletion owner to retry", async () => {
    const calls = Array.from(
      { length: HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE + 1 },
      (_, index) => ({
        id: `hpc_${index}`,
        providerCallId: `retell_${index}`,
      }),
    );
    const store = createStore(calls);
    const deleteProviderCall = vi.fn().mockResolvedValue(undefined);

    await expect(deleteHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        deleteProviderCall,
      },
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
      retryable: true,
    });

    expect(deleteProviderCall).toHaveBeenCalledTimes(HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE);
    expect(store.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE + 1,
    }));
  });

  it("aborts a hung provider cleanup at the aggregate deletion deadline", async () => {
    vi.useFakeTimers();
    try {
      const store = createStore([{
        id: "hpc_1",
        providerCallId: "retell_1",
      }]);
      const deleteProviderCall = vi.fn(async (_providerCallId: string, options?: {
        signal?: AbortSignal;
      }) => await new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(options.signal?.reason);
        }, { once: true });
      }));
      const cleanup = deleteHostedPhoneCallsForAccountDeletion({
        memberIds: ["member_1"],
        prisma: store.prisma,
        runtime: {
          resolveProviderCall: vi.fn(),
          deleteProviderCall,
        },
      });

      await vi.advanceTimersByTimeAsync(HOSTED_PHONE_CALL_ACCOUNT_DELETION_TIMEOUT_MS);
      await expect(cleanup).rejects.toMatchObject({
        code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
        retryable: true,
      });
      expect(store.updateMany).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks the final transaction while provider cleanup ownership remains", async () => {
    const store = createStore([], 1);

    await expect(assertHostedPhoneCallsReadyForAccountDeletionTx({
      memberIds: ["member_1"],
      prisma: store.prisma,
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
      retryable: true,
    });
    expect(store.prisma.hostedPhoneCall.count).toHaveBeenCalledWith({
      where: {
        memberId: { in: ["member_1"] },
        provider: "retell",
        OR: [
          { providerCallId: { not: null } },
          { status: { in: ["starting", "calling"] } },
        ],
      },
    });
  });
});

function createStore(
  calls: Array<{
    id: string;
    providerCallId: string | null;
    status?: "starting" | "calling" | "ended" | "completed" | "needs_user" | "failed";
    updatedAt?: Date;
  }>,
  activeCallCount = 0,
) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    hostedPhoneCall: {
      count: vi.fn().mockResolvedValue(activeCallCount),
      findMany: vi.fn().mockResolvedValue(calls.map((call) => ({
        analyzedAt: null,
        endedAt: null,
        provider: "retell",
        status: call.status ?? (call.providerCallId ? "calling" : "starting"),
        updatedAt: call.updatedAt ?? new Date(),
        ...call,
      }))),
      findUnique: vi.fn(),
      updateMany,
    },
  };

  return {
    findMany: prisma.hostedPhoneCall.findMany,
    findUnique: prisma.hostedPhoneCall.findUnique,
    prisma: prisma as Parameters<typeof deleteHostedPhoneCallsForAccountDeletion>[0]["prisma"],
    updateMany,
  };
}
