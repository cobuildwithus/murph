import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  assertHostedMemberOwnActiveBillingAllowed,
  hasHostedMemberGeneralAccess,
  hasHostedMemberOwnActiveBilling,
} from "@/src/lib/hosted-onboarding/entitlement";
import {
  hasActiveHostedMemberAccess,
  hasActiveHostedThreadContainerAccess,
  hasActiveHostedThreadContainerAccessWithParticipants,
  assertActiveHostedPersonAccessAllowedTx,
  readActiveHostedMemberAccess,
} from "@/src/lib/hosted-onboarding/member-access";
import { createPrismaClient } from "@/src/lib/prisma";

const SUSPENDED_AT = new Date("2026-04-06T10:00:00.000Z");

function person(input: {
  billingStatus: HostedBillingStatus;
  suspendedAt?: Date | null;
  memberships?: Array<{
    status?: string;
    group: { billingStatus: HostedBillingStatus; suspendedAt?: Date | null };
  }>;
}) {
  return {
    accountGroupMemberships: (input.memberships ?? []).map((membership) => ({
      group: {
        billingStatus: membership.group.billingStatus,
        suspendedAt: membership.group.suspendedAt ?? null,
      },
      status: membership.status ?? "active",
    })),
    billingStatus: input.billingStatus,
    suspendedAt: input.suspendedAt ?? null,
  };
}

function buildLockedPersonAccessTx(input: {
  candidateGroupBillingStatus?: HostedBillingStatus;
  lockedGroupBillingStatus?: HostedBillingStatus;
  memberBillingStatus: HostedBillingStatus;
  candidateMembershipStatus?: string;
  lockedMembershipStatus?: string;
}) {
  const lockOrder: string[] = [];
  const $queryRaw = vi.fn(async (query: unknown) => {
    const sql = readRawSqlText(query).toLowerCase();
    if (sql.includes('from "hosted_account_group"')) {
      lockOrder.push("account-group");
    }
    if (sql.includes('from "hosted_member"')) {
      lockOrder.push("member");
    }
    return [];
  });
  let sponsorshipReadCount = 0;
  const findSponsorship = vi.fn(async () => {
    sponsorshipReadCount += 1;
    const groupBillingStatus = sponsorshipReadCount === 1
      ? input.candidateGroupBillingStatus
      : input.lockedGroupBillingStatus ?? input.candidateGroupBillingStatus;
    const membershipStatus = sponsorshipReadCount === 1
      ? input.candidateMembershipStatus ?? "active"
      : input.lockedMembershipStatus ?? input.candidateMembershipStatus ?? "active";
    if (
      groupBillingStatus !== HostedBillingStatus.active
      || membershipStatus !== "active"
    ) {
      return null;
    }
    return sponsorshipReadCount === 1
      ? { groupId: "family_group_active" }
      : { id: "membership_active" };
  });
  const tx = createPrismaClient({
    databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
  });
  Object.defineProperty(tx, "$queryRaw", {
    configurable: true,
    value: $queryRaw,
  });
  Object.defineProperty(tx, "hostedMember", {
    configurable: true,
    value: {
      findUnique: vi.fn(async () => ({
        billingStatus: input.memberBillingStatus,
        suspendedAt: null,
        threadContainer: null,
      })),
    },
  });
  Object.defineProperty(tx, "hostedAccountGroupMembership", {
    configurable: true,
    value: { findFirst: findSponsorship },
  });
  return {
    $queryRaw,
    findSponsorship,
    lockOrder,
    tx,
  };
}

function readRawSqlText(query: unknown): string {
  if (Array.isArray(query)) {
    return query.join(" ");
  }
  if (
    query
    && typeof query === "object"
    && "strings" in query
    && Array.isArray((query as { strings?: unknown }).strings)
  ) {
    return ((query as { strings: string[] }).strings).join(" ");
  }
  return String(query);
}

