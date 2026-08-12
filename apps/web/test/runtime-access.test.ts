import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  requireHostedRuntimeActiveAccessForUpdateTx,
  requireHostedRuntimeMembersActiveAccessForUpdateTx,
} from "@/src/lib/hosted-mailbox/runtime-access";

function buildRuntimeAccessTx(
  ownerReads: Array<string | null>,
  input: {
    ownerBillingStatus?: HostedBillingStatus;
    participantActive?: boolean;
  } = {},
): {
  lockOrder: string[];
  tx: Prisma.TransactionClient & {
    $queryRaw: ReturnType<typeof vi.fn>;
    hostedMember: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    hostedThreadContainerParticipant: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
} {
  const lockOrder: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Array.from(strings).join("?");
      if (sql.includes("FROM hosted_thread_container")) {
        lockOrder.push(sql.includes("FOR UPDATE") ? "container-lock" : "container-read");
        const ownerMemberId = ownerReads.shift() ?? null;
        return ownerMemberId ? [{ ownerMemberId }] : [];
      }
      if (sql.includes("FROM hosted_member")) {
        lockOrder.push(values[0] === "member_owner" ? "owner-lock" : "runtime-lock");
        return [{ id: values[0] }];
      }
      return [];
    }),
    hostedMember: {
      findUnique: vi.fn(async () => ({
        accountGroupMemberships: [],
        billingStatus: "active",
        id: "member_group_runtime",
        suspendedAt: null,
        threadContainer: {
          owner: {
            accountGroupMemberships: [],
            billingStatus: input.ownerBillingStatus ?? HostedBillingStatus.active,
            suspendedAt: null,
          },
        },
      })),
    },
    hostedThreadContainerParticipant: {
      findFirst: vi.fn(async () => input.participantActive
        ? { participantMemberId: "member_participant" }
        : null),
    },
  };

  return {
    lockOrder,
    tx: tx as unknown as Prisma.TransactionClient & {
      $queryRaw: ReturnType<typeof vi.fn>;
      hostedMember: {
        findUnique: ReturnType<typeof vi.fn>;
      };
      hostedThreadContainerParticipant: {
        findFirst: ReturnType<typeof vi.fn>;
      };
    },
  };
}

function createBarrier(parties: number): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals += 1;
    if (arrivals === parties) {
      release();
    }
    await opened;
  };
}

function createMemberLockManager() {
  const owners = new Map<string, string>();
  const waiters = new Map<string, Array<() => void>>();

  return {
    async acquire(transactionId: string, memberId: string): Promise<void> {
      while (true) {
        const owner = owners.get(memberId);
        if (!owner || owner === transactionId) {
          owners.set(memberId, transactionId);
          return;
        }

        await new Promise<void>((resolve) => {
          const memberWaiters = waiters.get(memberId) ?? [];
          memberWaiters.push(resolve);
          waiters.set(memberId, memberWaiters);
        });
      }
    },
    release(transactionId: string): void {
      for (const [memberId, owner] of owners) {
        if (owner !== transactionId) {
          continue;
        }
        owners.delete(memberId);
        waiters.get(memberId)?.shift()?.();
      }
    },
  };
}

function buildReciprocalRuntimeAccessTx(input: {
  awaitPeerAtFirstMemberLock: () => Promise<void>;
  lockManager: ReturnType<typeof createMemberLockManager>;
  transactionId: string;
}): {
  memberLockOrder: string[];
  tx: Prisma.TransactionClient;
} {
  const memberLockOrder: string[] = [];
  let firstMemberLock = true;
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Array.from(strings).join("?");
      if (sql.includes("FROM hosted_thread_container")) {
        return [];
      }
      if (sql.includes("FROM hosted_member")) {
        const memberId = String(values[0]);
        if (firstMemberLock) {
          firstMemberLock = false;
          await input.awaitPeerAtFirstMemberLock();
        }
        memberLockOrder.push(memberId);
        await input.lockManager.acquire(input.transactionId, memberId);
        return [{ id: memberId }];
      }
      return [];
    }),
    hostedMember: {
      findUnique: vi.fn(async () => ({
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
        threadContainer: null,
      })),
    },
    hostedThreadContainerParticipant: {
      findFirst: vi.fn(async () => null),
    },
  };

  return {
    memberLockOrder,
    tx: tx as unknown as Prisma.TransactionClient,
  };
}

describe("requireHostedRuntimeActiveAccessForUpdateTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks the sorted unique member set before thread-container revalidation", async () => {
    const { lockOrder, tx } = buildRuntimeAccessTx(["member_owner", "member_owner"]);

    await expect(requireHostedRuntimeActiveAccessForUpdateTx("member_group_runtime", {
      prisma: tx,
    })).resolves.toBeUndefined();

    expect(lockOrder).toEqual([
      "container-read",
      "owner-lock",
      "runtime-lock",
      "container-lock",
    ]);
    expect(tx.hostedMember.findUnique).toHaveBeenCalled();
  });

  it("allows a thread-container runtime through an active participant", async () => {
    const { tx } = buildRuntimeAccessTx(["member_owner", "member_owner"], {
      ownerBillingStatus: HostedBillingStatus.paused,
      participantActive: true,
    });

    await expect(requireHostedRuntimeActiveAccessForUpdateTx("member_group_runtime", {
      prisma: tx,
    })).resolves.toBeUndefined();

    expect(tx.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledWith({
      select: {
        participantMemberId: true,
      },
      where: expect.objectContaining({
        containerMemberId: "member_group_runtime",
        lastSeenAt: { gte: expect.any(Date) },
        removedAt: null,
      }),
    });
  });

  it("fails closed when thread-container authority changes while locking", async () => {
    const { tx } = buildRuntimeAccessTx(["member_owner", "member_other_owner"]);

    await expect(requireHostedRuntimeActiveAccessForUpdateTx("member_group_runtime", {
      prisma: tx,
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_ACCESS_AUTHORITY_CHANGED",
      retryable: true,
    });

    expect(tx.hostedMember.findUnique).not.toHaveBeenCalled();
  });

  it("completes reciprocal concurrent access checks in the same member lock order", async () => {
    const awaitPeerAtFirstMemberLock = createBarrier(2);
    const lockManager = createMemberLockManager();
    const first = buildReciprocalRuntimeAccessTx({
      awaitPeerAtFirstMemberLock,
      lockManager,
      transactionId: "transaction-a-to-b",
    });
    const second = buildReciprocalRuntimeAccessTx({
      awaitPeerAtFirstMemberLock,
      lockManager,
      transactionId: "transaction-b-to-a",
    });

    const run = async (
      transactionId: string,
      tx: Prisma.TransactionClient,
      memberIds: readonly string[],
    ) => {
      try {
        await requireHostedRuntimeMembersActiveAccessForUpdateTx(memberIds, {
          prisma: tx,
        });
      } finally {
        lockManager.release(transactionId);
      }
    };

    await Promise.all([
      run(
        "transaction-a-to-b",
        first.tx,
        ["member_a", "member_b", "member_a"],
      ),
      run(
        "transaction-b-to-a",
        second.tx,
        ["member_b", "member_a", "member_b"],
      ),
    ]);

    expect(first.memberLockOrder).toEqual(["member_a", "member_b"]);
    expect(second.memberLockOrder).toEqual(["member_a", "member_b"]);
  }, 1_000);
});
