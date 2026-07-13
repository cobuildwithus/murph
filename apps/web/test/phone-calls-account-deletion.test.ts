import { describe, expect, it, vi } from "vitest";

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  assertHostedPhoneCallsReadyForAccountDeletionTx,
  HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE,
  HOSTED_PHONE_CALL_ACCOUNT_DELETION_TIMEOUT_MS,
  stopHostedPhoneCallsForAccountDeletion,
} from "@/src/lib/phone-calls/account-deletion";

describe("hosted phone-call account deletion", () => {
  it("does nothing when no active phone calls exist", async () => {
    const store = createStore([]);
    const stopIfActive = vi.fn();

    await stopHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        stopIfActive,
      },
    });

    expect(stopIfActive).not.toHaveBeenCalled();
    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it("stops known calls before reporting an unresolved reservation", async () => {
    const store = createStore([{
      id: "hpc_0",
      providerCallId: "retell_0",
    }, {
      id: "hpc_1",
      providerCallId: null,
    }]);
    const stopIfActive = vi.fn();

    await expect(stopHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        stopIfActive,
      },
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
      retryable: true,
    });
    expect(stopIfActive).toHaveBeenCalledWith("retell_0", {
      signal: expect.any(AbortSignal),
    });
    expect(store.updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: expect.any(Date),
        status: "ended",
      },
      where: {
        id: "hpc_0",
        status: { in: ["starting", "calling", "failed"] },
      },
    });
  });

  it("stops provider calls before marking their local reservations ended", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: "retell_1",
    }]);
    const stopIfActive = vi.fn().mockResolvedValue(undefined);

    await stopHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        stopIfActive,
      },
    });

    expect(stopIfActive).toHaveBeenCalledWith("retell_1", {
      signal: expect.any(AbortSignal),
    });
    expect(store.updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: expect.any(Date),
        status: "ended",
      },
      where: {
        id: "hpc_1",
        status: { in: ["starting", "calling", "failed"] },
      },
    });
    expect(stopIfActive.mock.invocationCallOrder[0]).toBeLessThan(
      store.updateMany.mock.invocationCallOrder[0]!,
    );
  });

  it("fails retryably and leaves local authority intact when provider cleanup fails", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: "retell_1",
    }]);
    const providerError = new Error("provider unavailable");

    await expect(stopHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        stopIfActive: vi.fn().mockRejectedValue(providerError),
      },
    })).rejects.toSatisfy((error: unknown) =>
      error instanceof HostedOnboardingError
      && error.code === "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED"
      && error.cause === providerError
      && error.retryable,
    );
    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it("keeps failed cleanup authority failed after stopping the provider call", async () => {
    const store = createStore([{
      id: "hpc_1",
      providerCallId: "retell_1",
      status: "failed",
    }]);
    const stopIfActive = vi.fn().mockResolvedValue(undefined);

    await stopHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        stopIfActive,
      },
    });

    expect(stopIfActive).toHaveBeenCalledWith("retell_1", {
      signal: expect.any(AbortSignal),
    });
    expect(store.updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: expect.any(Date),
        status: "failed",
      },
      where: {
        id: "hpc_1",
        status: { in: ["starting", "calling", "failed"] },
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

    await stopHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall,
        stopIfActive: vi.fn(),
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

  it("stops a stale provider call recovered by metadata before account deletion", async () => {
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
    const stopIfActive = vi.fn().mockResolvedValue(undefined);

    await stopHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall,
        stopIfActive,
      },
    });

    expect(resolveProviderCall).toHaveBeenCalledWith("hpc_1", {
      signal: expect.any(AbortSignal),
    });
    expect(stopIfActive).toHaveBeenCalledWith("retell_recovered", {
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
        providerCallId: "retell_recovered",
        status: "ended",
      },
      where: {
        id: "hpc_1",
        status: { in: ["starting", "calling", "failed"] },
      },
    });
  });

  it("stops only one deterministic batch before asking the deletion owner to retry", async () => {
    const calls = Array.from(
      { length: HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE + 1 },
      (_, index) => ({
        id: `hpc_${index}`,
        providerCallId: `retell_${index}`,
      }),
    );
    const store = createStore(calls);
    const stopIfActive = vi.fn().mockResolvedValue(undefined);

    await expect(stopHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: {
        resolveProviderCall: vi.fn(),
        stopIfActive,
      },
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
      retryable: true,
    });

    expect(stopIfActive).toHaveBeenCalledTimes(HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE);
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
      const stopIfActive = vi.fn(async (_providerCallId: string, options?: {
        signal?: AbortSignal;
      }) => await new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(options.signal?.reason);
        }, { once: true });
      }));
      const cleanup = stopHostedPhoneCallsForAccountDeletion({
        memberIds: ["member_1"],
        prisma: store.prisma,
        runtime: {
          resolveProviderCall: vi.fn(),
          stopIfActive,
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

  it("blocks the final transaction while any phone-call authority is active", async () => {
    const store = createStore([], 1);

    await expect(assertHostedPhoneCallsReadyForAccountDeletionTx({
      memberIds: ["member_1"],
      prisma: store.prisma,
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
      retryable: true,
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
      updateMany,
    },
  };

  return {
    findMany: prisma.hostedPhoneCall.findMany,
    prisma: prisma as Parameters<typeof stopHostedPhoneCallsForAccountDeletion>[0]["prisma"],
    updateMany,
  };
}