describe("hosted onboarding entitlement (own billing)", () => {
  it("requires active own billing plus a non-suspended member", () => {
    expect(hasHostedMemberOwnActiveBilling({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    })).toBe(true);

    expect(hasHostedMemberOwnActiveBilling({
      billingStatus: HostedBillingStatus.past_due,
      suspendedAt: null,
    })).toBe(false);

    expect(hasHostedMemberOwnActiveBilling({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: SUSPENDED_AT,
    })).toBe(false);
  });

  it("keeps general access broader than active billing without allowing suspended members", () => {
    expect(hasHostedMemberGeneralAccess({
      billingStatus: HostedBillingStatus.past_due,
      suspendedAt: null,
    })).toBe(true);

    expect(hasHostedMemberGeneralAccess({
      billingStatus: HostedBillingStatus.canceled,
      suspendedAt: null,
    })).toBe(false);

    expect(hasHostedMemberGeneralAccess({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: SUSPENDED_AT,
    })).toBe(false);
  });

  it("reports billing-state-specific errors for non-active members", () => {
    expect(() =>
      assertHostedMemberOwnActiveBillingAllowed({
        billingStatus: HostedBillingStatus.canceled,
        suspendedAt: null,
      })).toThrowError(expect.objectContaining({
      code: "HOSTED_ACCESS_REQUIRED",
      message: "Your subscription is canceled. Open billing to resume access.",
    }));

    expect(() =>
      assertHostedMemberOwnActiveBillingAllowed({
        billingStatus: HostedBillingStatus.past_due,
        suspendedAt: null,
      })).toThrowError(expect.objectContaining({
      code: "HOSTED_ACCESS_REQUIRED",
      message: "Your subscription payment is past due. Update billing before continuing.",
    }));
  });
});

