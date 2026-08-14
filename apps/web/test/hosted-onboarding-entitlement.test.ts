import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  assertHostedMemberOwnActiveAccessAllowed,
  hasHostedMemberGeneralAccess,
  hasHostedMemberOwnActiveAccess,
  hasHostedMemberOwnPaidBilling,
  hasHostedPaidBillingRefEvidence,
} from "@/src/lib/hosted-onboarding/entitlement";
import {
  hasActiveHostedMemberAccess,
  hasActiveHostedThreadContainerAccess,
  hasActiveHostedThreadContainerAccessWithParticipants,
  readActiveHostedFamilySponsorship,
  readActiveHostedMemberAccess,
  readActiveHostedMemberAccessIds,
  readHostedRuntimeAiAccessDecision,
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

describe("hosted onboarding entitlement (own access)", () => {
  it("requires active own access plus a non-suspended member", () => {
    expect(hasHostedMemberOwnActiveAccess({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    })).toBe(true);

    expect(hasHostedMemberOwnActiveAccess({
      billingStatus: HostedBillingStatus.past_due,
      suspendedAt: null,
    })).toBe(false);

    expect(hasHostedMemberOwnActiveAccess({
      billingStatus: HostedBillingStatus.active,
      suspendedAt: SUSPENDED_AT,
    })).toBe(false);
  });

  it("keeps general access broader than active product access without allowing suspended members", () => {
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

  it("reports access-state-specific errors for non-active members", () => {
    expect(() =>
      assertHostedMemberOwnActiveAccessAllowed({
        billingStatus: HostedBillingStatus.canceled,
        suspendedAt: null,
      })).toThrowError(expect.objectContaining({
      code: "HOSTED_ACCESS_REQUIRED",
      message: "Your subscription is canceled. Open billing to resume access.",
    }));

    expect(() =>
      assertHostedMemberOwnActiveAccessAllowed({
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
    const now = new Date("2026-07-26T12:00:00.000Z");
    const prisma = {
      hostedThreadContainerParticipant: {
        findFirst: vi.fn(async () => ({ participantMemberId: "member_participant" })),
      },
    };

    await expect(hasActiveHostedThreadContainerAccessWithParticipants({
      container: { suspendedAt: null },
      containerMemberId: "member_container",
      now,
      owner: person({ billingStatus: HostedBillingStatus.paused }),
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(prisma.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledWith({
      select: {
        participantMemberId: true,
      },
      where: expect.objectContaining({
        containerMemberId: "member_container",
        lastSeenAt: { gte: new Date("2026-07-19T12:00:00.000Z") },
        removedAt: null,
      }),
    });
  });

  it("makes readActiveHostedMemberAccess the participant-aware thread-container gate", async () => {
    const now = new Date("2026-07-26T12:00:00.000Z");
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
      now,
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
        lastSeenAt: { gte: new Date("2026-07-19T12:00:00.000Z") },
        removedAt: null,
      }),
    });
  });

  it("resolves owner and current-participant access for a member set without per-member reads", async () => {
    const now = new Date("2026-07-26T12:00:00.000Z");
    const findManyMembers = vi.fn(async () => [
      {
        ...person({ billingStatus: HostedBillingStatus.not_started }),
        id: "container_owner_backed",
        threadContainer: {
          owner: person({ billingStatus: HostedBillingStatus.active }),
        },
      },
      {
        ...person({ billingStatus: HostedBillingStatus.not_started }),
        id: "container_participant_backed",
        threadContainer: {
          owner: person({ billingStatus: HostedBillingStatus.paused }),
        },
      },
      {
        ...person({ billingStatus: HostedBillingStatus.not_started }),
        id: "container_inactive",
        threadContainer: {
          owner: person({ billingStatus: HostedBillingStatus.paused }),
        },
      },
      {
        ...person({ billingStatus: HostedBillingStatus.active, suspendedAt: SUSPENDED_AT }),
        id: "container_suspended",
        threadContainer: {
          owner: person({ billingStatus: HostedBillingStatus.active }),
        },
      },
    ]);
    const findManyParticipants = vi.fn(async () => [{
      containerMemberId: "container_participant_backed",
    }]);
    const prisma = {
      hostedMember: { findMany: findManyMembers },
      hostedThreadContainerParticipant: { findMany: findManyParticipants },
    };

    await expect(readActiveHostedMemberAccessIds({
      memberIds: [
        "container_owner_backed",
        "container_participant_backed",
        "container_inactive",
        "container_suspended",
        "container_owner_backed",
      ],
      now,
      prisma: prisma as never,
    })).resolves.toEqual(new Set([
      "container_owner_backed",
      "container_participant_backed",
    ]));
    expect(findManyMembers).toHaveBeenCalledTimes(1);
    expect(findManyParticipants).toHaveBeenCalledTimes(1);
    expect(findManyParticipants).toHaveBeenCalledWith(expect.objectContaining({
      select: { containerMemberId: true },
      take: 97,
      where: expect.objectContaining({
        containerMemberId: {
          in: [
            "container_owner_backed",
            "container_participant_backed",
            "container_inactive",
          ],
        },
        lastSeenAt: { gte: new Date("2026-07-19T12:00:00.000Z") },
        removedAt: null,
        participant: expect.objectContaining({
          suspendedAt: null,
        }),
      }),
    }));
  });

  it("fails closed when current participant rows exceed the admitted roster bound", async () => {
    const prisma = {
      hostedMember: {
        findMany: vi.fn(async () => [{
          ...person({ billingStatus: HostedBillingStatus.not_started }),
          id: "container_overflow",
          threadContainer: {
            owner: person({ billingStatus: HostedBillingStatus.paused }),
          },
        }]),
      },
      hostedThreadContainerParticipant: {
        findMany: vi.fn(async () => Array.from(
          { length: 33 },
          () => ({ containerMemberId: "container_overflow" }),
        )),
      },
    };

    await expect(readActiveHostedMemberAccessIds({
      memberIds: ["container_overflow"],
      now: new Date("2026-07-26T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toThrow("participant read exceeded its admitted bound");
  });

  it("reads active Family sponsorship without treating own billing as sponsorship", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "membership_123" });

    await expect(readActiveHostedFamilySponsorship({
      memberId: "member_123",
      prisma: {
        hostedAccountGroupMembership: { findFirst },
      } as never,
    })).resolves.toBe(true);

    expect(findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        group: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
        memberId: "member_123",
        status: "active",
      },
    });
  });
});

describe("hosted runtime AI access decision", () => {
  const now = new Date("2026-07-12T12:00:00.000Z");

  it("allows paid members with historical trial metadata", async () => {
    const prisma = buildRuntimeAiAccessPrisma({
      billingRef: buildRuntimeAiBillingRef({
        currentBillingPhase: "paid",
        currentCheckoutOffer: "pulse_trial_7d",
        pulseTrialRedeemedAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
    });

    await expect(readHostedRuntimeAiAccessDecision({
      memberId: "member_paid",
      now,
      prisma: prisma as never,
    })).resolves.toEqual({ allowed: true });
  });

  it("allows active starter access without consulting legacy trial deadlines or usage periods", async () => {
    const prisma = buildRuntimeAiAccessPrisma({
      billingRef: buildRuntimeAiBillingRef(),
    });

    await expect(readHostedRuntimeAiAccessDecision({
      memberId: "member_starter",
      now,
      prisma: prisma as never,
    })).resolves.toEqual({ allowed: true });
    expect(prisma).not.toHaveProperty("hostedAiUsagePeriod");
  });

  it("denies AI admission after explicit health-data consent withdrawal", async () => {
    const prisma = buildRuntimeAiAccessPrisma({
      billingRef: buildRuntimeAiBillingRef(),
      consentGrants: [{
        scope: "launch.health-data",
        status: "revoked",
      }],
    });

    await expect(readHostedRuntimeAiAccessDecision({
      memberId: "member_withdrawn",
      now,
      prisma: prisma as never,
    })).resolves.toEqual({
      allowed: false,
      reason: "health_data_consent_withdrawn",
      retryAfter: new Date("2026-07-12T12:15:00.000Z"),
      userNotice: {
        code: "health_data_consent_withdrawn",
        message:
          "Murph is paused because you withdrew health data consent. "
          + "Use Murph again in Settings: https://withmurph.ai/settings#data-privacy",
      },
    });
  });

  it("keeps missing legacy health-data grants compatible with AI admission", async () => {
    const prisma = buildRuntimeAiAccessPrisma({
      billingRef: buildRuntimeAiBillingRef(),
      consentGrants: [],
    });

    await expect(readHostedRuntimeAiAccessDecision({
      memberId: "member_legacy",
      now,
      prisma: prisma as never,
    })).resolves.toEqual({ allowed: true });
  });

  it("does not grant runtime access to a paused direct member", async () => {
    const prisma = buildRuntimeAiAccessPrisma({
      billingRef: buildRuntimeAiBillingRef(),
      billingStatus: HostedBillingStatus.paused,
    });

    await expect(readHostedRuntimeAiAccessDecision({
      memberId: "member_paused_direct",
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "hosted_access_inactive",
      userNotice: {
        code: "billing_inactive",
      },
    });
  });

  it("rotates lapsed-access notice copy across deliveries to the same member", async () => {
    const messages = new Set<string>();

    for (const eventId of ["evt_1", "evt_2", "evt_3", "evt_4", "evt_5", "evt_6"]) {
      const decision = await readHostedRuntimeAiAccessDecision({
        memberId: "member_paused_direct",
        noticeSeed: eventId,
        now,
        prisma: buildRuntimeAiAccessPrisma({
          billingRef: buildRuntimeAiBillingRef(),
          billingStatus: HostedBillingStatus.paused,
        }) as never,
      });

      if (!decision.allowed && decision.userNotice) {
        messages.add(decision.userNotice.message);
      }
    }

    // A member texting repeatedly must not receive one sentence verbatim.
    expect(messages.size).toBeGreaterThan(1);
  });

  it("keeps the member-stable notice variant when no delivery seed is supplied", async () => {
    const readDecision = async () => await readHostedRuntimeAiAccessDecision({
      memberId: "member_paused_direct",
      now,
      prisma: buildRuntimeAiAccessPrisma({
        billingRef: buildRuntimeAiBillingRef(),
        billingStatus: HostedBillingStatus.paused,
      }) as never,
    });

    const first = await readDecision();
    const second = await readDecision();

    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
    expect(
      first.allowed === false ? first.userNotice?.message : null,
    ).toBe(second.allowed === false ? second.userNotice?.message : null);
  });

  it("lets active Family sponsorship override inactive direct access", async () => {
    const prisma = buildRuntimeAiAccessPrisma({
      accountGroupMemberships: [{
        group: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
        status: "active",
      }],
      billingRef: buildRuntimeAiBillingRef({
        currentTrialEndsAt: now,
      }),
      billingStatus: HostedBillingStatus.paused,
    });

    await expect(readHostedRuntimeAiAccessDecision({
      memberId: "member_family",
      now,
      prisma: prisma as never,
    })).resolves.toEqual({ allowed: true });
  });

  it("does not let a legacy trial timestamp revoke an active thread-container owner", async () => {
    const prisma = buildRuntimeAiAccessPrisma({
      billingRef: null,
      billingStatus: HostedBillingStatus.not_started,
      threadContainer: {
        owner: {
          ...person({ billingStatus: HostedBillingStatus.active }),
          billingRef: buildRuntimeAiBillingRef(),
        },
      },
    });

    await expect(readHostedRuntimeAiAccessDecision({
      memberId: "member_container",
      now,
      prisma: prisma as never,
    })).resolves.toEqual({ allowed: true });
  });

  it("keeps a withdrawn owner fail-closed for queued thread-container work", async () => {
    const prisma = buildRuntimeAiAccessPrisma({
      billingRef: null,
      billingStatus: HostedBillingStatus.not_started,
      threadContainer: {
        owner: {
          ...person({ billingStatus: HostedBillingStatus.active }),
          billingRef: buildRuntimeAiBillingRef(),
          consentGrants: [{
            scope: "launch.health-data",
            status: "revoked",
          }],
        },
      },
    });

    await expect(readHostedRuntimeAiAccessDecision({
      memberId: "member_container",
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      reason: "health_data_consent_withdrawn",
    });
  });

  it("allows a thread container through an active starter participant", async () => {
    const prisma = buildRuntimeAiAccessPrisma({
      billingRef: null,
      billingStatus: HostedBillingStatus.not_started,
      threadContainer: {
        owner: {
          ...person({ billingStatus: HostedBillingStatus.paused }),
          billingRef: null,
        },
      },
    }, [{
      ...person({ billingStatus: HostedBillingStatus.active }),
      billingRef: buildRuntimeAiBillingRef(),
    }]);

    await expect(readHostedRuntimeAiAccessDecision({
      memberId: "member_container",
      now,
      prisma: prisma as never,
    })).resolves.toEqual({ allowed: true });
  });

  it("does not let a legacy trial timestamp revoke an active participant", async () => {
    const prisma = buildRuntimeAiAccessPrisma({
      billingRef: null,
      billingStatus: HostedBillingStatus.not_started,
      threadContainer: {
        owner: {
          ...person({ billingStatus: HostedBillingStatus.paused }),
          billingRef: null,
        },
      },
    }, [{
      ...person({ billingStatus: HostedBillingStatus.active }),
      billingRef: buildRuntimeAiBillingRef({
        currentTrialEndsAt: now,
      }),
    }]);

    await expect(readHostedRuntimeAiAccessDecision({
      memberId: "member_container",
      now,
      prisma: prisma as never,
    })).resolves.toEqual({ allowed: true });
  });
});

function buildRuntimeAiBillingRef(overrides: Partial<{
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer: string | null;
  currentTrialEndsAt: Date | null;
  currentTrialStartedAt: Date | null;
  pulseTrialPolicyVersion: string | null;
  pulseTrialRedeemedAt: Date | null;
}> = {}) {
  return {
    currentBillingPhase: "trial",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "pulse_trial_7d",
    currentTrialEndsAt: new Date("2026-07-20T12:00:00.000Z"),
    currentTrialStartedAt: new Date("2026-07-10T12:00:00.000Z"),
    pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
    pulseTrialRedeemedAt: new Date("2026-07-10T12:00:00.000Z"),
    ...overrides,
  };
}

function buildRuntimeAiAccessPrisma(
  member: {
    accountGroupMemberships?: ReturnType<typeof person>["accountGroupMemberships"];
    billingRef: ReturnType<typeof buildRuntimeAiBillingRef> | null;
    billingStatus?: HostedBillingStatus;
    consentGrants?: Array<{ scope: string; status: string }>;
    suspendedAt?: Date | null;
    threadContainer?: {
      owner: ReturnType<typeof person> & {
        billingRef: ReturnType<typeof buildRuntimeAiBillingRef> | null;
        consentGrants?: Array<{ scope: string; status: string }>;
      };
    } | null;
  },
  participants: Array<ReturnType<typeof person> & {
    billingRef: ReturnType<typeof buildRuntimeAiBillingRef> | null;
  }> = [],
) {
  return {
    hostedMember: {
      findUnique: vi.fn(async () => ({
        accountGroupMemberships: member.accountGroupMemberships ?? [],
        billingRef: member.billingRef,
        billingStatus: member.billingStatus ?? HostedBillingStatus.active,
        consentGrants: member.consentGrants ?? [],
        suspendedAt: member.suspendedAt ?? null,
        threadContainer: member.threadContainer ?? null,
      })),
    },
    hostedThreadContainerParticipant: {
      findMany: vi.fn(async () => participants.map((participant) => ({ participant }))),
    },
  };
}


describe("hosted paid-billing evidence", () => {
  it("accepts an explicit paid phase", () => {
    expect(hasHostedPaidBillingRefEvidence({
      currentBillingPhase: "paid",
      currentCheckoutOffer: "pulse_trial_7d",
      stripeSubscriptionLookupKey: "subscription-key",
    })).toBe(true);
  });

  it("keeps rolling-deploy paid subscriptions with no projected phase", () => {
    expect(hasHostedPaidBillingRefEvidence({
      currentBillingPhase: null,
      currentCheckoutOffer: "standard",
      stripeSubscriptionLookupKey: "subscription-key",
    })).toBe(true);
  });

  it("keeps pre-offer paid subscriptions with a bound provider identity", () => {
    expect(hasHostedPaidBillingRefEvidence({
      currentBillingPhase: null,
      currentCheckoutOffer: null,
      stripeSubscriptionLookupKey: "subscription-key",
    })).toBe(true);
  });

  it("fails closed for an unrecognized checkout offer", () => {
    expect(hasHostedPaidBillingRefEvidence({
      currentBillingPhase: null,
      currentCheckoutOffer: "unexpected-offer",
      stripeSubscriptionLookupKey: "subscription-key",
    })).toBe(false);
  });

  it("never mistakes a retired trial identity for paid billing", () => {
    expect(hasHostedPaidBillingRefEvidence({
      currentBillingPhase: null,
      currentCheckoutOffer: "pulse_trial_7d",
      stripeSubscriptionLookupKey: "legacy-trial-key",
    })).toBe(false);
    expect(hasHostedPaidBillingRefEvidence({
      currentBillingPhase: "trial",
      currentCheckoutOffer: "pulse_trial_7d",
      stripeSubscriptionLookupKey: "legacy-trial-key",
    })).toBe(false);
  });

  it("requires active unsuspended product access for paid management", () => {
    const billingRef = {
      currentBillingPhase: "paid",
      currentCheckoutOffer: "standard",
      stripeSubscriptionLookupKey: "subscription-key",
    };

    expect(hasHostedMemberOwnPaidBilling({
      billingRef,
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    })).toBe(true);
    expect(hasHostedMemberOwnPaidBilling({
      billingRef,
      billingStatus: HostedBillingStatus.paused,
      suspendedAt: null,
    })).toBe(false);
    expect(hasHostedMemberOwnPaidBilling({
      billingRef,
      billingStatus: HostedBillingStatus.active,
      suspendedAt: new Date("2026-08-09T00:00:00.000Z"),
    })).toBe(false);
  });
});
