import { describe, expect, it, vi } from "vitest";

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  assertHostedPhoneCallsReadyForAccountDeletionTx,
  stopHostedPhoneCallsForAccountDeletion,
} from "@/src/lib/phone-calls/account-deletion";

describe("hosted phone-call account deletion", () => {
  it("does nothing when no active phone calls exist", async () => {
    const store = createStore([]);
    const stopIfActive = vi.fn();

    await stopHostedPhoneCallsForAccountDeletion({
      memberIds: ["member_1"],
      prisma: store.prisma,
      runtime: { stopIfActive },
    });

    expect(stopIfActive).not.toHaveBeenCalled();
    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it("preserves local authority when a reservation has no provider id", async () => {
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
      runtime: { stopIfActive },
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
      retryable: true,
    });
    expect(stopIfActive).not.toHaveBeenCalled();
    expect(store.updateMany).not.toHaveBeenCalled();
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
      runtime: { stopIfActive },
    });

    expect(stopIfActive).toHaveBeenCalledWith("retell_1");
    expect(store.updateMany).toHaveBeenCalledWith({
      data: {
        endedAt: expect.any(Date),
        status: "ended",
      },
      where: {
        id: "hpc_1",
        status: { in: ["starting", "calling"] },
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
      runtime: { stopIfActive: vi.fn().mockRejectedValue(providerError) },
    })).rejects.toSatisfy((error: unknown) =>
      error instanceof HostedOnboardingError
      && error.code === "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED"
      && error.cause === providerError
      && error.retryable,
    );
    expect(store.updateMany).not.toHaveBeenCalled();
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
  calls: Array<{ id: string; providerCallId: string | null }>,
  activeCallCount = 0,
) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    hostedPhoneCall: {
      count: vi.fn().mockResolvedValue(activeCallCount),
      findMany: vi.fn().mockResolvedValue(calls),
      updateMany,
    },
  };

  return {
    prisma: prisma as Parameters<typeof stopHostedPhoneCallsForAccountDeletion>[0]["prisma"],
    updateMany,
  };
}