describe("hosted member access (single resolver)", () => {
  it("grants access on active own billing", () => {
    expect(hasActiveHostedMemberAccess(person({
      billingStatus: HostedBillingStatus.active,
    }))).toBe(true);

    expect(hasActiveHostedMemberAccess(person({
      billingStatus: HostedBillingStatus.not_started,
    }))).toBe(false);
  });

  it("derives sponsored access from membership and group rows held under update locks", async () => {
    const { $queryRaw, findSponsorship, lockOrder, tx } = buildLockedPersonAccessTx({
      candidateGroupBillingStatus: HostedBillingStatus.active,
      memberBillingStatus: HostedBillingStatus.not_started,
    });

    await expect(assertActiveHostedPersonAccessAllowedTx({
      memberId: "member_sponsored",
      tx,
    })).resolves.toBeUndefined();

    expect($queryRaw).toHaveBeenCalledTimes(2);
    expect(lockOrder).toEqual(["account-group", "member"]);
    expect(findSponsorship).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the locked sponsorship snapshot is no longer active", async () => {
    const { tx } = buildLockedPersonAccessTx({
      candidateGroupBillingStatus: HostedBillingStatus.active,
      lockedGroupBillingStatus: HostedBillingStatus.unpaid,
      memberBillingStatus: HostedBillingStatus.not_started,
    });

    await expect(assertActiveHostedPersonAccessAllowedTx({
      memberId: "member_sponsored",
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
    });
  });

  it("keeps independent paid access member-owned without taking a Family lock", async () => {
    const { findSponsorship, lockOrder, tx } = buildLockedPersonAccessTx({
      memberBillingStatus: HostedBillingStatus.active,
    });

    await expect(assertActiveHostedPersonAccessAllowedTx({
      memberId: "member_paid",
      tx,
    })).resolves.toBeUndefined();

    expect(lockOrder).toEqual(["member"]);
    expect(findSponsorship).not.toHaveBeenCalled();
  });

  it("grants access via an active membership in an active, unsuspended group", () => {
    expect(hasActiveHostedMemberAccess(person({
      billingStatus: HostedBillingStatus.not_started,
      memberships: [{ group: { billingStatus: HostedBillingStatus.active } }],
    }))).toBe(true);

    expect(hasActiveHostedMemberAccess(person({
      billingStatus: HostedBillingStatus.canceled,
      memberships: [{ group: { billingStatus: HostedBillingStatus.active } }],
    }))).toBe(true);

    expect(hasActiveHostedMemberAccess(person({
      billingStatus: HostedBillingStatus.not_started,
      memberships: [{ group: { billingStatus: HostedBillingStatus.unpaid } }],
    }))).toBe(false);

    expect(hasActiveHostedMemberAccess(person({
      billingStatus: HostedBillingStatus.not_started,
      memberships: [{
        group: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: SUSPENDED_AT,
        },
      }],
    }))).toBe(false);

    expect(hasActiveHostedMemberAccess(person({
      billingStatus: HostedBillingStatus.not_started,
      memberships: [{
        group: { billingStatus: HostedBillingStatus.active },
        status: "removed",
      }],
    }))).toBe(false);
  });

  it("fails closed for suspended members regardless of sponsorship", () => {
    expect(hasActiveHostedMemberAccess(person({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: SUSPENDED_AT,
    }))).toBe(false);

    expect(hasActiveHostedMemberAccess(person({
      billingStatus: HostedBillingStatus.not_started,
      memberships: [{ group: { billingStatus: HostedBillingStatus.active } }],
      suspendedAt: SUSPENDED_AT,
    }))).toBe(false);
  });

  it("derives thread-container access from the owner only", () => {
    // The container's own billing status is a non-source: synthetic members
    // are created not_started and legacy rows may carry a stale `active`.
    for (const containerBillingStatus of [
      HostedBillingStatus.not_started,
      HostedBillingStatus.active,
    ]) {
      expect(hasActiveHostedMemberAccess({
        ...person({ billingStatus: containerBillingStatus }),
        threadContainer: {
          owner: person({ billingStatus: HostedBillingStatus.active }),
        },
      })).toBe(true);

      expect(hasActiveHostedMemberAccess({
        ...person({ billingStatus: containerBillingStatus }),
        threadContainer: {
          owner: person({ billingStatus: HostedBillingStatus.canceled }),
        },
      })).toBe(false);
    }
  });

  it("keeps container access alive when the owner is family-sponsored", () => {
    expect(hasActiveHostedMemberAccess({
      ...person({ billingStatus: HostedBillingStatus.not_started }),
      threadContainer: {
        owner: person({
          billingStatus: HostedBillingStatus.not_started,
          memberships: [{ group: { billingStatus: HostedBillingStatus.active } }],
        }),
      },
    })).toBe(true);
  });

  it("fails closed for suspended containers and suspended owners", () => {
    expect(hasActiveHostedMemberAccess({
      ...person({
        billingStatus: HostedBillingStatus.not_started,
        suspendedAt: SUSPENDED_AT,
      }),
      threadContainer: {
        owner: person({ billingStatus: HostedBillingStatus.active }),
      },
    })).toBe(false);

    expect(hasActiveHostedThreadContainerAccess({
      container: { suspendedAt: SUSPENDED_AT },
      owner: person({ billingStatus: HostedBillingStatus.active }),
    })).toBe(false);

    expect(hasActiveHostedThreadContainerAccess({
      container: { suspendedAt: null },
      owner: person({
        billingStatus: HostedBillingStatus.not_started,
        memberships: [{ group: { billingStatus: HostedBillingStatus.active } }],
      }),
    })).toBe(true);
  });

  it("short-circuits participant lookup when the owner has active access", async () => {
    const prisma = {
      hostedThreadContainerParticipant: {
        findFirst: vi.fn(),
      },
    };

    await expect(hasActiveHostedThreadContainerAccessWithParticipants({
      container: { suspendedAt: null },
      containerMemberId: "member_container",
      owner: person({ billingStatus: HostedBillingStatus.active }),
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(prisma.hostedThreadContainerParticipant.findFirst).not.toHaveBeenCalled();
  });

  it("hard-blocks suspended containers before participant lookup", async () => {
    const prisma = {
      hostedThreadContainerParticipant: {
        findFirst: vi.fn(async () => ({ participantMemberId: "member_participant" })),
      },
    };

    await expect(hasActiveHostedThreadContainerAccessWithParticipants({
      container: { suspendedAt: SUSPENDED_AT },
      containerMemberId: "member_container",
      owner: person({ billingStatus: HostedBillingStatus.paused }),
      prisma: prisma as never,
    })).resolves.toBe(false);

    expect(prisma.hostedThreadContainerParticipant.findFirst).not.toHaveBeenCalled();
  });

  it("grants non-suspended container access through any active participant", async () => {
    const prisma = {
      hostedThreadContainerParticipant: {
        findFirst: vi.fn(async () => ({ participantMemberId: "member_participant" })),
      },
    };

    await expect(hasActiveHostedThreadContainerAccessWithParticipants({
      container: { suspendedAt: null },
      containerMemberId: "member_container",
      owner: person({ billingStatus: HostedBillingStatus.paused }),
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(prisma.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledWith({
      select: {
        participantMemberId: true,
      },
      where: expect.objectContaining({
        containerMemberId: "member_container",
        removedAt: null,
      }),
    });
  });

  it("makes readActiveHostedMemberAccess the participant-aware thread-container gate", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn(async () => ({
          ...person({ billingStatus: HostedBillingStatus.not_started }),
          threadContainer: {
            owner: person({ billingStatus: HostedBillingStatus.paused }),
          },
        })),
      },
      hostedThreadContainerParticipant: {
        findFirst: vi.fn(async () => ({ participantMemberId: "member_participant" })),
      },
    };

    await expect(readActiveHostedMemberAccess({
      memberId: "member_container",
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(prisma.hostedMember.findUnique).toHaveBeenCalledWith({
      select: expect.any(Object),
      where: { id: "member_container" },
    });
    expect(prisma.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledWith({
      select: {
        participantMemberId: true,
      },
      where: expect.objectContaining({
        containerMemberId: "member_container",
        removedAt: null,
      }),
    });
  });
});
