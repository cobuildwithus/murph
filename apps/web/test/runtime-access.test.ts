import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireHostedRuntimeActiveAccessForUpdateTx } from "@/src/lib/hosted-mailbox/runtime-access";

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

describe("requireHostedRuntimeActiveAccessForUpdateTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks thread-container owner before the runtime member", async () => {
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
});
