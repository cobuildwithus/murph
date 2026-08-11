import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateHostedGroupSponsorshipMomentTx,
  assertHostedGroupSponsorshipRequestMatchesTx,
  createHostedGroupSponsorshipMomentTx,
  digestHostedGroupSponsorshipDraft,
  hasHostedGroupSponsorshipCustomizationAuthority,
  parseHostedGroupSponsorshipDraft,
  readHostedActiveGroupRunningBit,
  readHostedGroupFundingSupporters,
  readHostedGroupSponsorshipDraftForCreator,
  readHostedGroupSponsorshipMomentForNotification,
} from "@/src/lib/hosted-groups/group-sponsorship-store";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import {
  HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT,
} from "@/src/lib/hosted-groups/group-sponsorship-contract";

const PAID_AT = new Date("2026-07-27T12:00:00.000Z");

beforeEach(() => {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt: ({ value }) =>
      Buffer.from(value.slice("sealed:".length), "base64url").toString("utf8"),
    encrypt: ({ value }) =>
      `sealed:${Buffer.from(value, "utf8").toString("base64url")}`,
  });
});

afterEach(() => {
  setHostedSecureBoxStringTestCodecForTests(null);
});

describe("hosted group sponsorship store", () => {
  it("normalizes bounded creative requests and rejects ambiguous input", () => {
    expect(parseHostedGroupSponsorshipDraft({
      creativeRequest: {
        format: "song",
        prompt: "  Make this the group theme.  ",
        styleRequest: "  Warm ensemble-sitcom theme.  ",
      },
      publicAlias: "  The Group Historian  ",
      runningBitRequest: "Treat me like the exhausted CFO.",
      sponsorMessage: null,
    })).toEqual({
      creativeRequest: {
        format: "song",
        prompt: "Make this the group theme.",
        styleRequest: "Warm ensemble-sitcom theme.",
      },
      publicAlias: "The Group Historian",
      runningBitRequest: "Treat me like the exhausted CFO.",
      sponsorMessage: null,
    });
    expect(parseHostedGroupSponsorshipDraft({
      sponsorMessage: "  For whatever adventure comes next.  ",
    })).toEqual({
      publicAlias: null,
      runningBitRequest: null,
      sponsorMessage: "For whatever adventure comes next.",
    });
    expect(parseHostedGroupSponsorshipDraft({})).toBeNull();
    expect(parseHostedGroupSponsorshipDraft({
      publicAlias: "Legacy public identity",
    })).toEqual({
      publicAlias: "Legacy public identity",
      runningBitRequest: null,
      sponsorMessage: null,
    });
    expect(parseHostedGroupSponsorshipDraft({
      publicAlias: "Funding-page alias",
      publicAliasRecognition: HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT,
    })).toEqual({
      publicAlias: "Funding-page alias",
      publicAliasRecognition: HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT,
      runningBitRequest: null,
      sponsorMessage: null,
    });
    expect(() => parseHostedGroupSponsorshipDraft({
      publicAlias: null,
      publicAliasRecognition: HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT,
    })).toThrow(/short plain text/u);
    expect(() => parseHostedGroupSponsorshipDraft({
      publicAlias: "Sponsor",
      unexpected: true,
    })).toThrow(/short plain text/u);
    expect(() => parseHostedGroupSponsorshipDraft({
      creativeRequest: {
        format: "message",
        prompt: "Thanks, everyone.",
        styleRequest: "Like a particular song.",
      },
    })).toThrow(/short plain text/u);
    expect(() => parseHostedGroupSponsorshipDraft({
      creativeRequest: {
        format: "song",
        prompt: "Theme song",
        styleRequest: null,
      },
      sponsorMessage: "Legacy note",
    })).toThrow(/short plain text/u);
    expect(() => parseHostedGroupSponsorshipDraft({
      creativeRequest: {
        format: "song",
        prompt: "unsafe\u0000text",
        styleRequest: null,
      },
    })).toThrow(/short plain text/u);
  });

  it("projects the live sponsor and recent one-time contributions from explicit public aliases", async () => {
    const authorizationFindFirst = vi.fn(async () => ({
      id: "hgsa_abcdefghijklmnop",
    }));
    const purchaseFindFirst = vi.fn(async () => ({
      id: "hucp_monthlysponsor1",
    }));
    const purchaseFindMany = vi.fn(async () => [
      { id: "hucp_onetimecontrib1" },
      { id: "hucp_onetimecontrib2" },
    ]);
    const momentFindMany = vi.fn(async () => [
      {
        creatorMemberId: "member_monthly",
        publicAliasEncrypted: sealRecognizedAlias("The Group Historian"),
        purchaseId: "hucp_monthlysponsor1",
      },
      {
        creatorMemberId: "member_one_time",
        publicAliasEncrypted: sealRecognizedAlias("Night Shift"),
        purchaseId: "hucp_onetimecontrib1",
      },
    ]);
    const prisma = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: authorizationFindFirst,
      },
      hostedGroupSponsorshipMoment: {
        findMany: momentFindMany,
      },
      hostedUsageCreditPurchase: {
        findFirst: purchaseFindFirst,
        findMany: purchaseFindMany,
      },
    };

    await expect(readHostedGroupFundingSupporters({
      beneficiaryMemberId: "member_group_runtime",
      prisma: prisma as never,
    })).resolves.toEqual({
      monthlySponsor: {
        id: "hucp_monthlysponsor1",
        name: "The Group Historian",
      },
      oneTimeContributions: [
        {
          id: "hucp_onetimecontrib1",
          name: "Night Shift",
        },
        {
          id: "hucp_onetimecontrib2",
          name: "Anonymous",
        },
      ],
    });
    expect(authorizationFindFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        beneficiaryMemberId: "member_group_runtime",
        status: {
          in: ["active", "paused", "recovery_required"],
        },
      },
    });
    expect(purchaseFindMany).toHaveBeenCalledWith({
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      select: { id: true },
      take: 20,
      where: {
        beneficiaryMemberId: "member_group_runtime",
        groupSponsorshipAuthorizationId: null,
        paidAt: { not: null },
        status: "fulfilled",
      },
    });
    expect(purchaseFindFirst).toHaveBeenCalledWith({
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      select: { id: true },
      where: {
        groupSponsorshipAuthorizationId: "hgsa_abcdefghijklmnop",
        groupSponsorshipChargeOrdinal: 0,
        status: "fulfilled",
      },
    });
    expect(momentFindMany).toHaveBeenCalledWith({
      select: {
        creatorMemberId: true,
        publicAliasEncrypted: true,
        purchaseId: true,
      },
      where: {
        beneficiaryMemberId: "member_group_runtime",
        fundingPageAliasPublishedAt: { not: null },
        publicAliasEncrypted: { not: null },
        purchaseId: {
          in: [
            "hucp_monthlysponsor1",
            "hucp_onetimecontrib1",
            "hucp_onetimecontrib2",
          ],
        },
      },
    });
  });

  it("keeps legacy aliases anonymous without recognition consent", async () => {
    const prisma = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: vi.fn(async () => null),
      },
      hostedGroupSponsorshipMoment: {
        findMany: vi.fn(async () => [{
          creatorMemberId: "member_one_time",
          publicAliasEncrypted: sealTestValue("Legacy creative alias"),
          purchaseId: "hucp_onetimecontrib1",
        }]),
      },
      hostedUsageCreditPurchase: {
        findFirst: vi.fn(),
        findMany: vi.fn(async () => [{ id: "hucp_onetimecontrib1" }]),
      },
    };

    await expect(readHostedGroupFundingSupporters({
      beneficiaryMemberId: "member_group_runtime",
      prisma: prisma as never,
    })).resolves.toEqual({
      monthlySponsor: null,
      oneTimeContributions: [{
        id: "hucp_onetimecontrib1",
        name: "Anonymous",
      }],
    });
  });

  it("stops supporter reads when their latency budget is already exhausted", async () => {
    const controller = new AbortController();
    controller.abort();
    const prisma = {
      hostedGroupSponsorshipAuthorization: { findFirst: vi.fn() },
      hostedGroupSponsorshipMoment: { findMany: vi.fn() },
      hostedUsageCreditPurchase: { findFirst: vi.fn(), findMany: vi.fn() },
    };

    await expect(readHostedGroupFundingSupporters({
      beneficiaryMemberId: "member_group_runtime",
      prisma: prisma as never,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(prisma.hostedGroupSponsorshipAuthorization.findFirst)
      .not.toHaveBeenCalled();
    expect(prisma.hostedUsageCreditPurchase.findMany).not.toHaveBeenCalled();
  });

  it("keeps funding history available as Anonymous when aliases cannot be opened", async () => {
    setHostedSecureBoxStringTestCodecForTests({
      decrypt: () => {
        throw new Error("secure box unavailable");
      },
      encrypt: ({ value }) => sealTestValue(value),
    });
    const prisma = {
      hostedGroupSponsorshipAuthorization: {
        findFirst: vi.fn(async () => null),
      },
      hostedGroupSponsorshipMoment: {
        findMany: vi.fn(async () => [{
          creatorMemberId: "member_one_time",
          publicAliasEncrypted: sealTestValue("Hidden name"),
          purchaseId: "hucp_onetimecontrib1",
        }]),
      },
      hostedUsageCreditPurchase: {
        findFirst: vi.fn(),
        findMany: vi.fn(async () => [{
          id: "hucp_onetimecontrib1",
        }]),
      },
    };

    await expect(readHostedGroupFundingSupporters({
      beneficiaryMemberId: "member_group_runtime",
      prisma: prisma as never,
    })).resolves.toEqual({
      monthlySponsor: null,
      oneTimeContributions: [{
        id: "hucp_onetimecontrib1",
        name: "Anonymous",
      }],
    });
    expect(prisma.hostedUsageCreditPurchase.findFirst).not.toHaveBeenCalled();
  });

  it("freezes encrypted creative content and activates one expiring bit", async () => {
    const harness = createHarness();
    const draft = {
      creativeRequest: {
        format: "song" as const,
        prompt: "Make this the group theme.",
        styleRequest: "Warm ensemble-sitcom theme with a bright acoustic intro.",
      },
      publicAlias: "The Group Historian",
      publicAliasRecognition: HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT,
      runningBitRequest: "Treat me like the exhausted CFO.",
      sponsorMessage: null,
    };

    await createHostedGroupSponsorshipMomentTx({
      authorizedDraft: draft,
      beneficiaryMemberId: "member_group_runtime",
      creatorMemberId: "member_sponsor",
      offerCode: "usage_10_usd",
      purchaseId: "purchase_123",
      tx: harness.prisma as never,
    });

    expect(harness.row).toMatchObject({
      beneficiaryMemberId: "member_group_runtime",
      creatorMemberId: "member_sponsor",
      purchaseId: "purchase_123",
      sponsorMessageEncrypted: null,
    });
    expect(harness.row.configurationDigest).not.toContain("Group Historian");
    expect(harness.row.publicAliasEncrypted).not.toContain("Group Historian");
    expect(harness.row.creativeRequestEncrypted).toMatch(/^sealed:/u);
    expect(harness.row.creativeRequestEncrypted).not.toContain("ensemble");

    await expect(assertHostedGroupSponsorshipRequestMatchesTx({
      draft,
      purchaseId: "purchase_123",
      tx: harness.prisma as never,
    })).resolves.toBeUndefined();
    await expect(assertHostedGroupSponsorshipRequestMatchesTx({
      draft: {
        ...draft,
        creativeRequest: {
          ...draft.creativeRequest,
          styleRequest: "Changed after payment started.",
        },
      },
      purchaseId: "purchase_123",
      tx: harness.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
    });

    await activateHostedGroupSponsorshipMomentTx({
      activatedAt: PAID_AT,
      customContentAuthorized: true,
      offerCode: "usage_10_usd",
      purchaseId: "purchase_123",
      tx: harness.prisma as never,
    });
    expect(harness.row).toMatchObject({
      activatedAt: PAID_AT,
      expiresAt: new Date("2026-07-28T12:00:00.000Z"),
      fundingPageAliasPublishedAt: PAID_AT,
    });

    await expect(readHostedGroupSponsorshipMomentForNotification({
      customContentAuthorized: true,
      offerCode: "usage_10_usd",
      prisma: harness.prisma as never,
      purchaseId: "purchase_123",
    })).resolves.toMatchObject({
      celebrationScale: "medium",
      creativeRequest: draft.creativeRequest,
      publicAlias: draft.publicAlias,
      runningBitRequest: draft.runningBitRequest,
      sponsorMessage: draft.sponsorMessage,
    });
    await expect(readHostedGroupSponsorshipDraftForCreator({
      creatorMemberId: "member_sponsor",
      prisma: harness.prisma as never,
      purchaseId: "purchase_123",
    })).resolves.toEqual(draft);
    await expect(readHostedActiveGroupRunningBit({
      now: new Date("2026-07-27T13:00:00.000Z"),
      prisma: harness.prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({
      expiresAt: "2026-07-28T12:00:00.000Z",
      publicAlias: draft.publicAlias,
      requestedBit: draft.runningBitRequest,
      schema: "murph.group-sponsorship-bit.v1",
    });

    harness.row.creativeRequestEncrypted =
      `sealed:${Buffer.from(JSON.stringify({
        request: null,
        schema: "murph.group-sponsorship-creative.v1",
      }), "utf8").toString("base64url")}`;
    await expect(readHostedGroupSponsorshipDraftForCreator({
      creatorMemberId: "member_sponsor",
      prisma: harness.prisma as never,
      purchaseId: "purchase_123",
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_SPONSORSHIP_INVALID",
    });
    const quietNotification =
      await readHostedGroupSponsorshipMomentForNotification({
        customContentAuthorized: true,
        offerCode: "usage_10_usd",
        prisma: harness.prisma as never,
        purchaseId: "purchase_123",
      });
    expect(quietNotification).toMatchObject({
      publicAlias: draft.publicAlias,
      runningBitRequest: draft.runningBitRequest,
      sponsorMessage: null,
    });
    expect(quietNotification).not.toHaveProperty("creativeRequest");
    await expect(readHostedActiveGroupRunningBit({
      now: new Date("2026-07-27T13:00:00.000Z"),
      prisma: harness.prisma as never,
      runtimeMemberId: "member_group_runtime",
    })).resolves.toEqual({
      expiresAt: "2026-07-28T12:00:00.000Z",
      publicAlias: draft.publicAlias,
      requestedBit: draft.runningBitRequest,
      schema: "murph.group-sponsorship-bit.v1",
    });

    setHostedSecureBoxStringTestCodecForTests({
      decrypt: ({ value }) => {
        if (value === harness.row.creativeRequestEncrypted) {
          throw new Error("Creative request decryption unavailable.");
        }
        return Buffer.from(
          value.slice("sealed:".length),
          "base64url",
        ).toString("utf8");
      },
      encrypt: ({ value }) =>
        `sealed:${Buffer.from(value, "utf8").toString("base64url")}`,
    });
    await expect(readHostedGroupSponsorshipMomentForNotification({
      customContentAuthorized: true,
      offerCode: "usage_10_usd",
      prisma: harness.prisma as never,
      purchaseId: "purchase_123",
    })).rejects.toThrow("Creative request decryption unavailable.");
  });

  it("upgrades a legacy-shaped note into a modern message envelope", async () => {
    const harness = createHarness();
    const legacyDraft = {
      publicAlias: "The Group Historian",
      runningBitRequest: null,
      sponsorMessage: "For whatever adventure comes next.",
    };

    await createHostedGroupSponsorshipMomentTx({
      authorizedDraft: legacyDraft,
      beneficiaryMemberId: "member_group_runtime",
      creatorMemberId: "member_sponsor",
      offerCode: "usage_5_usd",
      purchaseId: "purchase_old_client",
      tx: harness.prisma as never,
    });

    expect(harness.row.creativeRequestEncrypted).toMatch(/^sealed:/u);
    expect(harness.row.sponsorMessageEncrypted).toBeNull();
    await expect(assertHostedGroupSponsorshipRequestMatchesTx({
      draft: legacyDraft,
      purchaseId: "purchase_old_client",
      tx: harness.prisma as never,
    })).resolves.toBeUndefined();
    await expect(readHostedGroupSponsorshipDraftForCreator({
      creatorMemberId: "member_sponsor",
      prisma: harness.prisma as never,
      purchaseId: "purchase_old_client",
    })).resolves.toEqual({
      creativeRequest: {
        format: "message",
        prompt: legacyDraft.sponsorMessage,
        styleRequest: null,
      },
      publicAlias: legacyDraft.publicAlias,
      runningBitRequest: null,
      sponsorMessage: null,
    });
    await expect(readHostedGroupSponsorshipMomentForNotification({
      customContentAuthorized: true,
      offerCode: "usage_5_usd",
      prisma: harness.prisma as never,
      purchaseId: "purchase_old_client",
    })).resolves.toMatchObject({
      creativeRequest: {
        format: "message",
        prompt: legacyDraft.sponsorMessage,
        styleRequest: null,
      },
      sponsorMessage: null,
    });
  });

  it("keeps modern and legacy rows quiet without an explicit creative request", async () => {
    const harness = createHarness();
    const aliasOnlyDraft = {
      publicAlias: "Unused private identity",
      runningBitRequest: null,
      sponsorMessage: null,
    };
    await createHostedGroupSponsorshipMomentTx({
      authorizedDraft: aliasOnlyDraft,
      beneficiaryMemberId: "member_group_runtime",
      creatorMemberId: "member_sponsor",
      offerCode: "usage_5_usd",
      purchaseId: "purchase_quiet",
      tx: harness.prisma as never,
    });

    expect(harness.row.creativeRequestEncrypted).toBeNull();
    expect(harness.row.publicAliasEncrypted).toBeNull();
    expect(harness.row.sponsorMessageEncrypted).toBeNull();
    await expect(assertHostedGroupSponsorshipRequestMatchesTx({
      draft: aliasOnlyDraft,
      purchaseId: "purchase_quiet",
      tx: harness.prisma as never,
    })).resolves.toBeUndefined();
    const quiet = await readHostedGroupSponsorshipMomentForNotification({
      customContentAuthorized: true,
      offerCode: "usage_5_usd",
      prisma: harness.prisma as never,
      purchaseId: "purchase_quiet",
    });
    expect(quiet).toMatchObject({
      sponsorMessage: null,
    });
    expect(quiet).not.toHaveProperty("creativeRequest");

    harness.row.configurationDigest =
      digestHostedGroupSponsorshipDraft(aliasOnlyDraft);
    harness.row.creativeRequestEncrypted = null;
    harness.row.publicAliasEncrypted =
      `sealed:${Buffer.from(aliasOnlyDraft.publicAlias, "utf8").toString("base64url")}`;
    await expect(assertHostedGroupSponsorshipRequestMatchesTx({
      draft: aliasOnlyDraft,
      purchaseId: "purchase_quiet",
      tx: harness.prisma as never,
    })).resolves.toBeUndefined();
    await expect(readHostedGroupSponsorshipMomentForNotification({
      customContentAuthorized: true,
      offerCode: "usage_5_usd",
      prisma: harness.prisma as never,
      purchaseId: "purchase_quiet",
    })).resolves.toMatchObject({
      publicAlias: null,
      sponsorMessage: null,
    });
    const legacy = await readHostedGroupSponsorshipMomentForNotification({
      customContentAuthorized: true,
      offerCode: "usage_5_usd",
      prisma: harness.prisma as never,
      purchaseId: "purchase_quiet",
    });
    expect(legacy).not.toHaveProperty("creativeRequest");

    const legacyNote = "Celebrate everyone finishing together.";
    harness.row.sponsorMessageEncrypted =
      `sealed:${Buffer.from(legacyNote, "utf8").toString("base64url")}`;
    await expect(readHostedGroupSponsorshipMomentForNotification({
      customContentAuthorized: true,
      offerCode: "usage_5_usd",
      prisma: harness.prisma as never,
      purchaseId: "purchase_quiet",
    })).resolves.toMatchObject({
      creativeRequest: {
        format: "message",
        prompt: legacyNote,
        styleRequest: null,
      },
      publicAlias: aliasOnlyDraft.publicAlias,
      sponsorMessage: null,
    });
  });

  it("separates funding from customization authority and gives $5 no running bit", async () => {
    const unauthorized = createHarness({ participantAuthorized: false });
    await expect(hasHostedGroupSponsorshipCustomizationAuthority({
      containerMemberId: "member_group_runtime",
      now: PAID_AT,
      participantMemberId: "member_outsider",
      prisma: unauthorized.prisma as never,
    })).resolves.toBe(false);

    await expect(createHostedGroupSponsorshipMomentTx({
      authorizedDraft: {
        publicAlias: null,
        runningBitRequest: "Make me CFO.",
        sponsorMessage: null,
      },
      beneficiaryMemberId: "member_group_runtime",
      creatorMemberId: "member_sponsor",
      offerCode: "usage_5_usd",
      purchaseId: "purchase_5",
      tx: unauthorized.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_SPONSORSHIP_BIT_NOT_AVAILABLE",
    });
  });

  it("keeps a recognized alias unpublished when settlement authority is lost", async () => {
    const harness = createHarness();
    await createHostedGroupSponsorshipMomentTx({
      authorizedDraft: {
        publicAlias: "Former participant",
        publicAliasRecognition: HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT,
        runningBitRequest: null,
        sponsorMessage: null,
      },
      beneficiaryMemberId: "member_group_runtime",
      creatorMemberId: "member_sponsor",
      offerCode: "usage_5_usd",
      purchaseId: "purchase_removed_before_settlement",
      tx: harness.prisma as never,
    });

    await activateHostedGroupSponsorshipMomentTx({
      activatedAt: PAID_AT,
      customContentAuthorized: false,
      offerCode: "usage_5_usd",
      purchaseId: "purchase_removed_before_settlement",
      tx: harness.prisma as never,
    });

    expect(harness.row).toMatchObject({
      activatedAt: PAID_AT,
      fundingPageAliasPublishedAt: null,
    });
  });
});

function sealTestValue(value: string): string {
  return `sealed:${Buffer.from(value, "utf8").toString("base64url")}`;
}

function sealRecognizedAlias(value: string): string {
  return sealTestValue(JSON.stringify({
    publicAlias: value,
    recognition: HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT,
    schema: "murph.group-sponsorship-public-alias.v1",
  }));
}

function createHarness(input: { participantAuthorized?: boolean } = {}) {
  const state: { row: Record<string, unknown> } = { row: {} };
  const hostedGroupSponsorshipMoment = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.row = {
        ...data,
        activatedAt: null,
        expiresAt: null,
        fundingPageAliasPublishedAt: null,
      };
      return state.row;
    }),
    findFirst: vi.fn(async () =>
      Object.keys(state.row).length > 0 ? state.row : null
    ),
    findUnique: vi.fn(async (query: {
      select?: Record<string, boolean>;
    }) => {
      if (Object.keys(state.row).length === 0) {
        return null;
      }
      return query.select
        ? Object.fromEntries(
            Object.keys(query.select).map((key) => [key, state.row[key]]),
          )
        : state.row;
    }),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (state.row.activatedAt) {
        return { count: 0 };
      }
      Object.assign(state.row, data);
      return { count: 1 };
    }),
  };
  const prisma = {
    hostedGroupSponsorshipMoment,
    hostedThreadContainer: {
      findFirst: vi.fn(async () =>
        input.participantAuthorized === false
          ? null
          : { memberId: "member_group_runtime" }
      ),
    },
  };
  return {
    get row() {
      return state.row;
    },
    prisma,
  };
}
