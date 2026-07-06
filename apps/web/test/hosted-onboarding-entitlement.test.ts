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
  readActiveHostedMemberAccess,
} from "@/src/lib/hosted-onboarding/member-access";

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
