import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_USAGE_REFERRAL_GROUP_MINIMUM_ACTIVITY_SPAN_MS,
  bindArmedHostedUsageReferralToNewContainerTx,
  observeHostedUsageReferralInboundTx,
  qualifiesHostedActiveGroupReferral,
} from "@/src/lib/hosted-growth/usage-referral";
import {
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

describe("hosted usage referral policy", () => {
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

  it("binds only an eligible armed mission owned by the new container creator", async () => {
    const occurredAt = new Date("2026-07-26T12:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue({
      armedAt: new Date("2026-07-26T11:59:00.000Z"),
      id: "referral_1",
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
      targetContainerMemberId: "member_target_container",
      tx: tx as never,
    })).resolves.toEqual({ referralId: "referral_1" });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
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
        id: "referral_1",
        status: "armed",
        targetContainerMemberId: null,
      },
    });
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
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      hostedMailboxItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "activation_1" }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          createdAt: new Date("2026-07-26T11:56:00.000Z"),
          suspendedAt: null,
          threadContainer: null,
        }),
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
    expect(update).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        introducedMemberId: "member_introduced",
        qualifiedAt: occurredAt,
      }),
      where: { id: "referral_person_1" },
    });
  });
});
