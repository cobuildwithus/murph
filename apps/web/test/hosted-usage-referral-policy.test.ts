import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  buildHostedUsageReferralOutstandingWhere,
  buildHostedUsageReferralRewardLabel,
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
      rewardLabel:
        "about 70 more messages on the model this room is using now",
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
    expect(wake.notification.instructions).not.toContain("$3.50");
  });

  it("labels rewards by effective model without inventing a Luna estimate", () => {
    expect(buildHostedUsageReferralRewardLabel({
      destinationKind: "group",
      model: "gpt-5.6-sol",
      policyCode: "new_person_activation_v1",
    })).toBe(
      "about 50 more messages on the model this room is using now",
    );
    expect(buildHostedUsageReferralRewardLabel({
      destinationKind: "personal",
      model: "gpt-5.6-terra",
      policyCode: "active_group_v1",
    })).toBe(
      "about 140 more messages on the model your Murph is using now",
    );
    expect(buildHostedUsageReferralRewardLabel({
      destinationKind: "personal",
      model: "gpt-5.6-luna",
      policyCode: "new_person_activation_v1",
    })).toBe(
      "bonus usage on the model your Murph is using now",
    );
  });

  it("shares display copy and outstanding semantics with read-only projections", () => {
    expect(getHostedUsageReferralPolicyDisplay("new_person_activation_v1")).toEqual({
      requirementsLabel:
        "Bring one new person into a fresh Murph group. Murph handles onboarding, and the mission completes once they join the conversation with their own Murph.",
      title: "Bring someone new to Murph",
    });
    expect(getHostedUsageReferralPolicyDisplay("active_group_v1")).toEqual({
      requirementsLabel:
        "Start a fresh group and make it genuinely active, with multiple people actually talking.",
      title: "Start an active group",
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
      rewardLabel:
        "about 100 more messages on the model your Murph is using now",
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
      rewardLabel:
        "about 100 more messages on the model your Murph is using now",
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

  it.each([
    {
      expectedReferralId: null,
      policyCode: "new_person_activation_v1" as const,
      targetChannel: "telegram" as const,
      title: "keeps a Linq-armed new-person mission unbound from Telegram",
    },
    {
      expectedReferralId: "referral_1",
      policyCode: "new_person_activation_v1" as const,
      targetChannel: "linq" as const,
      title: "binds a new-person mission to a new Linq group",
    },
    {
      expectedReferralId: "referral_1",
      policyCode: "active_group_v1" as const,
      targetChannel: "telegram" as const,
      title: "binds an active-group mission to a new Telegram group",
    },
  ])("$title", async ({
    expectedReferralId,
    policyCode,
    targetChannel,
  }) => {
    const occurredAt = new Date("2026-07-26T12:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue({
      armedAt: new Date("2026-07-26T11:59:00.000Z"),
      id: "referral_1",
      policyCode,
    });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedUsageReferral: {
        findFirst,
        updateMany,
      },
    };

    await expect(bindArmedHostedUsageReferralToNewContainerTx({
      enabled: true,
      occurredAt,
      ownerMemberId: "member_referrer",
      targetChannel,
      targetContainerMemberId: "member_target_container",
      tx: tx as never,
    })).resolves.toEqual({ referralId: expectedReferralId });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        armedAt: { lte: occurredAt },
        expiresAt: { gt: occurredAt },
        referrerMemberId: "member_referrer",
        status: "armed",
      },
    }));
    if (expectedReferralId) {
      expect(updateMany).toHaveBeenCalledWith({
        data: {
          status: "target_bound",
          targetBoundAt: occurredAt,
          targetContainerMemberId: "member_target_container",
        },
        where: {
          id: "referral_1",
          status: "armed",
          targetContainerMemberId: null,
        },
      });
    } else {
      expect(updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: "target_bound",
        }),
      }));
    }
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
        findUnique: vi.fn().mockImplementation(async () => ({ ...referral })),
        update: vi.fn().mockImplementation(async (input: {
          data: Partial<typeof referral>;
        }) => {
          Object.assign(referral, input.data);
          return { ...referral };
        }),
      },
    };

    let candidate: string | null = null;
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
      candidate = observation.qualificationCandidateReferralId;
    }

    expect(candidate).toBe("referral_1");
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
      qualificationCandidateReferralId: "referral_1",
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
      qualificationCandidateReferralId: null,
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
      qualificationCandidateReferralId: null,
    });
    expect(update).not.toHaveBeenCalled();

    await expect(bindArmedHostedUsageReferralToNewContainerTx({
      enabled: true,
      occurredAt: new Date(expiresAt.getTime() + 1),
      ownerMemberId: "member_referrer",
      targetChannel: "linq",
      targetContainerMemberId: "member_later_container",
      tx: tx as never,
    })).resolves.toEqual({ referralId: null });
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
      qualificationCandidateReferralId: null,
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
      targetContainerMemberId: "member_after_grace_container",
      tx: tx as never,
    })).resolves.toEqual({ referralId: null });
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
      qualificationCandidateReferralId: "referral_person_1",
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
      qualificationCandidateReferralId: null,
    });

    expect(findMemberIdentity).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });
});
