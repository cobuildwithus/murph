import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  computeHostedReferralRewardUsageDays,
  formatHostedReferralRewardUsageDays,
} from "@/src/lib/hosted-growth/referral-reward-days";
import {
  HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
} from "@/src/lib/hosted-growth/signup-referral-policy";
import {
  buildHostedUsageReferralOutstandingWhere,
  buildHostedUsageReferralRewardLabel,
  HOSTED_USAGE_REFERRAL_POLICY_VERSION,
  HOSTED_USAGE_REFERRAL_GROUP_MINIMUM_ACTIVITY_SPAN_MS,
  HOSTED_USAGE_REFERRAL_LATE_EVIDENCE_GRACE_MS,
  bindArmedHostedUsageReferralToNewContainerTx,
  buildHostedUsageReferralCelebrationWake,
  getHostedUsageReferralPolicyDisplay,
  hostedUsageReferralDestinationMatchesSourceConversation,
  observeHostedUsageReferralInboundTx,
  qualifiesHostedActiveGroupReferral,
} from "@/src/lib/hosted-growth/usage-referral";
import {
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

describe("hosted usage referral policy", () => {
  it("keeps group authority and detached names out of the celebration wake", () => {
    const authority = {
      accountLookupKey: "blinded-account-key",
      channel: "linq" as const,
      containerMemberId: "member_source_group",
      threadId: "provider-group-thread",
    };
    const wake = buildHostedUsageReferralCelebrationWake({
      beneficiaryMemberId: "member_source_group",
      destination: {
        conversationShape: "thread-container",
        externalThreadRouteAuthority: authority,
        route: {
          actorId: null,
          channel: "linq",
          delivery: { kind: "thread", target: "provider-group-thread" },
          identityId: `hid_${"1".repeat(32)}`,
          threadId: `hid_${"2".repeat(32)}`,
          threadIsDirect: false,
        },
      },
      notificationKey: "usage-referral-reward:referral_1",
      rewardLabel: "about 14 more days of Murph usage for this room",
      rewardedAt: new Date("2026-07-26T12:00:00.000Z"),
      styleBand: {
        humor: 8,
        tone: "casual",
        unhinged: 4,
      },
    });

    expect(wake.notification.externalThreadRouteAuthority).toEqual(authority);
    expect(wake.notification.instructions).toContain(
      "Celebrate without naming or otherwise identifying",
    );
    expect(wake.notification.instructions).not.toContain("display label");
    expect(wake.notification.instructions).toContain(
      "tone=casual; Humor=8/10; Unhinged=4/10",
    );
    expect(wake.notification.instructions).toContain(
      "Keep any edge aimed at Murph",
    );
    expect(wake.notification.instructions).toContain(
      "about 14 more days of Murph usage for this room",
    );
    expect(wake.notification.instructions).toContain(
      'Final message: include "about 14 more days of Murph usage for this room" exactly',
    );
  });

  it("labels persisted mission rewards as days of Murph usage", () => {
    expect(buildHostedUsageReferralRewardLabel({
      destinationKind: "group",
      policyCode: "new_person_activation_v1",
      policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
      rewardUsdMicros: 2_000_000n,
    })).toBe("about 10 more days of Murph usage for this room");
    expect(buildHostedUsageReferralRewardLabel({
      destinationKind: "personal",
      policyCode: "active_group_v1",
      policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
      rewardUsdMicros: 3_500_000n,
    })).toBe("about 14 more days of Murph usage for your Murph");
    expect(buildHostedUsageReferralRewardLabel({
      destinationKind: "personal",
      policyCode: "new_person_activation_v1",
      policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
      rewardUsdMicros: 2_750_000n,
    })).toBe("about 12 more days of Murph usage for your Murph");
    expect(buildHostedUsageReferralRewardLabel({
      destinationKind: "group",
      policyCode: "active_group_v1",
      policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
      rewardUsdMicros: 2_750_000n,
    })).toBe("about 12 more days of Murph usage for this room");
  });

  it("gives equal granted capacity one usage-day estimate across referral paths", () => {
    const rewardUsdMicros = 2_750_000n;

    expect([
      computeHostedReferralRewardUsageDays({
        policyCode: "new_person_activation_v1",
        policyVersion: HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
        rewardUsdMicros,
      }),
      computeHostedReferralRewardUsageDays({
        policyCode: "new_person_activation_v1",
        policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
        rewardUsdMicros,
      }),
      computeHostedReferralRewardUsageDays({
        policyCode: "active_group_v1",
        policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
        rewardUsdMicros,
      }),
    ]).toEqual([12, 12, 12]);
  });

  it("keeps the current anchors, outside scaling, grammar, and basis checks explicit", () => {
    const conversationalBasis = {
      policyCode: "active_group_v1" as const,
      policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
    };

    expect(computeHostedReferralRewardUsageDays({
      ...conversationalBasis,
      rewardUsdMicros: 2_000_000n,
    })).toBe(10);
    expect(computeHostedReferralRewardUsageDays({
      ...conversationalBasis,
      rewardUsdMicros: 3_500_000n,
    })).toBe(14);
    expect(formatHostedReferralRewardUsageDays({
      ...conversationalBasis,
      rewardUsdMicros: 200_000n,
      sentenceCase: true,
    })).toBe("About 1 more day of Murph usage");
    expect(formatHostedReferralRewardUsageDays({
      ...conversationalBasis,
      rewardUsdMicros: 7_000_000n,
    })).toBe("about 28 more days of Murph usage");

    expect(() => computeHostedReferralRewardUsageDays({
      policyCode: "active_group_v1",
      policyVersion: HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
      rewardUsdMicros: 3_500_000n,
    })).toThrow("Unsupported referral reward usage-day basis.");
    expect(() => computeHostedReferralRewardUsageDays({
      ...conversationalBasis,
      policyVersion: "unsupported-version",
      rewardUsdMicros: 3_500_000n,
    })).toThrow("Unsupported referral reward usage-day basis.");
  });

  it("shares display copy and outstanding semantics with read-only projections", () => {
    expect(getHostedUsageReferralPolicyDisplay("new_person_activation_v1")).toEqual({
      requirementsLabel:
        "Bring one new person into a fresh Murph group. Murph handles setup, and the reward is earned once they join the conversation with their own Murph.",
      title: "Bring someone new to Murph",
    });
    expect(getHostedUsageReferralPolicyDisplay("active_group_v1")).toEqual({
      requirementsLabel:
        "Start a fresh group and make it genuinely active, with multiple people actually talking.",
      title: "Start a group conversation",
    });

    const now = new Date("2026-07-29T12:00:00.000Z");
    expect(buildHostedUsageReferralOutstandingWhere(now)).toEqual([
      {
        expiresAt: { gt: now },
        status: "armed",
      },
      {
        expiresAt: {
          gt: new Date(
            now.getTime() - HOSTED_USAGE_REFERRAL_LATE_EVIDENCE_GRACE_MS,
          ),
        },
        status: "target_bound",
      },
      {
        qualifiedAt: { not: null },
        status: "target_bound",
      },
    ]);
  });

  it("accepts only the frozen personal source conversation", () => {
    const sourceConversation = {
      channel: "telegram" as const,
      threadId: `hid_${"3".repeat(32)}`,
      threadIsDirect: true,
    };
    const destination = {
      conversationShape: "direct-member" as const,
      externalThreadRouteAuthority: null,
      route: {
        actorId: null,
        channel: "telegram" as const,
        delivery: { kind: "thread" as const, target: "provider-direct-thread" },
        identityId: null,
        threadId: sourceConversation.threadId,
        threadIsDirect: true,
      },
    };

    expect(hostedUsageReferralDestinationMatchesSourceConversation({
      destination,
      sourceConversation,
    })).toBe(true);
    expect(hostedUsageReferralDestinationMatchesSourceConversation({
      destination: {
        ...destination,
        route: {
          ...destination.route,
          channel: "linq",
        },
      },
      sourceConversation,
    })).toBe(false);
    expect(hostedUsageReferralDestinationMatchesSourceConversation({
      destination: {
        ...destination,
        route: {
          ...destination.route,
          threadId: `hid_${"4".repeat(32)}`,
        },
      },
      sourceConversation,
    })).toBe(false);
    expect(hostedUsageReferralDestinationMatchesSourceConversation({
      destination: {
        ...destination,
        route: {
          ...destination.route,
          delivery: {
            kind: "participant",
            target: "provider-direct-participant",
          },
        },
      },
      sourceConversation,
    })).toBe(false);

    const wake = buildHostedUsageReferralCelebrationWake({
      beneficiaryMemberId: "member_personal",
      destination,
      notificationKey: "usage-referral-reward:referral_personal",
      rewardLabel: "about 10 more days of Murph usage for your Murph",
      rewardedAt: new Date("2026-07-26T12:00:00.000Z"),
      styleBand: {
        humor: 3,
        tone: "formal",
        unhinged: 0,
      },
    });
    expect(wake.notification.externalThreadRouteAuthority).toEqual({
      channel: "telegram",
      containerMemberId: "member_personal",
      threadId: "provider-direct-thread",
    });

    const stableLinqIdentityId = `hid_${"6".repeat(32)}`;
    const stableLinqParticipantId = `hid_${"5".repeat(32)}`;
    const linqSourceConversation = {
      channel: "linq" as const,
      threadId: `hid_${"7".repeat(32)}`,
      threadIsDirect: true,
    };
    const linqDestination = {
      conversationShape: "direct-member" as const,
      externalThreadRouteAuthority: null,
      route: {
        actorId: stableLinqParticipantId,
        channel: "linq" as const,
        delivery: {
          kind: "thread" as const,
          target: "provider-linq-source-thread",
        },
        identityId: stableLinqIdentityId,
        threadId: linqSourceConversation.threadId,
        threadIsDirect: true,
      },
    };
    expect(hostedUsageReferralDestinationMatchesSourceConversation({
      destination: linqDestination,
      sourceConversation: linqSourceConversation,
    })).toBe(true);
    expect(hostedUsageReferralDestinationMatchesSourceConversation({
      destination: {
        ...linqDestination,
        route: {
          ...linqDestination.route,
          delivery: {
            kind: "thread",
            target: "provider-linq-current-home-b",
          },
          threadId: `hid_${"8".repeat(32)}`,
        },
      },
      sourceConversation: linqSourceConversation,
    })).toBe(false);

    const linqWake = buildHostedUsageReferralCelebrationWake({
      beneficiaryMemberId: "member_personal",
      destination: linqDestination,
      notificationKey: "usage-referral-reward:referral_personal_linq",
      rewardLabel: "about 10 more days of Murph usage for your Murph",
      rewardedAt: new Date("2026-07-26T12:00:00.000Z"),
      styleBand: {
        humor: 3,
        tone: "formal",
        unhinged: 0,
      },
    });
    expect(linqWake.notification.route.delivery).toEqual({
      kind: "explicit",
      target: "provider-linq-source-thread",
    });
    expect(linqWake.notification.externalThreadRouteAuthority).toEqual({
      channel: "linq",
      containerMemberId: "member_personal",
      threadId: "provider-linq-source-thread",
    });
  });

  it("requires the complete portable active-group threshold", () => {
    const first = new Date("2026-07-26T12:00:00.000Z");
    const last = new Date(
      first.getTime() + HOSTED_USAGE_REFERRAL_GROUP_MINIMUM_ACTIVITY_SPAN_MS,
    );

    expect(qualifiesHostedActiveGroupReferral({
      firstHumanMessageAt: first,
      humanMessageCount: 15,
      lastHumanMessageAt: last,
      nonReferrerMessageCount: 8,
      nonReferrerSpeakerCount: 2,
    })).toBe(true);
    expect(qualifiesHostedActiveGroupReferral({
      firstHumanMessageAt: first,
      humanMessageCount: 14,
      lastHumanMessageAt: last,
      nonReferrerMessageCount: 8,
      nonReferrerSpeakerCount: 2,
    })).toBe(false);
    expect(qualifiesHostedActiveGroupReferral({
      firstHumanMessageAt: first,
      humanMessageCount: 15,
      lastHumanMessageAt: last,
      nonReferrerMessageCount: 7,
      nonReferrerSpeakerCount: 2,
    })).toBe(false);
    expect(qualifiesHostedActiveGroupReferral({
      firstHumanMessageAt: first,
      humanMessageCount: 15,
      lastHumanMessageAt: last,
      nonReferrerMessageCount: 8,
      nonReferrerSpeakerCount: 1,
    })).toBe(false);
    expect(qualifiesHostedActiveGroupReferral({
      firstHumanMessageAt: first,
      humanMessageCount: 15,
      lastHumanMessageAt: new Date(last.getTime() - 1),
      nonReferrerMessageCount: 8,
      nonReferrerSpeakerCount: 2,
    })).toBe(false);
  });

  it("binds every eligible armed policy owned by the new container creator", async () => {
    const occurredAt = new Date("2026-07-26T12:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "referral_person",
        policyCode: "new_person_activation_v1",
      },
      {
        id: "referral_group",
        policyCode: "active_group_v1",
      },
    ]);
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedUsageReferral: {
        findMany,
        updateMany,
      },
    };

    await expect(bindArmedHostedUsageReferralToNewContainerTx({
      enabled: true,
      occurredAt,
      ownerMemberId: "member_referrer",
      targetChannel: "linq",
      targetLinqService: "iMessage",
      targetContainerMemberId: "member_target_container",
      tx: tx as never,
    })).resolves.toEqual({
      referralIds: ["referral_person", "referral_group"],
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        armedAt: { lte: occurredAt },
        expiresAt: { gt: occurredAt },
        referrerMemberId: "member_referrer",
        status: "armed",
      },
    }));
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        status: "target_bound",
        targetBoundAt: occurredAt,
        targetContainerMemberId: "member_target_container",
      },
      where: {
        id: { in: ["referral_person", "referral_group"] },
        status: "armed",
        targetContainerMemberId: null,
      },
    });
  });

  it("leaves a Linq-only mission armed when Telegram binds an eligible policy", async () => {
    const occurredAt = new Date("2026-07-26T12:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedUsageReferral: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "referral_person",
            policyCode: "new_person_activation_v1",
          },
          {
            id: "referral_group",
            policyCode: "active_group_v1",
          },
        ]),
        updateMany,
      },
    };

    await expect(bindArmedHostedUsageReferralToNewContainerTx({
      enabled: true,
      occurredAt,
      ownerMemberId: "member_referrer",
      targetChannel: "telegram",
      targetLinqService: null,
      targetContainerMemberId: "member_target_container",
      tx: tx as never,
    })).resolves.toEqual({ referralIds: ["referral_group"] });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["referral_group"] },
      }),
    }));
  });

  it.each([
    {
      targetLinqService: "sms",
      title: "leaves a new-person mission armed for a new SMS group",
    },
    {
      targetLinqService: "RCS",
      title: "leaves a new-person mission armed for a new RCS group",
    },
    {
      targetLinqService: null,
      title: "leaves a new-person mission armed for an unknown Linq service",
    },
  ])("$title", async ({ targetLinqService }) => {
    const occurredAt = new Date("2026-07-26T12:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedUsageReferral: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "referral_person",
            policyCode: "new_person_activation_v1",
          },
          {
            id: "referral_group",
            policyCode: "active_group_v1",
          },
        ]),
        updateMany,
      },
    };

    await expect(bindArmedHostedUsageReferralToNewContainerTx({
      enabled: true,
      occurredAt,
      ownerMemberId: "member_referrer",
      targetChannel: "linq",
      targetContainerMemberId: "member_target_container",
      targetLinqService,
      tx: tx as never,
    })).resolves.toEqual({ referralIds: ["referral_group"] });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["referral_group"] },
      }),
    }));
  });

  it("fans one inbound event out to every policy bound to the group", async () => {
    const occurredAt = new Date("2026-07-26T12:00:00.000Z");
    const referrals = [
      {
        expiresAt: new Date("2026-08-02T11:55:00.000Z"),
        id: "referral_person",
        policyCode: "new_person_activation_v1",
        qualifiedAt: occurredAt,
        referrerMemberId: "member_referrer",
        referrerSubjectKey: "subject_referrer",
        status: "target_bound",
        targetBoundAt: new Date("2026-07-26T11:59:00.000Z"),
      },
      {
        expiresAt: new Date("2026-08-02T11:55:00.000Z"),
        id: "referral_group",
        policyCode: "active_group_v1",
        qualifiedAt: occurredAt,
        referrerMemberId: "member_referrer",
        referrerSubjectKey: "subject_referrer",
        status: "target_bound",
        targetBoundAt: new Date("2026-07-26T11:59:00.000Z"),
      },
    ];
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedUsageReferral: {
        findMany: vi.fn().mockResolvedValue(referrals.map((referral) => ({
          id: referral.id,
          referrerMemberId: referral.referrerMemberId,
        }))),
        findUnique: vi.fn().mockImplementation(async (input: {
          where: { id: string };
        }) =>
          referrals.find((referral) => referral.id === input.where.id) ?? null
        ),
      },
    };

    await expect(observeHostedUsageReferralInboundTx({
      containerMemberId: "member_target_container",
      enabled: true,
      eventKey: "event_shared",
      occurredAt,
      senderMemberId: "member_other",
      senderSubjectKey: "subject_other",
      tx: tx as never,
    })).resolves.toEqual({
      isBoundReferralTarget: true,
      qualificationCandidateReferralIds: [
        "referral_person",
        "referral_group",
      ],
    });

    expect(tx.hostedUsageReferral.findUnique).toHaveBeenCalledTimes(2);
  });

  it("dedupes provider events and qualifies after two other speakers carry the majority", async () => {
    const first = new Date("2026-07-26T12:00:00.000Z");
    const referrerPhoneSubjectKey = createHostedPhoneLookupKey("+15550000000");
    if (!referrerPhoneSubjectKey) {
      throw new Error("Expected a blind referrer phone lookup key.");
    }
    const referral = {
      armedAt: new Date("2026-07-26T11:55:00.000Z"),
      beneficiaryMemberId: "member_source_group",
      expiresAt: new Date("2026-08-02T11:55:00.000Z"),
      firstHumanMessageAt: null as Date | null,
      humanMessageCount: 0,
      id: "referral_1",
      introducedMemberId: null,
      lastHumanMessageAt: null as Date | null,
      nonReferrerMessageCount: 0,
      observedEventKeysJson: null as string[] | null,
      observedSpeakerKeysJson: null as string[] | null,
      policyCode: "active_group_v1" as const,
      referrerMemberId: "member_referrer",
      referrerSubjectKey: "subject_referrer",
      rewardUsdMicros: 3_500_000n,
      status: "target_bound",
      targetBoundAt: new Date("2026-07-26T11:59:00.000Z"),
      targetContainerMemberId: "member_target_container",
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_referrer",
        }),
      },
      hostedUsageReferral: {
        findMany: vi.fn().mockResolvedValue([{
          id: referral.id,
          referrerMemberId: referral.referrerMemberId,
        }]),
        findUnique: vi.fn().mockImplementation(async () => ({ ...referral })),
        update: vi.fn().mockImplementation(async (input: {
          data: Partial<typeof referral>;
        }) => {
          Object.assign(referral, input.data);
          return { ...referral };
        }),
      },
    };

    let candidates: string[] = [];
    for (let index = 0; index < 15; index += 1) {
      const nonReferrer = index >= 7;
      const observation = await observeHostedUsageReferralInboundTx({
        containerMemberId: "member_target_container",
        enabled: true,
        eventKey: `event_${index}`,
        occurredAt: new Date(
          first.getTime()
          + Math.round(
            index
            * HOSTED_USAGE_REFERRAL_GROUP_MINIMUM_ACTIVITY_SPAN_MS
            / 14,
          ),
        ),
        senderMemberId: nonReferrer
          ? `member_other_${index % 2}`
          : index === 0
            ? null
            : "member_referrer",
        senderSubjectKey: nonReferrer
          ? `subject_other_${index % 2}`
          : index === 0
            ? referrerPhoneSubjectKey
            : "subject_referrer",
        tx: tx as never,
      });
      candidates = observation.qualificationCandidateReferralIds;
    }

    expect(candidates).toEqual(["referral_1"]);
    expect(referral.humanMessageCount).toBe(15);
    expect(referral.nonReferrerMessageCount).toBe(8);
    expect(referral.observedSpeakerKeysJson).toEqual([
      "subject_other_1",
      "subject_other_0",
    ]);
    expect(tx.hostedMemberIdentity.findUnique).toHaveBeenCalledWith({
      select: { memberId: true },
      where: { phoneLookupKey: referrerPhoneSubjectKey },
    });

    await expect(observeHostedUsageReferralInboundTx({
      containerMemberId: "member_target_container",
      enabled: true,
      eventKey: "event_14",
      occurredAt: new Date(
        first.getTime() + HOSTED_USAGE_REFERRAL_GROUP_MINIMUM_ACTIVITY_SPAN_MS,
      ),
      senderMemberId: "member_other_0",
      senderSubjectKey: "subject_other_0",
      tx: tx as never,
    })).resolves.toEqual({
      isBoundReferralTarget: true,
      qualificationCandidateReferralIds: ["referral_1"],
    });
    expect(referral.humanMessageCount).toBe(15);
  });

  it("ignores evidence timestamped before the fresh group was bound", async () => {
    const targetBoundAt = new Date("2026-07-26T12:00:00.000Z");
    const update = vi.fn();
    const referral = {
      armedAt: new Date("2026-07-26T11:55:00.000Z"),
      beneficiaryMemberId: "member_source_group",
      expiresAt: new Date("2026-08-02T11:55:00.000Z"),
      firstHumanMessageAt: null,
      humanMessageCount: 0,
      id: "referral_1",
      introducedMemberId: null,
      lastHumanMessageAt: null,
      nonReferrerMessageCount: 0,
      observedEventKeysJson: null,
      observedSpeakerKeysJson: null,
      policyCode: "active_group_v1" as const,
      referrerMemberId: "member_referrer",
      referrerSubjectKey: "subject_referrer",
      rewardUsdMicros: 3_500_000n,
      status: "target_bound",
      targetBoundAt,
      targetContainerMemberId: "member_target_container",
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedUsageReferral: {
        findMany: vi.fn().mockResolvedValue([{
          id: referral.id,
          referrerMemberId: referral.referrerMemberId,
        }]),
        findUnique: vi.fn().mockResolvedValue(referral),
        update,
      },
    };

    await expect(observeHostedUsageReferralInboundTx({
      containerMemberId: "member_target_container",
      enabled: true,
      eventKey: "event_before_binding",
      occurredAt: new Date(targetBoundAt.getTime() - 1),
      senderMemberId: "member_other",
      senderSubjectKey: "subject_other",
      tx: tx as never,
    })).resolves.toEqual({
      isBoundReferralTarget: true,
      qualificationCandidateReferralIds: [],
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("preserves delayed pre-expiry evidence across an interposed later bind", async () => {
    const expiresAt = new Date("2026-07-26T12:10:00.000Z");
    const referral = {
      armedAt: new Date("2026-07-26T11:55:00.000Z"),
      beneficiaryMemberId: "member_source_group",
      expiresAt,
      firstHumanMessageAt: null,
      humanMessageCount: 0,
      id: "referral_out_of_order",
      introducedMemberId: null,
      lastHumanMessageAt: null,
      nonReferrerMessageCount: 0,
      observedEventKeysJson: null,
      observedSpeakerKeysJson: null,
      policyCode: "active_group_v1" as const,
      qualifiedAt: null,
      referrerMemberId: "member_referrer",
      referrerSubjectKey: "subject_referrer",
      rewardUsdMicros: 3_500_000n,
      status: "target_bound",
      targetBoundAt: new Date("2026-07-26T12:00:00.000Z"),
      targetContainerMemberId: "member_target_container",
    };
    const update = vi.fn().mockImplementation(async (input: {
      data: Partial<typeof referral>;
    }) => {
      Object.assign(referral, input.data);
      return { ...referral };
    });
    const updateMany = vi.fn().mockImplementation(async (input: {
      data: Partial<typeof referral>;
      where: {
        OR?: Array<{
          expiresAt: { lte: Date };
          status: string;
        }>;
        qualifiedAt?: null;
      };
    }) => {
      if (
        input.where.OR?.some((condition) =>
          referral.status === condition.status
          && referral.expiresAt <= condition.expiresAt.lte
        )
        && referral.qualifiedAt === null
      ) {
        Object.assign(referral, input.data);
        return { count: 1 };
      }
      return { count: 0 };
    });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedUsageReferral: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockImplementation(async (input: {
          where?: { status?: string };
        }) =>
          input.where?.status === "armed"
            ? []
            : [{
                id: referral.id,
                referrerMemberId: referral.referrerMemberId,
              }]
        ),
        findUnique: vi.fn().mockImplementation(async () => ({ ...referral })),
        update,
        updateMany,
      },
    };

    await expect(observeHostedUsageReferralInboundTx({
      containerMemberId: "member_target_container",
      enabled: true,
      eventKey: "event_after_expiry",
      occurredAt: new Date(expiresAt.getTime() + 1),
      senderMemberId: "member_other",
      senderSubjectKey: "subject_other",
      tx: tx as never,
    })).resolves.toEqual({
      isBoundReferralTarget: true,
      qualificationCandidateReferralIds: [],
    });
    expect(update).not.toHaveBeenCalled();

    await expect(bindArmedHostedUsageReferralToNewContainerTx({
      enabled: true,
      occurredAt: new Date(expiresAt.getTime() + 1),
      ownerMemberId: "member_referrer",
      targetChannel: "linq",
      targetLinqService: "imessage",
      targetContainerMemberId: "member_later_container",
      tx: tx as never,
    })).resolves.toEqual({ referralIds: [] });
    expect(referral.status).toBe("target_bound");

    await expect(observeHostedUsageReferralInboundTx({
      containerMemberId: "member_target_container",
      enabled: true,
      eventKey: "event_before_expiry",
      occurredAt: new Date(expiresAt.getTime() - 1),
      senderMemberId: "member_other",
      senderSubjectKey: "subject_other",
      tx: tx as never,
    })).resolves.toEqual({
      isBoundReferralTarget: true,
      qualificationCandidateReferralIds: [],
    });
    expect(update).toHaveBeenCalledOnce();
    expect(referral.humanMessageCount).toBe(1);
    expect(referral.observedEventKeysJson).toEqual(["event_before_expiry"]);

    await expect(bindArmedHostedUsageReferralToNewContainerTx({
      enabled: true,
      occurredAt: new Date(
        expiresAt.getTime()
        + HOSTED_USAGE_REFERRAL_LATE_EVIDENCE_GRACE_MS
        + 1,
      ),
      ownerMemberId: "member_referrer",
      targetChannel: "linq",
      targetLinqService: "imessage",
      targetContainerMemberId: "member_after_grace_container",
      tx: tx as never,
    })).resolves.toEqual({ referralIds: [] });
    expect(referral.status).toBe("expired");
  });

  it("resolves a newly activated Linq participant from blind subject evidence", async () => {
    const occurredAt = new Date("2026-07-26T12:00:00.000Z");
    const senderSubjectKey = createHostedPhoneLookupKey("+15551112222");
    if (!senderSubjectKey) {
      throw new Error("Expected a blind phone lookup key.");
    }
    const referral = {
      armedAt: new Date("2026-07-26T11:55:00.000Z"),
      beneficiaryMemberId: "member_source_group",
      expiresAt: new Date("2026-08-02T11:55:00.000Z"),
      firstHumanMessageAt: null as Date | null,
      humanMessageCount: 0,
      id: "referral_person_1",
      introducedMemberId: null as string | null,
      lastHumanMessageAt: null as Date | null,
      nonReferrerMessageCount: 0,
      observedEventKeysJson: null as string[] | null,
      observedSpeakerKeysJson: null as string[] | null,
      policyCode: "new_person_activation_v1" as const,
      referrerMemberId: "member_referrer",
      referrerSubjectKey: "subject_referrer",
      rewardUsdMicros: 2_000_000n,
      status: "target_bound",
      targetBoundAt: new Date("2026-07-26T11:59:00.000Z"),
      targetContainerMemberId: "member_target_container",
    };
    const update = vi.fn().mockImplementation(async (input: {
      data: Partial<typeof referral>;
    }) => {
      Object.assign(referral, input.data);
      return { ...referral };
    });
    let qualificationReadsInFlight = 0;
    let maximumQualificationReadsInFlight = 0;
    const runQualificationRead = async <T>(read: () => T): Promise<T> => {
      qualificationReadsInFlight += 1;
      maximumQualificationReadsInFlight = Math.max(
        maximumQualificationReadsInFlight,
        qualificationReadsInFlight,
      );
      try {
        await Promise.resolve();
        return read();
      } finally {
        qualificationReadsInFlight -= 1;
      }
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedMailboxItem: {
        findFirst: vi.fn(async () => runQualificationRead(
          () => ({ id: "activation_1" }),
        )),
      },
      hostedMember: {
        findUnique: vi.fn(async () => runQualificationRead(() => ({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          createdAt: new Date("2026-07-26T11:56:00.000Z"),
          suspendedAt: null,
          threadContainer: null,
        }))),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_introduced",
        }),
      },
      hostedUsageReferral: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{
          id: referral.id,
          referrerMemberId: referral.referrerMemberId,
        }]),
        findUnique: vi.fn().mockImplementation(async () => ({ ...referral })),
        update,
      },
    };

    await expect(observeHostedUsageReferralInboundTx({
      containerMemberId: "member_target_container",
      enabled: true,
      eventKey: "event_person_1",
      occurredAt,
      senderMemberId: null,
      senderSubjectKey,
      tx: tx as never,
    })).resolves.toEqual({
      isBoundReferralTarget: true,
      qualificationCandidateReferralIds: ["referral_person_1"],
    });

    expect(tx.hostedMemberIdentity.findUnique).toHaveBeenCalledWith({
      select: { memberId: true },
      where: { phoneLookupKey: senderSubjectKey },
    });
    expect(maximumQualificationReadsInFlight).toBe(1);
    expect(update).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        introducedMemberId: "member_introduced",
        qualifiedAt: occurredAt,
      }),
      where: { id: "referral_person_1" },
    });
  });

  it("does not repeat an unresolved subject lookup while referral locks are held", async () => {
    const senderSubjectKey = "hbidx:phone:v1:deadbeef";
    const referral = {
      armedAt: new Date("2026-07-26T11:55:00.000Z"),
      beneficiaryMemberId: "member_source_group",
      expiresAt: new Date("2026-08-02T11:55:00.000Z"),
      firstHumanMessageAt: null,
      humanMessageCount: 0,
      id: "referral_person_unresolved",
      introducedMemberId: null,
      lastHumanMessageAt: null,
      nonReferrerMessageCount: 0,
      observedEventKeysJson: null,
      observedSpeakerKeysJson: null,
      policyCode: "new_person_activation_v1" as const,
      qualifiedAt: null,
      referrerMemberId: "member_referrer",
      referrerSubjectKey: "subject_referrer",
      rewardUsdMicros: 2_000_000n,
      status: "target_bound",
      targetBoundAt: new Date("2026-07-26T11:59:00.000Z"),
      targetContainerMemberId: "member_target_container",
    };
    const findMemberIdentity = vi.fn().mockResolvedValue(null);
    const update = vi.fn().mockResolvedValue(referral);
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedMemberIdentity: { findUnique: findMemberIdentity },
      hostedUsageReferral: {
        findMany: vi.fn().mockResolvedValue([{
          id: referral.id,
          referrerMemberId: referral.referrerMemberId,
        }]),
        findUnique: vi.fn().mockResolvedValue(referral),
        update,
      },
    };

    await expect(observeHostedUsageReferralInboundTx({
      containerMemberId: "member_target_container",
      enabled: true,
      eventKey: "event_person_unresolved",
      occurredAt: new Date("2026-07-26T12:00:00.000Z"),
      senderMemberId: null,
      senderSubjectKey,
      tx: tx as never,
    })).resolves.toEqual({
      isBoundReferralTarget: true,
      qualificationCandidateReferralIds: [],
    });

    expect(findMemberIdentity).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });
});
